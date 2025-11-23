package PVE::API2::Ceph::MDS;

use strict;
use warnings;

use PVE::Ceph::Tools;
use PVE::Ceph::Services;
use PVE::Cluster qw(cfs_read_file cfs_write_file);
use PVE::INotify;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RADOS;
use PVE::RESTHandler;
use PVE::RPCEnvironment;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "MDS directory index.",
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
                    description => "The name (ID) for the MDS",
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
                    description => 'State of the MDS',
                },
                standby_replay => {
                    type => 'boolean',
                    optional => 1,
                    description =>
                        'If true, the standby MDS is polling the active MDS for faster recovery (hot standby).',
                },
                rank => {
                    type => 'integer',
                    optional => 1,
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

        my $mds_hash = PVE::Ceph::Services::get_services_info("mds", $cfg, $rados);

        my $mds_state = PVE::Ceph::Services::get_cluster_mds_state($rados);
        foreach my $name (keys %$mds_state) {
            my $d = $mds_state->{$name};
            # just overwrite, this always provides more info
            $mds_hash->{$name}->{$_} = $d->{$_} for keys %$d;
        }

        return PVE::RESTHandler::hash_to_array($mds_hash, 'name');
    },
});

__PACKAGE__->register_method({
    name => 'createmds',
    path => '{name}',
    method => 'POST',
    description => "Create Ceph Metadata Server (MDS)",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            name => {
                type => 'string',
                optional => 1,
                default => 'nodename',
                pattern => PVE::Ceph::Services::SERVICE_REGEX,
                maxLength => 200,
                description => "The ID for the mds, when omitted the same as the nodename",
            },
            hotstandby => {
                type => 'boolean',
                optional => 1,
                default => '0',
                description =>
                    "Determines whether a ceph-mds daemon should poll and replay the log of an active MDS. "
                    . "Faster switch on MDS failure, but needs more idle resources.",
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_installed('ceph_mds');

        PVE::Ceph::Tools::check_ceph_inited();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $nodename = $param->{node};
        $nodename = INotify::nodename() if $nodename eq 'localhost';

        my $mds_id = $param->{name} // $nodename;

        die "ID of the MDS cannot start with a number!\n" if ($mds_id =~ /^[0-9]/);

        my $worker = sub {
            my $timeout = PVE::Ceph::Tools::get_config('long_rados_timeout');
            my $rados = PVE::RADOS->new(timeout => $timeout);

            my $cfg = cfs_read_file('ceph.conf');

            my $section = "mds.$mds_id";

            if (defined($cfg->{$section})) {
                die "MDS '$mds_id' already referenced in ceph config, abort!\n";
            }

            if (!defined($cfg->{mds}->{keyring})) {
                # $id isn't a perl variable but a ceph metavariable
                my $keyring = '/var/lib/ceph/mds/ceph-$id/keyring';

                $cfg->{mds}->{keyring} = $keyring;
            }

            $cfg->{$section}->{host} = $nodename;
            $cfg->{$section}->{'mds_standby_for_name'} = 'pve';

            if ($param->{hotstandby}) {
                $cfg->{$section}->{'mds_standby_replay'} = 'true';
            }

            cfs_write_file('ceph.conf', $cfg);

            eval { PVE::Ceph::Services::create_mds($mds_id, $rados) };
            if (my $err = $@) {
                # we abort early if the section is defined, so we know that we
                # wrote it at this point. Do not auto remove the service, could
                # do real harm for previously manual setup MDS
                warn "Encountered error, remove '$section' from ceph.conf\n";
                my $cfg = cfs_read_file('ceph.conf');
                delete $cfg->{$section};
                cfs_write_file('ceph.conf', $cfg);

                die "$err\n";
            }
        };

        return $rpcenv->fork_worker('cephcreatemds', "mds.$mds_id", $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'destroymds',
    path => '{name}',
    method => 'DELETE',
    description => "Destroy Ceph Metadata Server",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            name => {
                description => 'The name (ID) of the mds',
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

        my $mds_id = $param->{name};

        my $worker = sub {
            my $timeout = PVE::Ceph::Tools::get_config('long_rados_timeout');
            my $rados = PVE::RADOS->new(timeout => $timeout);

            my $cfg = cfs_read_file('ceph.conf');

            if (defined($cfg->{"mds.$mds_id"})) {
                delete $cfg->{"mds.$mds_id"};
                cfs_write_file('ceph.conf', $cfg);
            }

            PVE::Ceph::Services::destroy_mds($mds_id, $rados);
        };

        return $rpcenv->fork_worker('cephdestroymds', "mds.$mds_id", $authuser, $worker);
    },
});

1;
