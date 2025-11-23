package PVE::API2::Cluster::MetricServer;

use warnings;
use strict;

use PVE::APIClient::LWP;
use PVE::AccessControl;
use PVE::Cluster;
use PVE::INotify;
use PVE::RPCEnvironment;
use PVE::SafeSyslog;
use PVE::Tools qw(extract_param extract_sensitive_params);

use PVE::ExtMetric;
use PVE::PullMetric;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Metrics index.",
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

        my $result = [
            { name => 'server' },
        ];

        return $result;
    },
});

__PACKAGE__->register_method({
    name => 'server_index',
    path => 'server',
    method => 'GET',
    description => "List configured metric servers.",
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
                id => {
                    description => "The ID of the entry.",
                    type => 'string',
                },
                disable => {
                    description => "Flag to disable the plugin.",
                    type => 'boolean',
                },
                type => {
                    description => "Plugin type.",
                    type => 'string',
                },
                server => {
                    description => "Server dns name or IP address",
                    type => 'string',
                },
                port => {
                    description => "Server network port",
                    type => 'integer',
                },
            },
        },
        links => [{ rel => 'child', href => "{id}" }],
    },
    code => sub {
        my ($param) = @_;

        my $res = [];
        my $status_cfg = PVE::Cluster::cfs_read_file('status.cfg');

        for my $id (sort keys %{ $status_cfg->{ids} }) {
            my $plugin_config = $status_cfg->{ids}->{$id};
            push @$res,
                {
                    id => $id,
                    disable => $plugin_config->{disable} // 0,
                    type => $plugin_config->{type},
                    server => $plugin_config->{server},
                    port => $plugin_config->{port},
                };
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'read',
    path => 'server/{id}',
    method => 'GET',
    description => "Read metric server configuration.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            id => {
                type => 'string',
                format => 'pve-configid',
            },
        },
    },
    returns => { type => 'object' },
    code => sub {
        my ($param) = @_;

        my $status_cfg = PVE::Cluster::cfs_read_file('status.cfg');
        my $id = $param->{id};

        if (!defined($status_cfg->{ids}->{$id})) {
            die "status server entry '$id' does not exist\n";
        }

        return $status_cfg->{ids}->{$id};
    },
});

__PACKAGE__->register_method({
    name => 'create',
    path => 'server/{id}',
    protected => 1,
    method => 'POST',
    description => "Create a new external metric server config",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => PVE::Status::Plugin->createSchema(),
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $type = extract_param($param, 'type');
        my $plugin = PVE::Status::Plugin->lookup($type);
        my $id = extract_param($param, 'id');

        my $sensitive_params = extract_sensitive_params($param, ['token'], []);

        PVE::Cluster::cfs_lock_file(
            'status.cfg',
            undef,
            sub {
                my $cfg = PVE::Cluster::cfs_read_file('status.cfg');

                die "Metric server '$id' already exists\n"
                    if $cfg->{ids}->{$id};

                my $opts = $plugin->check_config($id, $param, 1, 1);

                $cfg->{ids}->{$id} = $opts;

                $plugin->on_add_hook($id, $opts, $sensitive_params);

                eval { $plugin->test_connection($opts, $id); };

                if (my $err = $@) {
                    eval { $plugin->on_delete_hook($id, $opts) };
                    warn "$@\n" if $@;
                    die $err;
                }

                PVE::Cluster::cfs_write_file('status.cfg', $cfg);
            },
        );
        die $@ if $@;

        return;
    },
});

__PACKAGE__->register_method({
    name => 'update',
    protected => 1,
    path => 'server/{id}',
    method => 'PUT',
    description => "Update metric server configuration.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => PVE::Status::Plugin->updateSchema(),
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');
        my $digest = extract_param($param, 'digest');
        my $delete = extract_param($param, 'delete');

        if ($delete) {
            $delete = [PVE::Tools::split_list($delete)];
        }

        my $sensitive_params = extract_sensitive_params($param, ['token'], $delete);

        PVE::Cluster::cfs_lock_file(
            'status.cfg',
            undef,
            sub {
                my $cfg = PVE::Cluster::cfs_read_file('status.cfg');

                PVE::SectionConfig::assert_if_modified($cfg, $digest);

                my $data = $cfg->{ids}->{$id};
                die "no such server '$id'\n" if !$data;

                my $plugin = PVE::Status::Plugin->lookup($data->{type});
                my $opts = $plugin->check_config($id, $param, 0, 1);

                for my $k (keys %$opts) {
                    $data->{$k} = $opts->{$k};
                }

                if ($delete) {
                    my $options = $plugin->private()->{options}->{ $data->{type} };
                    for my $k (@$delete) {
                        my $d = $options->{$k} || die "no such option '$k'\n";
                        die "unable to delete required option '$k'\n" if !$d->{optional};
                        die "unable to delete fixed option '$k'\n" if $d->{fixed};
                        die "cannot set and delete property '$k' at the same time!\n"
                            if defined($opts->{$k});

                        delete $data->{$k};
                    }
                }

                $plugin->on_update_hook($id, $data, $sensitive_params);

                $plugin->test_connection($data, $id);

                PVE::Cluster::cfs_write_file('status.cfg', $cfg);
            },
        );
        die $@ if $@;

        return;
    },
});

