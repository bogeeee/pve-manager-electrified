package PVE::API2::Ceph;

use strict;
use warnings;

use File::Path;
use Net::IP;
use UUID;

use PVE::Ceph::Tools;
use PVE::Ceph::Services;
use PVE::Cluster qw(cfs_read_file cfs_write_file);
use PVE::JSONSchema qw(get_standard_option);
use PVE::Network;
use PVE::RADOS;
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::Storage;
use PVE::Tools qw(run_command file_get_contents file_set_contents extract_param);

use PVE::API2::Ceph::Cfg;
use PVE::API2::Ceph::OSD;
use PVE::API2::Ceph::FS;
use PVE::API2::Ceph::MDS;
use PVE::API2::Ceph::MGR;
use PVE::API2::Ceph::MON;
use PVE::API2::Ceph::Pool;
use PVE::API2::Storage::Config;

use base qw(PVE::RESTHandler);

my $pve_osd_default_journal_size = 1024 * 5;

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::Cfg",
    path => 'cfg',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::OSD",
    path => 'osd',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::MDS",
    path => 'mds',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::MGR",
    path => 'mgr',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::MON",
    path => 'mon',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::FS",
    path => 'fs',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Ceph::Pool",
    path => 'pool',
});

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Directory index.",
    permissions => { user => 'all' },
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
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
            { name => 'cmd-safety' },
            { name => 'cfg' },
            { name => 'crush' },
            { name => 'fs' },
            { name => 'init' },
            { name => 'log' },
            { name => 'mds' },
            { name => 'mgr' },
            { name => 'mon' },
            { name => 'osd' },
            { name => 'pool' },
            { name => 'restart' },
            { name => 'rules' },
            { name => 'start' },
            { name => 'status' },
            { name => 'stop' },
        ];

        return $result;
    },
});

