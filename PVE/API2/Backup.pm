package PVE::API2::Backup;

use strict;
use warnings;
use Digest::SHA;
use UUID qw(uuid);

use PVE::SafeSyslog;
use PVE::Tools qw(extract_param);
use PVE::Cluster qw(cfs_lock_file cfs_read_file cfs_write_file);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::JSONSchema qw(get_standard_option);
use PVE::Storage;
use PVE::Exception qw(raise_param_exc);
use PVE::VZDump;
use PVE::VZDump::Common;
use PVE::VZDump::JobBase;
use PVE::Jobs; # for VZDump Jobs
use Proxmox::RS::CalendarEvent;

use base qw(PVE::RESTHandler);

use constant ALL_DAYS => 'mon,tue,wed,thu,fri,sat,sun';

PVE::JSONSchema::register_format('pve-day-of-week', \&verify_day_of_week);

sub verify_day_of_week {
    my ($value, $noerr) = @_;

    return $value if $value =~ m/^(mon|tue|wed|thu|fri|sat|sun)$/;

    return undef if $noerr;

    die "invalid day '$value'\n";
}

# NOTE: also used by the vzdump API call.
sub assert_param_permission_common {
    my ($rpcenv, $user, $param, $is_delete) = @_;
    return if $user eq 'root@pam'; # always OK

    for my $key (qw(tmpdir dumpdir script job-id)) {
        raise_param_exc({ $key => "Only root may set this option." }) if exists $param->{$key};
    }

    if (grep { defined($param->{$_}) } qw(bwlimit ionice performance)) {
        $rpcenv->check($user, "/", ['Sys.Modify']);
    }

    if ($param->{fleecing} && !$is_delete) {
        my $fleecing = PVE::VZDump::parse_fleecing($param) // {};
        $rpcenv->check($user, "/storage/$fleecing->{storage}", ['Datastore.AllocateSpace'])
            if $fleecing->{storage};
    }
}

my sub assert_param_permission_create {
    my ($rpcenv, $user, $param) = @_;
    return if $user eq 'root@pam'; # always OK

    assert_param_permission_common($rpcenv, $user, $param);

    if (my $storeid = PVE::VZDump::get_storage_param($param)) {
        $rpcenv->check($user, "/storage/$storeid", ['Datastore.Allocate']);
    }
}

my sub assert_param_permission_update {
    my ($rpcenv, $user, $update, $delete, $current) = @_;
    return if $user eq 'root@pam'; # always OK

    assert_param_permission_common($rpcenv, $user, $update);
    assert_param_permission_common($rpcenv, $user, $delete, 1);

    if ($update->{storage}) {
        $rpcenv->check($user, "/storage/$update->{storage}", ['Datastore.Allocate']);
    } elsif ($delete->{storage}) {
        $rpcenv->check($user, "/storage/local", ['Datastore.Allocate']);
    }

    return if !$current; # early check done

    if ($current->{dumpdir}) {
        die "only root\@pam may edit jobs with a 'dumpdir' option.";
    } else {
        if (my $storeid = PVE::VZDump::get_storage_param($current)) {
            $rpcenv->check($user, "/storage/$storeid", ['Datastore.Allocate']);
        }
    }
}

my $convert_to_schedule = sub {
    my ($job) = @_;

    my $starttime = $job->{starttime};

    return "$starttime" if !$job->{dow}; # dow is restrictive, so none means all days

    # normalize as it could be a null-separated list previously
    my $dow = join(',', PVE::Tools::split_list($job->{dow}));

    return $dow eq ALL_DAYS ? "$starttime" : "$dow $starttime";
};