__PACKAGE__->register_method({
    name => 'delete',
    protected => 1,
    path => 'server/{id}',
    method => 'DELETE',
    description => "Remove Metric server.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            id => {
                type => 'string',
                format => 'pve-configid',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        PVE::Cluster::cfs_lock_file(
            'status.cfg',
            undef,
            sub {
                my $cfg = PVE::Cluster::cfs_read_file('status.cfg');

                my $id = $param->{id};

                my $plugin_cfg = $cfg->{ids}->{$id};

                my $plugin = PVE::Status::Plugin->lookup($plugin_cfg->{type});

                $plugin->on_delete_hook($id, $plugin_cfg);

                delete $cfg->{ids}->{$id};
                PVE::Cluster::cfs_write_file('status.cfg', $cfg);
            },
        );
        die $@ if $@;

        return;
    },
});

__PACKAGE__->register_method({
    name => 'export',
    path => 'export',
    method => 'GET',
    expose_credentials => 1,
    description => "Retrieve metrics of the cluster.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            'local-only' => {
                type => 'boolean',
                description =>
                    'Only return metrics for the current node instead of the whole cluster',
                optional => 1,
                default => 0,
            },
            'node-list' => {
                type => 'string',
                description => 'Only return metrics from nodes passed as comma-separated list',
                optional => 1,
            },
            'start-time' => {
                type => 'integer',
                description => 'Only include metrics with a timestamp > start-time.',
                optional => 1,
                default => 0,
            },
            'history' => {
                type => 'boolean',
                description => 'Also return historic values.'
                    . ' Returns full available metric history unless `start-time` is also set',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => {
        type => 'object',
        additionalProperties => 0,
        properties => {
            data => {
                type => 'array',
                description =>
                    'Array of system metrics. Metrics are sorted by their timestamp.',
                items => {
                    type => 'object',
                    additionalProperties => 0,
                    properties => {
                        timestamp => {
                            type => 'integer',
                            description => 'Time at which this metric was observed',
                        },
                        id => {
                            type => 'string',
                            description => "Unique identifier for this metric object,"
                                . " for instance 'node/<nodename>' or"
                                . " 'qemu/<vmid>'.",
                        },
                        metric => {
                            type => 'string',
                            description => "Name of the metric.",
                        },
                        value => {
                            type => 'number',
                            description => 'Metric value.',
                        },
                        type => {
                            type => 'string',
                            description => 'Type of the metric.',
                            enum => [qw(gauge counter derive)],
                        },
                    },
                },

            },

        },
    },
    code => sub {
        my ($param) = @_;
        my $local_only = $param->{'local-only'} // 0;
        my $start = $param->{'start-time'};
        my $history = $param->{'history'} // 0;

        my $now = time();

        my $generations;
        if ($history) {
            # Assuming update loop time of pvestatd of 10 seconds.
            if (defined($start)) {
                my $delta = $now - $start;
                $generations = int($delta / 10);
            } else {
                $generations = PVE::PullMetric::max_generations();
            }

        } else {
            $generations = 0;
        }

        my @node_list =
            $param->{'node-list'} ? PVE::Tools::split_list($param->{'node-list'}) : ();

        my $nodename = PVE::INotify::nodename();
        my $include_local_metrics =
            !$param->{'node-list'} || grep { $nodename eq $_ } @node_list;

        my @metrics;
        if ($include_local_metrics) {
            @metrics = @{ PVE::PullMetric::get_local_metrics($generations) };

            if (defined($start)) {
                @metrics = grep {
                    $_->{timestamp} > ($start)
                } @metrics;
            }
        }

        # Fan out to cluster members
        # Do NOT remove this check
        if (!$local_only || @node_list) {
            my $members = PVE::Cluster::get_members();

            @node_list = keys $members->%* if !@node_list;

            if (my @unknown_nodes = grep { !exists($members->{$_}) } @node_list) {
                die "Requested node-list contains unknown nodes - "
                    . join(', ', @unknown_nodes) . "\n";
            }

            my $rpcenv = PVE::RPCEnvironment::get();
            my $authuser = $rpcenv->get_user();
            my $credentials = $rpcenv->get_credentials();

            for my $name (@node_list) {
                if ($name eq $nodename) {
                    # Skip own node, for that one we already have the metrics
                    next;
                }

                if (!$members->{$name}->{online}) {
                    next;
                }

                my $status = eval {
                    my $fingerprint = PVE::Cluster::get_node_fingerprint($name);
                    my $ip = scalar(PVE::Cluster::remote_node_ip($name));

                    my $conn_args = {
                        protocol => 'https',
                        host => $ip,
                        port => 8006,
                        ticket => $credentials->{ticket},
                        api_token => $credentials->{api_token},
                        timeout => 20,
                    };

                    $conn_args->{cached_fingerprints} = { $fingerprint => 1 };

                    my $api_client = PVE::APIClient::LWP->new(%$conn_args);

                    my $params = {
                        # Do NOT remove 'local-only' - potential for request recursion!
                        'local-only' => 1,
                        history => $history,
                    };
                    $params->{'start-time'} = $start if defined($start);

                    $api_client->get('/cluster/metrics/export', $params);
                };

                if ($@) {
                    syslog('warning', "could not fetch metrics from $name: $@");
                } else {
                    push @metrics, $status->{data}->@*;
                }
            }
        }

        my @sorted = sort { $a->{timestamp} <=> $b->{timestamp} } @metrics;

        return {
            data => \@sorted,
        };
    },
});

1;
