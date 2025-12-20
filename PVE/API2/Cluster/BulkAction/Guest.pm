package PVE::API2::Cluster::BulkAction::Guest;

use strict;
use warnings;

use PVE::APIClient::LWP;
use PVE::Cluster;
use PVE::Exception qw(raise raise_perm_exc raise_param_exc);
use PVE::INotify;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RESTEnvironment qw(log_warn);
use PVE::RPCEnvironment;
use PVE::Storage;
use PVE::UPID;

use PVE::API2::Nodes;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Bulk action index.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {},
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        return [
            { name => 'start' },
            { name => 'shutdown' },
            { name => 'migrate' },
            { name => 'suspend' },
        ];
    },
});

sub create_client {
    my ($request_timeout) = @_;

    my $rpcenv = PVE::RPCEnvironment::get();
    my $authuser = $rpcenv->get_user();
    my $credentials = $rpcenv->get_credentials();

    my $node = PVE::INotify::nodename();
    my $fingerprint = PVE::Cluster::get_node_fingerprint($node);

    my $api_client = PVE::APIClient::LWP->new(
        protocol => 'https',
        # TODO: avoid extra proxying level to reduce overhead
        host => 'localhost', # always call the api locally, let pveproxy handle the proxying
        port => 8006,
        username => $authuser,
        ticket => $credentials->{ticket},
        api_token => $credentials->{api_token},
        timeout => $request_timeout // 25, # default slightly shorter than the proxy->daemon timeout
        cached_fingerprints => {
            $fingerprint => 1,
        },
    );

    if (defined(my $csrf_token = $credentials->{token})) {
        $api_client->update_csrftoken($csrf_token);
    }

    return $api_client;
}

sub make_get_request {
    my ($client, $path, $retry_count) = @_;

    $retry_count //= 0;

    my $res = eval { $client->get($path) };
    my $err = $@;
    if ($err && $retry_count > 0) {
        my $retries = 0;
        while ($err && $retries < $retry_count) {
            $res = eval { $client->get($path) };
            $err = $@;
            $retries++;
            sleep 1;
        }
    }
    die $err if $err;
    return $res;
}

# starts and awaits a task for each guest given via $startlist.
#
# takes a vm list in the form of
# {
#     0 => {
#         100 => { .. guest info ..},
#         101 => { .. guest info ..},
#     },
#     1 => {
#         102 => { .. guest info ..},
#         103 => { .. guest info ..},
#     },
# }
#
# max_workers: how many parallel tasks should be started.
# start_task: a sub that returns either a upid or 1 (undef means failure)
# check_task: if start_task returned a upid, will wait for that to finish and
#    call check_task with the resulting task status
sub handle_task_foreach_guest {
    my ($startlist, $max_workers, $start_task, $check_task) = @_;

    my $api_client = create_client();

    my $failed = [];
    for my $order (sort { $a <=> $b } keys $startlist->%*) {
        my $vmlist = $startlist->{$order};
        my $workers = {};

        for my $vmid (sort { $a <=> $b } keys $vmlist->%*) {

            # wait until at least one slot is free
            while (scalar(keys($workers->%*)) >= $max_workers) {
                for my $upid (keys($workers->%*)) {
                    my $worker = $workers->{$upid};
                    my $node = $worker->{guest}->{node};

                    my $task =
                        eval { make_get_request($api_client, "/nodes/$node/tasks/$upid/status", 3) };
                    if (my $err = $@) {
                        push $failed->@*, $worker->{vmid};

                        $check_task->($api_client, $worker->{vmid}, $worker->{guest}, 1, undef);

                        delete $workers->{$upid};
                    } elsif ($task->{status} ne 'running') {
                        my $is_error = PVE::UPID::status_is_error($task->{exitstatus});
                        push $failed->@*, $worker->{vmid} if $is_error;

                        $check_task->(
                            $api_client, $worker->{vmid}, $worker->{guest}, $is_error, $task,
                        );

                        delete $workers->{$upid};
                    }
                }
                sleep(1); # How much?
            }

            my $guest = $vmlist->{$vmid};
            my $upid = eval { $start_task->($api_client, $vmid, $guest) };
            log_warn("$@") if $@;

            # success but no task necessary
            next if defined($upid) && "$upid" eq "1";

            if (!defined($upid)) {
                push $failed->@*, $vmid;
                next;
            }

            $workers->{$upid} = {
                vmid => $vmid,
                guest => $guest,
            };
        }

        # wait until current order is finished
        for my $upid (keys($workers->%*)) {
            my $worker = $workers->{$upid};
            my $node = $worker->{guest}->{node};

            my $task = eval { wait_for_task_finished($api_client, $node, $upid) };
            my $err = $@;
            my $is_error = ($err || PVE::UPID::status_is_error($task->{exitstatus})) ? 1 : 0;
            push $failed->@*, $worker->{vmid} if $is_error;

            $check_task->($api_client, $worker->{vmid}, $worker->{guest}, $is_error, $task);

            delete $workers->{$upid};
        }
    }

    return $failed;
}