my $schedule_param_check = sub {
    my ($param, $required) = @_;
    if (defined($param->{schedule})) {
        if (defined($param->{starttime})) {
            raise_param_exc({ starttime => "'starttime' and 'schedule' cannot both be set" });
        }
    } elsif (!defined($param->{starttime})) {
        raise_param_exc({ schedule => "neither 'starttime' nor 'schedule' were set" })
            if $required;
    } else {
        $param->{schedule} = $convert_to_schedule->($param);
    }

    delete $param->{starttime};
    delete $param->{dow};
};

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "List vzdump backup schedule.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                id => get_standard_option('pve-backup-jobid'),
            },
        },
        links => [{ rel => 'child', href => "{id}" }],
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $data = cfs_read_file('vzdump.cron');
        my $jobs_data = cfs_read_file('jobs.cfg');
        my $order = $jobs_data->{order};
        my $jobs = $jobs_data->{ids};

        my $res = $data->{jobs} || [];
        foreach my $job (@$res) {
            $job->{schedule} = $convert_to_schedule->($job);
        }

        foreach my $jobid (sort { $order->{$a} <=> $order->{$b} } keys %$jobs) {
            my $job = $jobs->{$jobid};
            next if $job->{type} ne 'vzdump';

            if (my $schedule = $job->{schedule}) {
                # vzdump jobs are cluster wide, there maybe was no local run
                # so simply calculate from now
                my $last_run = time();
                my $calspec = Proxmox::RS::CalendarEvent->new($schedule);
                my $next_run = $calspec->compute_next_event($last_run);
                $job->{'next-run'} = $next_run if defined($next_run);
            }

            # FIXME remove in PVE 8.0?
            # backwards compat: before moving the job registry to pve-common, id was auto-injected
            $job->{id} = $jobid;

            push @$res, $job;
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'create_job',
    path => '',
    method => 'POST',
    protected => 1,
    description => "Create new vzdump backup job.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
        description =>
            "The 'tmpdir', 'dumpdir' and 'script' parameters are additionally restricted to the 'root\@pam' user.",
    },
    parameters => {
        additionalProperties => 0,
        properties => PVE::VZDump::Common::json_config_properties({
            id => {
                type => 'string',
                description => "Job ID (will be autogenerated).",
                format => 'pve-configid',
                optional => 1, # FIXME: make required on 8.0
            },
            schedule => {
                description =>
                    "Backup schedule. The format is a subset of `systemd` calendar events.",
                type => 'string',
                format => 'pve-calendar-event',
                maxLength => 128,
                optional => 1,
            },
            starttime => {
                type => 'string',
                description => "Job Start time.",
                pattern => '\d{1,2}:\d{1,2}',
                typetext => 'HH:MM',
                optional => 1,
            },
            dow => {
                type => 'string',
                format => 'pve-day-of-week-list',
                optional => 1,
                description => "Day of week selection.",
                requires => 'starttime',
                default => ALL_DAYS,
            },
            enabled => {
                type => 'boolean',
                optional => 1,
                description => "Enable or disable the job.",
                default => '1',
            },
            'repeat-missed' => {
                optional => 1,
                type => 'boolean',
                description =>
                    "If true, the job will be run as soon as possible if it was missed"
                    . " while the scheduler was not running.",
                default => 0,
            },
            comment => {
                optional => 1,
                type => 'string',
                description => "Description for the Job.",
                maxLength => 512,
            },
        }),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        assert_param_permission_create($rpcenv, $user, $param);

        if (my $pool = $param->{pool}) {
            $rpcenv->check_pool_exist($pool);
            $rpcenv->check($user, "/pool/$pool", ['VM.Backup']);
        }

        $schedule_param_check->($param, 1);

        $param->{enabled} = 1 if !defined($param->{enabled});

        # autogenerate id for api compatibility FIXME remove with 8.0
        my $id = extract_param($param, 'id') // UUID::uuid();

        cfs_lock_file(
            'jobs.cfg',
            undef,
            sub {
                my $data = cfs_read_file('jobs.cfg');

                die "Job '$id' already exists\n"
                    if $data->{ids}->{$id};

                PVE::VZDump::verify_vzdump_parameters($param, 1);
                my $opts = PVE::VZDump::JobBase->check_config($id, $param, 1, 1);

                $data->{ids}->{$id} = $opts;

                PVE::Jobs::create_job($id, 'vzdump', $opts);

                cfs_write_file('jobs.cfg', $data);
            },
        );
        die "$@" if ($@);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'read_job',
    path => '{id}',
    method => 'GET',
    description => "Read vzdump backup job definition.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-backup-jobid'),
        },
    },
    returns => {
        type => 'object',
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $data = cfs_read_file('vzdump.cron');

        my $jobs = $data->{jobs} || [];

        foreach my $job (@$jobs) {
            if ($job->{id} eq $param->{id}) {
                $job->{schedule} = $convert_to_schedule->($job);
                return $job;
            }
        }

        my $jobs_data = cfs_read_file('jobs.cfg');
        my $job = $jobs_data->{ids}->{ $param->{id} };
        if ($job && $job->{type} eq 'vzdump') {
            # FIXME remove in PVE 8.0?
            # backwards compat: before moving the job registry to pve-common, id was auto-injected
            $job->{id} = $param->{id};
            return $job;
        }

        raise_param_exc({ id => "No such job '$param->{id}'" });

    },
});