__PACKAGE__->register_method({
    name => 'init',
    path => 'init',
    method => 'POST',
    description => "Create initial ceph default configuration and setup symlinks.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            network => {
                description => "Use specific network for all ceph related traffic",
                type => 'string',
                format => 'CIDR',
                optional => 1,
                maxLength => 128,
            },
            'cluster-network' => {
                description => "Declare a separate cluster network, OSDs will route"
                    . "heartbeat, object replication and recovery traffic over it",
                type => 'string',
                format => 'CIDR',
                requires => 'network',
                optional => 1,
                maxLength => 128,
            },
            size => {
                description => 'Targeted number of replicas per object',
                type => 'integer',
                default => 3,
                optional => 1,
                minimum => 1,
                maximum => 7,
            },
            min_size => {
                description => 'Minimum number of available replicas per object to allow I/O',
                type => 'integer',
                default => 2,
                optional => 1,
                minimum => 1,
                maximum => 7,
            },
            # TODO: deprecrated, remove with PVE 9
            pg_bits => {
                description => "Placement group bits, used to specify the "
                    . "default number of placement groups.\n\nDepreacted. This "
                    . "setting was deprecated in recent Ceph versions.",
                type => 'integer',
                default => 6,
                optional => 1,
                minimum => 6,
                maximum => 14,
            },
            disable_cephx => {
                description => "Disable cephx authentication.\n\n"
                    . "WARNING: cephx is a security feature protecting against "
                    . "man-in-the-middle attacks. Only consider disabling cephx "
                    . "if your network is private!",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $version = PVE::Ceph::Tools::get_local_version(1);

        if (!$version || $version < 14) {
            die "Ceph Nautilus required - please run 'pveceph install'\n";
        } else {
            PVE::Ceph::Tools::check_ceph_installed('ceph_bin');
        }

        my $pve_ceph_cfgdir = PVE::Ceph::Tools::get_config('pve_ceph_cfgdir');
        if (!-d $pve_ceph_cfgdir) {
            File::Path::make_path($pve_ceph_cfgdir);
        }

        my $auth = $param->{disable_cephx} ? 'none' : 'cephx';

        # simply load old config if it already exists
        PVE::Cluster::cfs_lock_file(
            'ceph.conf',
            undef,
            sub {
                my $cfg = cfs_read_file('ceph.conf');

                if (!$cfg->{global}) {

                    my $fsid;
                    my $uuid;

                    UUID::generate($uuid);
                    UUID::unparse($uuid, $fsid);

                    $cfg->{global} = {
                        'fsid' => $fsid,
                        'auth_cluster_required' => $auth,
                        'auth_service_required' => $auth,
                        'auth_client_required' => $auth,
                        'osd_pool_default_size' => $param->{size} // 3,
                        'osd_pool_default_min_size' => $param->{min_size} // 2,
                        'mon_allow_pool_delete' => 'true',
                    };

                    # this does not work for default pools
                    #'osd pool default pg num' => $pg_num,
                    #'osd pool default pgp num' => $pg_num,
                }

                if ($auth eq 'cephx') {
                    $cfg->{client}->{keyring} = '/etc/pve/priv/$cluster.$name.keyring';
                }

                if ($param->{network}) {
                    $cfg->{global}->{'public_network'} = $param->{network};
                    $cfg->{global}->{'cluster_network'} = $param->{network};
                }

                if ($param->{'cluster-network'}) {
                    $cfg->{global}->{'cluster_network'} = $param->{'cluster-network'};
                }

                cfs_write_file('ceph.conf', $cfg);

                if ($auth eq 'cephx') {
                    PVE::Ceph::Tools::get_or_create_admin_keyring();
                }
                PVE::Ceph::Tools::setup_pve_symlinks();
            },
        );
        die $@ if $@;

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'stop',
    path => 'stop',
    method => 'POST',
    description => "Stop ceph services.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => {
                description => 'Ceph service name.',
                type => 'string',
                optional => 1,
                default => 'ceph.target',
                pattern => '(ceph|mon|mds|osd|mgr)(\.'
                    . PVE::Ceph::Services::SERVICE_REGEX . ')?',
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        PVE::Ceph::Tools::check_ceph_inited();

        my $cfg = cfs_read_file('ceph.conf');
        scalar(keys %$cfg) || die "no configuration\n";

        my $worker = sub {
            my $upid = shift;

            my $cmd = ['stop'];
            if ($param->{service}) {
                push @$cmd, $param->{service};
            }

            PVE::Ceph::Services::ceph_service_cmd(@$cmd);
        };

        return $rpcenv->fork_worker('srvstop', $param->{service} || 'ceph', $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'start',
    path => 'start',
    method => 'POST',
    description => "Start ceph services.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => {
                description => 'Ceph service name.',
                type => 'string',
                optional => 1,
                default => 'ceph.target',
                pattern => '(ceph|mon|mds|osd|mgr)(\.'
                    . PVE::Ceph::Services::SERVICE_REGEX . ')?',
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        PVE::Ceph::Tools::check_ceph_inited();

        my $cfg = cfs_read_file('ceph.conf');
        scalar(keys %$cfg) || die "no configuration\n";

        my $worker = sub {
            my $upid = shift;

            my $cmd = ['start'];
            if ($param->{service}) {
                push @$cmd, $param->{service};
            }

            PVE::Ceph::Services::ceph_service_cmd(@$cmd);
        };

        return $rpcenv->fork_worker('srvstart', $param->{service} || 'ceph',
            $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'restart',
    path => 'restart',
    method => 'POST',
    description => "Restart ceph services.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => {
                description => 'Ceph service name.',
                type => 'string',
                optional => 1,
                default => 'ceph.target',
                pattern => '(mon|mds|osd|mgr)(\.' . PVE::Ceph::Services::SERVICE_REGEX . ')?',
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        PVE::Ceph::Tools::check_ceph_inited();

        my $cfg = cfs_read_file('ceph.conf');
        scalar(keys %$cfg) || die "no configuration\n";

        my $worker = sub {
            my $upid = shift;

            my $cmd = ['restart'];
            if ($param->{service}) {
                push @$cmd, $param->{service};
            }

            PVE::Ceph::Services::ceph_service_cmd(@$cmd);
        };

        return $rpcenv->fork_worker('srvrestart', $param->{service} || 'ceph',
            $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'status',
    path => 'status',
    method => 'GET',
    description => "Get ceph status.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => { type => 'object' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        return PVE::Ceph::Tools::ceph_cluster_status();
    },
});

__PACKAGE__->register_method({
    name => 'crush',
    path => 'crush',
    method => 'GET',
    description => "Get OSD crush map",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        # this produces JSON (difficult to read for the user)
        # my $txt = &$run_ceph_cmd_text(['osd', 'crush', 'dump'], quiet => 1);

        my $txt = '';

        my $mapfile = "/var/tmp/ceph-crush.map.$$";
        my $mapdata = "/var/tmp/ceph-crush.txt.$$";

        my $rados = PVE::RADOS->new();

        eval {
            my $bindata =
                $rados->mon_command({ prefix => 'osd getcrushmap', format => 'plain' });
            file_set_contents($mapfile, $bindata);
            run_command(['crushtool', '-d', $mapfile, '-o', $mapdata]);
            $txt = file_get_contents($mapdata);
        };
        my $err = $@;

        unlink $mapfile;
        unlink $mapdata;

        die $err if $err;

        return $txt;
    },
});

__PACKAGE__->register_method({
    name => 'log',
    path => 'log',
    method => 'GET',
    description => "Read ceph log",
    proxyto => 'node',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Syslog']],
    },
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            start => {
                type => 'integer',
                minimum => 0,
                optional => 1,
            },
            limit => {
                type => 'integer',
                minimum => 0,
                optional => 1,
            },
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                n => {
                    description => "Line number",
                    type => 'integer',
                },
                t => {
                    description => "Line text",
                    type => 'string',
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        my $node = $param->{node};

        my $logfile = "/var/log/ceph/ceph.log";
        my ($count, $lines) =
            PVE::Tools::dump_logfile($logfile, $param->{start}, $param->{limit});

        $rpcenv->set_result_attrib('total', $count);

        return $lines;
    },
});