sub get_type_text {
    my ($type) = @_;

    if ($type eq 'lxc') {
        return 'CT';
    } elsif ($type eq 'qemu') {
        return 'VM';
    } else {
        die "unknown guest type $type\n";
    }
}

sub wait_for_task_finished {
    my ($client, $node, $upid) = @_;

    while (1) {
        my $task = make_get_request($client, "/nodes/$node/tasks/$upid/status", 3);
        return $task if $task->{status} ne 'running';
        sleep(1); # How much time?
    }
}

sub check_guest_permissions {
    my ($rpcenv, $authuser, $vmlist, $priv_list) = @_;

    if (scalar($vmlist->@*) > 0) {
        $rpcenv->check($authuser, "/vms/$_", $priv_list) for $vmlist->@*;
    } elsif (!$rpcenv->check($authuser, "/", $priv_list, 1)) {
        raise_perm_exc("/, " . join(', ', $priv_list->@*));
    }
}

sub extract_vmlist {
    my ($param) = @_;

    if (my $vmlist = $param->{vms}) {
        my $vmlist_string = join(',', $vmlist->@*);
        return ($vmlist, $vmlist_string);
    }
    return ([], undef);
}

sub print_start_action {
    my ($vmlist, $prefix, $suffix) = @_;

    $suffix = defined($suffix) ? " $suffix" : "";

    if (scalar($vmlist->@*)) {
        print "$prefix guests$suffix: " . join(', ', $vmlist->@*) . "\n";
    } else {
        print "$prefix all guests$suffix\n";
    }
}

sub get_max_workers {
    my ($param, $default) = @_;

    return $param->{'max-workers'} if $param->{'max-workers'};
    return $param->{maxworkers} if $param->{maxworkers}; # alias

    my $datacenter_config = PVE::Cluster::cfs_read_file('datacenter.cfg');
    return $datacenter_config->{max_workers} if $datacenter_config->{max_workers};

    return $default || 1;
}

__PACKAGE__->register_method({
    name => 'start',
    path => 'start',
    method => 'POST',
    description => "Bulk start or resume all guests on the cluster.",
    permissions => {
        description => "The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for "
            . "each ID passed via the 'vms' parameter.",
        user => 'all',
    },
    protected => 1,
    expose_credentials => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            vms => {
                description => "Only consider guests from this list of VMIDs.",
                type => 'array',
                items => get_standard_option('pve-vmid'),
                optional => 1,
            },
            timeout => {
                description =>
                    "Default start timeout in seconds. Only valid for VMs. (default depends on the guest configuration).",
                type => 'integer',
                optional => 1,
            },
            maxworkers => {
                description => "Defines the maximum number of tasks running concurrently."
                    . " Deprecated, use 'max-workers' instead.",
                optional => 1,
                default => 4,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            'max-workers' => {
                description => "Defines the maximum number of tasks running concurrently.",
                optional => 1,
                default => 4,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            # TODO:
            # Failure resolution mode (fail, warn, retry?)
            # mode-limits (offline only, suspend only, ?)
            # filter (tags, name, ?)
        },
    },
    returns => {
        type => 'string',
        description => "UPID of the worker",
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my ($vmlist, $vmlist_string) = extract_vmlist($param);

        check_guest_permissions($rpcenv, $authuser, $vmlist, ['VM.PowerMgmt']);

        my $code = sub {
            my $startlist =
                PVE::API2::Nodes::Nodeinfo::get_start_stop_list(undef, undef, $vmlist_string);

            print_start_action($vmlist, "Starting");

            my $start_task = sub {
                my ($api_client, $vmid, $guest) = @_;
                my $node = $guest->{node};

                my $type = $guest->{type};
                my $type_text = get_type_text($type);
                my $operation = 'start';
                my $status = eval {
                    make_get_request($api_client, "/nodes/$node/$type/$vmid/status/current");
                };
                if (defined($status) && $status->{status} eq 'running') {
                    if (defined($status->{qmpstatus}) && $status->{qmpstatus} ne 'paused') {
                        log_warn("Skipping $type_text $vmid, already running.\n");
                        return 1;
                    } else {
                        $operation = 'resume';
                    }
                }

                my $params = {};
                if (defined($param->{timeout}) && $operation eq 'start' && $type eq 'qemu') {
                    $params->{timeout} = $param->{timeout};
                }

                my $url = "/nodes/$node/$type/$vmid/status/$operation";
                print "Starting $type_text $vmid\n";
                return $api_client->post($url, $params);
            };

            my $check_task = sub {
                my ($api_client, $vmid, $guest, $is_error, $task) = @_;
                my $node = $guest->{node};

                my $default_delay = 0;

                if (!$is_error) {
                    my $delay = defined($guest->{up}) ? int($guest->{up}) : $default_delay;
                    if ($delay > 0) {
                        print "Waiting for $delay seconds (startup delay)\n"
                            if $guest->{up};
                        for (my $i = 0; $i < $delay; $i++) {
                            sleep(1);
                        }
                    }
                } else {
                    my $err =
                        defined($task) ? $task->{exitstatus} : "could not query task status";
                    my $type_text = get_type_text($guest->{type});
                    log_warn("Starting $type_text $vmid failed: $err\n");
                }
            };

            my $max_workers = get_max_workers($param, 4);
            my $failed =
                handle_task_foreach_guest($startlist, $max_workers, $start_task, $check_task);

            if (scalar($failed->@*)) {
                die "Some guests failed to start: " . join(', ', $failed->@*) . "\n";
            }
        };

        return $rpcenv->fork_worker('bulk-start', undef, $authuser, $code);
    },
});