__PACKAGE__->register_method({
    name => 'delete_job',
    path => '{id}',
    method => 'DELETE',
    description => "Delete vzdump backup job definition.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-backup-jobid'),
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $id = $param->{id};

        my $delete_job = sub {
            my $data = cfs_read_file('vzdump.cron');

            my $jobs = $data->{jobs} || [];
            my $newjobs = [];

            my $found;
            foreach my $job (@$jobs) {
                if ($job->{id} eq $id) {
                    $found = 1;
                } else {
                    push @$newjobs, $job;
                }
            }

            if (!$found) {
                cfs_lock_file(
                    'jobs.cfg',
                    undef,
                    sub {
                        my $jobs_data = cfs_read_file('jobs.cfg');

                        if (!defined($jobs_data->{ids}->{$id})) {
                            raise_param_exc({ id => "No such job '$id'" });
                        }
                        delete $jobs_data->{ids}->{$id};

                        PVE::Jobs::remove_job($id, 'vzdump');

                        cfs_write_file('jobs.cfg', $jobs_data);
                    },
                );
                die "$@" if $@;
            } else {
                $data->{jobs} = $newjobs;

                cfs_write_file('vzdump.cron', $data);
            }
        };
        cfs_lock_file('vzdump.cron', undef, $delete_job);
        die "$@" if ($@);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'update_job',
    path => '{id}',
    method => 'PUT',
    protected => 1,
    description => "Update vzdump backup job definition.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
        description =>
            "The 'tmpdir', 'dumpdir' and 'script' parameters are additionally restricted to the 'root\@pam' user.",
    },
    parameters => {
        additionalProperties => 0,
        properties => PVE::VZDump::Common::json_config_properties({
            id => get_standard_option('pve-backup-jobid'),
            schedule => {
                description =>
                    "Backup schedule. The format is a subset of `systemd` calendar events.",
                type => 'string',
                format => 'pve-calendar-event',
                maxLength => 128,
                optional => 1,
            },
            starttime => {
                type => 'string',
                description => "Job Start time.",
                pattern => '\d{1,2}:\d{1,2}',
                typetext => 'HH:MM',
                optional => 1,
            },
            dow => {
                type => 'string',
                format => 'pve-day-of-week-list',
                optional => 1,
                requires => 'starttime',
                description => "Day of week selection.",
            },
            delete => {
                type => 'string',
                format => 'pve-configid-list',
                description => "A list of settings you want to delete.",
                optional => 1,
            },
            enabled => {
                type => 'boolean',
                optional => 1,
                description => "Enable or disable the job.",
                default => '1',
            },
            'repeat-missed' => {
                optional => 1,
                type => 'boolean',
                description =>
                    "If true, the job will be run as soon as possible if it was missed"
                    . " while the scheduler was not running.",
                default => 0,
            },
            comment => {
                optional => 1,
                type => 'string',
                description => "Description for the Job.",
                maxLength => 512,
            },
        }),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $id = extract_param($param, 'id');
        my $delete = extract_param($param, 'delete');
        $delete = { map { $_ => 1 } PVE::Tools::split_list($delete) } if $delete;

        assert_param_permission_update($rpcenv, $user, $param, $delete);

        if (my $pool = $param->{pool}) {
            $rpcenv->check_pool_exist($pool);
            $rpcenv->check($user, "/pool/$pool", ['VM.Backup']);
        }

        $schedule_param_check->($param);

        my $update_job = sub {
            my $data = cfs_read_file('vzdump.cron');
            my $jobs_data = cfs_read_file('jobs.cfg');

            my $jobs = $data->{jobs} || [];

            die "no options specified\n"
                if !scalar(keys $param->%*) && !scalar(keys $delete->%*);

            PVE::VZDump::verify_vzdump_parameters($param);
            my $opts = PVE::VZDump::JobBase->check_config($id, $param, 0, 1);

            # try to find it in old vzdump.cron and convert it to a job
            my ($idx) = grep { $jobs->[$_]->{id} eq $id } (0 .. scalar(@$jobs) - 1);

            my $job;
            if (defined($idx)) {
                $job = splice @$jobs, $idx, 1;
                $job->{schedule} = $convert_to_schedule->($job);
                delete $job->{starttime};
                delete $job->{dow};
                delete $job->{id};
                $job->{type} = 'vzdump';
                $jobs_data->{ids}->{$id} = $job;
            } else {
                $job = $jobs_data->{ids}->{$id};
                die "no such vzdump job\n" if !$job || $job->{type} ne 'vzdump';
            }

            assert_param_permission_update($rpcenv, $user, $param, $delete, $job);

            my $deletable = {
                comment => 1,
                'repeat-missed' => 1,
            };

            for my $k (keys $delete->%*) {
                if (!PVE::VZDump::option_exists($k) && !$deletable->{$k}) {
                    raise_param_exc({ delete => "unknown option '$k'" });
                }

                delete $job->{$k};
            }

            foreach my $k (keys %$param) {
                $job->{$k} = $param->{$k};
            }

            $job->{all} = 1 if (defined($job->{exclude}) && !defined($job->{pool}));

            if (defined($param->{vmid})) {
                delete $job->{all};
                delete $job->{exclude};
                delete $job->{pool};
            } elsif ($param->{all}) {
                delete $job->{vmid};
                delete $job->{pool};
            } elsif ($job->{pool}) {
                delete $job->{vmid};
                delete $job->{all};
                delete $job->{exclude};
            }

            PVE::VZDump::verify_vzdump_parameters($job, 1);

            if (defined($idx)) {
                cfs_write_file('vzdump.cron', $data);
            }
            cfs_write_file('jobs.cfg', $jobs_data);

            PVE::Jobs::detect_changed_runtime_props($id, 'vzdump', $job);

            return;
        };
        cfs_lock_file(
            'vzdump.cron',
            undef,
            sub {
                cfs_lock_file('jobs.cfg', undef, $update_job);
                die "$@" if ($@);
            },
        );
        die "$@" if ($@);
    },
});

