package PVE::API2::Ceph::MGR;

use strict;
use warnings;

use File::Path;

use PVE::Ceph::Tools;
use PVE::Ceph::Services;
use PVE::Cluster qw(cfs_read_file);
use PVE::JSONSchema qw(get_standard_option);
use PVE::RADOS;
use PVE::RPCEnvironment;
use PVE::Tools qw(run_command);

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "MGR directory index.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    proxyto => 'node',
    protected => 1,
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
                    description => "The name (ID) for the MGR",
                    type => 'string',
                },
                addr => {
                    type => 'string',
                    optional => 1,
                },
                host => {
                    type => 'string',
                    optional => 1,
                },
                state => {
                    type => 'string',
                    description => 'State of the MGR',
                },
            },
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $res = [];

        my $cfg = cfs_read_file('ceph.conf');
        my $rados = PVE::RADOS->new();

        my $mgr_hash = PVE::Ceph::Services::get_services_info("mgr", $cfg, $rados);

        my $mgr_dump = $rados->mon_command({ prefix => 'mgr dump' });

        my $active_name = $mgr_dump->{active_name};
        $mgr_hash->{$active_name}->{state} = 'active' if $active_name;

        foreach my $mgr (@{ $mgr_dump->{standbys} }) {
            $mgr_hash->{ $mgr->{name} }->{state} = 'standby';
        }

        return PVE::RESTHandler::hash_to_array($mgr_hash, 'name');
    },
});

__PACKAGE__->register_method({
    name => 'createmgr',
    path => '{id}',
    method => 'POST',
    description => "Create Ceph Manager",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            id => {
                type => 'string',
                optional => 1,
                pattern => PVE::Ceph::Services::SERVICE_REGEX,
                maxLength => 200,
                description => "The ID for the manager, when omitted the same as the nodename",
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_installed('ceph_mgr');
        PVE::Ceph::Tools::check_ceph_inited();
        PVE::Ceph::Tools::setup_pve_symlinks();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $mgrid = $param->{id} // $param->{node};

        my $worker = sub {
            my $upid = shift;

            my $rados_timeout = PVE::Ceph::Tools::get_config('long_rados_timeout');
            my $rados = PVE::RADOS->new(timeout => $rados_timeout);

            PVE::Ceph::Services::create_mgr($mgrid, $rados);
        };

        return $rpcenv->fork_worker('cephcreatemgr', "mgr.$mgrid", $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'destroymgr',
    path => '{id}',
    method => 'DELETE',
    description => "Destroy Ceph Manager.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            id => {
                description => 'The ID of the manager',
                type => 'string',
                pattern => PVE::Ceph::Services::SERVICE_REGEX,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        PVE::Ceph::Tools::check_ceph_inited();

        my $mgrid = $param->{id};

        my $worker = sub {
            my $upid = shift;

            PVE::Ceph::Services::destroy_mgr($mgrid);
        };

        return $rpcenv->fork_worker('cephdestroymgr', "mgr.$mgrid", $authuser, $worker);
    },
});