__PACKAGE__->register_method({
    name => 'shutdown',
    path => 'shutdown',
    method => 'POST',
    description => "Bulk shutdown all guests on the cluster.",
    permissions => {
        description => "The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for "
            . "each ID passed via the 'vms' parameter.",
        user => 'all',
    },
    protected => 1,
    expose_credentials => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            vms => {
                description => "Only consider guests from this list of VMIDs.",
                type => 'array',
                items => get_standard_option('pve-vmid'),
                optional => 1,
            },
            timeout => {
                description =>
                    "Default shutdown timeout in seconds if none is configured for the guest.",
                type => 'integer',
                default => 180,
                optional => 1,
            },
            'force-stop' => {
                description => "Makes sure the Guest stops after the timeout.",
                type => 'boolean',
                default => 1,
                optional => 1,
            },
            maxworkers => {
                description => "Defines the maximum number of tasks running concurrently."
                    . " Deprecated, use 'max-workers' instead.",
                optional => 1,
                default => 4,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            'max-workers' => {
                description => "Defines the maximum number of tasks running concurrently.",
                optional => 1,
                default => 4,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            # TODO:
            # Failure resolution mode (fail, warn, retry?)
            # mode-limits (offline only, suspend only, ?)
            # filter (tags, name, ?)
        },
    },
    returns => {
        type => 'string',
        description => "UPID of the worker",
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my ($vmlist, $vmlist_string) = extract_vmlist($param);

        check_guest_permissions($rpcenv, $authuser, $vmlist, ['VM.PowerMgmt']);

        my $code = sub {
            my $startlist =
                PVE::API2::Nodes::Nodeinfo::get_start_stop_list(undef, undef, $vmlist_string);

            print_start_action($vmlist, "Shutting down");

            # reverse order for shutdown
            for my $order (keys $startlist->%*) {
                my $list = delete $startlist->{$order};
                $order = $order * -1;
                $startlist->{$order} = $list;
            }

            my $start_task = sub {
                my ($api_client, $vmid, $guest) = @_;
                my $node = $guest->{node};

                my $type = $guest->{type};
                my $type_text = get_type_text($type);

                my $status = eval {
                    make_get_request($api_client, "/nodes/$node/$type/$vmid/status/current");
                };
                if (defined($status) && $status->{status} ne 'running') {
                    log_warn("Skipping $type_text $vmid, not running.\n");
                    return 1;
                }

                if (
                    defined($status)
                    && defined($status->{qmpstatus})
                    && $status->{qmpstatus} eq 'paused'
                    && !$param->{'force-stop'}
                ) {
                    log_warn("Skipping $type_text $vmid, resume paused VM before shutdown.\n");
                    return 1;
                }

                my $timeout = int($guest->{down} // $param->{timeout} // 180);
                my $forceStop = $param->{'force-stop'} // 1;

                my $params = {
                    forceStop => $forceStop,
                    timeout => $timeout,
                };

                my $url = "/nodes/$node/$type/$vmid/status/shutdown";
                print "Shutting down $type_text $vmid (Timeout = $timeout seconds)\n";
                return $api_client->post($url, $params);
            };

            my $check_task = sub {
                my ($api_client, $vmid, $guest, $is_error, $task) = @_;
                my $node = $guest->{node};
                if ($is_error) {
                    my $err =
                        defined($task) ? $task->{exitstatus} : "could not query task status";
                    my $type_text = get_type_text($guest->{type});
                    log_warn("Stopping $type_text $vmid failed: $err\n");
                }
            };

            my $max_workers = get_max_workers($param, 4);
            my $failed =
                handle_task_foreach_guest($startlist, $max_workers, $start_task, $check_task);

            if (scalar($failed->@*)) {
                die "Some guests failed to shutdown " . join(', ', $failed->@*) . "\n";
            }
        };

        return $rpcenv->fork_worker('bulk-shutdown', undef, $authuser, $code);
    },
});

__PACKAGE__->register_method({
    name => 'suspend',
    path => 'suspend',
    method => 'POST',
    description => "Bulk suspend all guests on the cluster.",
    permissions => {
        description =>
            "The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each"
            . " ID passed via the 'vms' parameter. Additionally, you need 'VM.Config.Disk' on the"
            . " '/vms/{vmid}' path and 'Datastore.AllocateSpace' for the configured state-storage(s)",
        user => 'all',
    },
    protected => 1,
    expose_credentials => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            vms => {
                description => "Only consider guests from this list of VMIDs.",
                type => 'array',
                items => get_standard_option('pve-vmid'),
                optional => 1,
            },
            statestorage => get_standard_option(
                'pve-storage-id',
                {
                    description => "The storage for the VM state.",
                    requires => 'to-disk',
                    optional => 1,
                    completion => \&PVE::Storage::complete_storage_enabled,
                },
            ),
            'to-disk' => {
                description =>
                    "If set, suspends the guests to disk. Will be resumed on next start.",
                type => 'boolean',
                default => 0,
                optional => 1,
            },
            maxworkers => {
                description => "Defines the maximum number of tasks running concurrently."
                    . " Deprecated, use 'max-workers' instead.",
                optional => 1,
                default => 4,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            'max-workers' => {
                description => "Defines the maximum number of tasks running concurrently.",
                optional => 1,
                default => 4,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            # TODO:
            # Failure resolution mode (fail, warn, retry?)
            # mode-limits (offline only, suspend only, ?)
            # filter (tags, name, ?)
        },
    },
    returns => {
        type => 'string',
        description => "UPID of the worker",
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my ($vmlist, $vmlist_string) = extract_vmlist($param);

        check_guest_permissions($rpcenv, $authuser, $vmlist, ['VM.PowerMgmt']);

        if ($param->{'to-disk'}) {
            check_guest_permissions($rpcenv, $authuser, $vmlist, ['VM.Config.Disk']);
            if (my $statestorage = $param->{statestorage}) {
                $rpcenv->check($authuser, "/storage/$statestorage",
                    ['Datastore.AllocateSpace']);
            } else {
                # storage access check will be done by api call itself later
            }
        }

        my $code = sub {
            my $startlist =
                PVE::API2::Nodes::Nodeinfo::get_start_stop_list(undef, undef, $vmlist_string);

            print_start_action($vmlist, "Suspending");

            # reverse order for suspend
            for my $order (keys $startlist->%*) {
                my $list = delete $startlist->{$order};
                $order = $order * -1;
                $startlist->{$order} = $list;
            }

            my $start_task = sub {
                my ($api_client, $vmid, $guest) = @_;
                my $node = $guest->{node};

                if ($guest->{type} ne 'qemu') {
                    log_warn("skipping $vmid, only VMs can be suspended");
                    return 1;
                }

                my $status =
                    eval { make_get_request($api_client, "/nodes/$node/qemu/$vmid/status/current") };
                if (defined($status) && $status->{status} ne 'running') {
                    log_warn("Skipping VM $vmid, not running.\n");
                    return 1;
                }

                my $params = {};
                $params->{'todisk'} = $param->{'to-disk'} // 0;
                $params->{statestorage} = $param->{statestorage}
                    if $param->{'to-disk'} && defined($param->{statestorage});

                my $url = "/nodes/$node/qemu/$vmid/status/suspend";
                print "Suspending VM $vmid\n";
                return $api_client->post($url, $params);
            };

            my $check_task = sub {
                my ($api_client, $vmid, $guest, $is_error, $task) = @_;
                my $node = $guest->{node};
                if ($is_error) {
                    my $err =
                        defined($task) ? $task->{exitstatus} : "could not query task status";
                    my $type_text = get_type_text($guest->{type});
                    log_warn("Stopping $type_text $vmid failed: $err\n");
                }
            };

            my $max_workers = get_max_workers($param, 4);
            my $failed =
                handle_task_foreach_guest($startlist, $max_workers, $start_task, $check_task);

            if (scalar($failed->@*)) {
                die "Some guests failed to suspend " . join(', ', $failed->@*) . "\n";
            }
        };

        return $rpcenv->fork_worker('bulk-suspend', undef, $authuser, $code);
    },
});

__PACKAGE__->register_method({
    name => 'migrate',
    path => 'migrate',
    method => 'POST',
    description => "Bulk migrate all guests on the cluster.",
    permissions => {
        description =>
            "The 'VM.Migrate' permission is required on '/' or on '/vms/<ID>' for each "
            . "ID passed via the 'vms' parameter.",
        user => 'all',
    },
    protected => 1,
    expose_credentials => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            vms => {
                description => "Only consider guests from this list of VMIDs.",
                type => 'array',
                items => get_standard_option('pve-vmid'),
                optional => 1,
            },
            target => get_standard_option('pve-node', { description => "Target node." }),
            online => {
                type => 'boolean',
                description => "Enable live migration for VMs and restart migration for CTs.",
                optional => 1,
            },
            "with-local-disks" => {
                type => 'boolean',
                description => "Enable live storage migration for local disk",
                optional => 1,
            },
            maxworkers => {
                description => "Defines the maximum number of tasks running concurrently."
                    . " Deprecated, use 'max-workers' instead.",
                optional => 1,
                default => 1,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            'max-workers' => {
                description => "Defines the maximum number of tasks running concurrently.",
                optional => 1,
                default => 1,
                type => 'integer',
                minimum => 1,
                maximum => 64,
            },
            # TODO:
            # Node mappings, not just a single target node!
            # Failure resolution mode (fail, warn, retry?)
            # mode-limits (offline only, suspend only, ?)
            # filter (tags, name, ?)
        },
    },
    returns => {
        type => 'string',
        description => "UPID of the worker",
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my ($vmlist, $vmlist_string) = extract_vmlist($param);

        check_guest_permissions($rpcenv, $authuser, $vmlist, ['VM.Migrate']);

        my $code = sub {
            my $list =
                PVE::API2::Nodes::Nodeinfo::get_filtered_vmlist(undef, $vmlist_string, 1, 1);

            print_start_action($vmlist, "Migrating", "to $param->{target}");

            my $start_task = sub {
                my ($api_client, $vmid, $guest) = @_;
                my $node = $guest->{node};

                my $type = $guest->{type};
                my $type_text = get_type_text($type);

                if ($node eq $param->{target}) {
                    log_warn("$type_text $vmid already on $node, skipping.\n");
                    return 1;
                }

                my $params = {
                    target => $param->{target},
                };

                if ($type eq 'lxc') {
                    $params->{restart} = $param->{online} if defined($param->{online});
                } elsif ($type eq 'qemu') {
                    $params->{online} = $param->{online} if defined($param->{online});
                    $params->{'with-local-disks'} = $param->{'with-local-disks'}
                        if defined($param->{'with-local-disks'});
                }

                my $url = "/nodes/$node/$type/$vmid/migrate";
                print "Migrating $type_text $vmid\n";
                return $api_client->post($url, $params);
            };

            my $check_task = sub {
                my ($api_client, $vmid, $guest, $is_error, $task) = @_;
                if ($is_error) {
                    my $err =
                        defined($task) ? $task->{exitstatus} : "could not query task status";
                    my $type_text = get_type_text($guest->{type});
                    log_warn("Migrating $type_text $vmid failed: $err\n");
                }
            };

            my $max_workers = get_max_workers($param);
            my $failed =
                handle_task_foreach_guest({ '0' => $list }, $max_workers, $start_task, $check_task);

            if (scalar($failed->@*)) {
                die "Some guests failed to migrate " . join(', ', $failed->@*) . "\n";
            }
        };

        return $rpcenv->fork_worker('bulk-migrate', undef, $authuser, $code);
    },
});

1;