__PACKAGE__->register_method({
    name => 'rules',
    path => 'rules',
    method => 'GET',
    description => "List ceph rules.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                name => {
                    description => "Name of the CRUSH rule.",
                    type => "string",
                },
            },
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados = PVE::RADOS->new();

        my $rules = $rados->mon_command({ prefix => 'osd crush rule ls' });

        my $res = [];

        foreach my $rule (@$rules) {
            push @$res, { name => $rule };
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'cmd_safety',
    path => 'cmd-safety',
    method => 'GET',
    description => "Heuristical check if it is safe to perform an action.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => {
                description => 'Service type',
                type => 'string',
                enum => ['osd', 'mon', 'mds'],
            },
            id => {
                description => 'ID of the service',
                type => 'string',
            },
            action => {
                description => 'Action to check',
                type => 'string',
                enum => ['stop', 'destroy'],
            },
        },
    },
    returns => {
        type => 'object',
        properties => {
            safe => {
                type => 'boolean',
                description => 'If it is safe to run the command.',
            },
            status => {
                type => 'string',
                optional => 1,
                description => 'Status message given by Ceph.',
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $id = $param->{id};
        my $service = $param->{service};
        my $action = $param->{action};

        my $rados = PVE::RADOS->new();

        my $supported_actions = {
            osd => {
                stop => 'ok-to-stop',
                destroy => 'safe-to-destroy',
            },
            mon => {
                stop => 'ok-to-stop',
                destroy => 'ok-to-rm',
            },
            mds => {
                stop => 'ok-to-stop',
            },
        };

        die "Service does not support this action: ${service}: ${action}\n"
            if !$supported_actions->{$service}->{$action};

        my $result = {
            safe => 0,
            status => '',
        };

        my $params = {
            prefix => "${service} $supported_actions->{$service}->{$action}",
            format => 'plain',
        };
        if ($service eq 'mon' && $action eq 'destroy') {
            $params->{id} = $id;
        } else {
            $params->{ids} = [$id];
        }

        $result = $rados->mon_cmd($params, 1);
        die $@ if $@;

        $result->{safe} = $result->{return_code} == 0 ? 1 : 0;
        $result->{status} = $result->{status_message};

        return $result;
    },
});

1;