__PACKAGE__->register_method({
    name => 'get_volume_backup_included',
    path => '{id}/included_volumes',
    method => 'GET',
    protected => 1,
    description =>
        "Returns included guests and the backup status of their disks. Optimized to be used in ExtJS tree views.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-backup-jobid'),
        },
    },
    returns => {
        type => 'object',
        description =>
            'Root node of the tree object. Children represent guests, grandchildren represent volumes of that guest.',
        properties => {
            children => {
                type => 'array',
                items => {
                    type => 'object',
                    properties => {
                        id => {
                            type => 'integer',
                            description => 'VMID of the guest.',
                        },
                        name => {
                            type => 'string',
                            description => 'Name of the guest',
                            optional => 1,
                        },
                        type => {
                            type => 'string',
                            description =>
                                'Type of the guest, VM, CT or unknown for removed but not purged guests.',
                            enum => ['qemu', 'lxc', 'unknown'],
                        },
                        children => {
                            type => 'array',
                            optional => 1,
                            description =>
                                'The volumes of the guest with the information if they will be included in backups.',
                            items => {
                                type => 'object',
                                properties => {
                                    id => {
                                        type => 'string',
                                        description => 'Configuration key of the volume.',
                                    },
                                    name => {
                                        type => 'string',
                                        description => 'Name of the volume.',
                                    },
                                    included => {
                                        type => 'boolean',
                                        description =>
                                            'Whether the volume is included in the backup or not.',
                                    },
                                    reason => {
                                        type => 'string',
                                        description =>
                                            'The reason why the volume is included (or excluded).',
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $user = $rpcenv->get_user();

        my $vzconf = cfs_read_file('vzdump.cron');
        my $all_jobs = $vzconf->{jobs} || [];
        my $job;

        for my $j (@$all_jobs) {
            if ($j->{id} eq $param->{id}) {
                $job = $j;
                last;
            }
        }
        if (!$job) {
            my $jobs_data = cfs_read_file('jobs.cfg');
            my $j = $jobs_data->{ids}->{ $param->{id} };
            if ($j && $j->{type} eq 'vzdump') {
                $job = $j;
            }
        }
        raise_param_exc({ id => "No such job '$param->{id}'" }) if !$job;

        my $vmlist = PVE::Cluster::get_vmlist();

        my @job_vmids;

        my $included_guests = PVE::VZDump::get_included_guests($job);

        for my $node (keys %{$included_guests}) {
            my $node_vmids = $included_guests->{$node};
            push(@job_vmids, @{$node_vmids});
        }

        # remove VMIDs to which the user has no permission to not leak infos
        # like the guest name
        my @allowed_vmids = grep {
            $rpcenv->check($user, "/vms/$_", ['VM.Audit'], 1);
        } @job_vmids;

        my $result = {
            children => [],
        };

        for my $vmid (@allowed_vmids) {

            my $children = [];

            # It's possible that a job has VMIDs configured that are not in
            # vmlist. This could be because a guest was removed but not purged.
            # Since there is no more data available we can only deliver the VMID
            # and no volumes.
            if (!defined $vmlist->{ids}->{$vmid}) {
                push(
                    @{ $result->{children} },
                    {
                        id => int($vmid),
                        type => 'unknown',
                        leaf => 1,
                    },
                );
                next;
            }

            my $type = $vmlist->{ids}->{$vmid}->{type};
            my $node = $vmlist->{ids}->{$vmid}->{node};

            my $conf;
            my $volumes;
            my $name = "";

            if ($type eq 'qemu') {
                $conf = PVE::QemuConfig->load_config($vmid, $node);
                $volumes = PVE::QemuConfig->get_backup_volumes($conf);
                $name = $conf->{name};
            } elsif ($type eq 'lxc') {
                $conf = PVE::LXC::Config->load_config($vmid, $node);
                $volumes = PVE::LXC::Config->get_backup_volumes($conf);
                $name = $conf->{hostname};
            } else {
                die "VMID $vmid is neither Qemu nor LXC guest\n";
            }

            foreach my $volume (@$volumes) {
                my $disk = {
                    # id field must be unique for ExtJS tree view
                    id => "$vmid:$volume->{key}",
                    name => $volume->{volume_config}->{file}
                        // $volume->{volume_config}->{volume},
                    included => $volume->{included},
                    reason => $volume->{reason},
                    leaf => 1,
                };
                push(@{$children}, $disk);
            }

            my $leaf = 0;
            # it's possible for a guest to have no volumes configured
            $leaf = 1 if !@{$children};

            push(
                @{ $result->{children} },
                {
                    id => int($vmid),
                    type => $type,
                    name => $name,
                    children => $children,
                    leaf => $leaf,
                },
            );
        }

        return $result;
    },
});

1;
