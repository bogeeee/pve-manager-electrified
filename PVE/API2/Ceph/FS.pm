package PVE::API2::Ceph::FS;

use strict;
use warnings;

use PVE::Ceph::Tools;
use PVE::Ceph::Services;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RADOS;
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::Storage;

use PVE::API2::Storage::Config;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    proxyto => 'node',
    description => "Directory index.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
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
            additionalProperties => 1,
            properties => {
                name => {
                    description => "The ceph filesystem name.",
                    type => 'string',
                },
                metadata_pool => {
                    description => "Name of the metadata pool.",
                    type => 'string',
                },
                metadata_pool_id => {
                    description => "Numeric id of the metadata pool.",
                    type => 'integer',
                    optional => 1,
                },
                data_pool => {
                    description => "Name of the filesystem's first data pool. A CephFS can have"
                        . " more than one data pool; consumers interested in the full set"
                        . " should read 'data_pools' instead. Kept for backwards compatibility.",
                    type => 'string',
                },
                data_pools => {
                    description =>
                        "Names of all data pools assigned to the filesystem; a CephFS"
                        . " can have multiple data pools (e.g. replicated metadata plus EC"
                        . " data, or multiple device-class-specific data pools).",
                    type => 'array',
                    optional => 1,
                    items => {
                        description => "Data pool name.",
                        type => 'string',
                    },
                },
                data_pool_ids => {
                    description => "Numeric ids of the data pools.",
                    type => 'array',
                    optional => 1,
                    items => {
                        description => "Data pool id.",
                        type => 'integer',
                    },
                },
            },
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados = PVE::RADOS->new();

        my $cephfs_list = PVE::Ceph::Tools::ls_fs($rados);

        my $res = [
            map { {
                name => $_->{name},
                metadata_pool => $_->{metadata_pool},
                metadata_pool_id => $_->{metadata_pool_id},
                # FIXME: remove with PVE 10; backwards-compat alias for
                # consumers that have not switched to data_pools yet.
                data_pool => $_->{data_pools}->[0],
                data_pools => $_->{data_pools},
                data_pool_ids => $_->{data_pool_ids},
            } } @$cephfs_list
        ];

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'createfs',
    path => '{name}',
    method => 'POST',
    description => "Create a Ceph filesystem",
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
                description => "The ceph filesystem name.",
                type => 'string',
                default => 'cephfs',
                optional => 1,
                pattern => qr|^[^:/\s]+$|,
            },
            pg_num => {
                description =>
                    "Number of placement groups for the backing data pool. The metadata pool will use a quarter of this.",
                type => 'integer',
                default => 128,
                optional => 1,
                minimum => 8,
                maximum => 32768,
            },
            'add-storage' => {
                description => "Configure the created CephFS as storage for this cluster.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $fs_name = $param->{name} // 'cephfs';
        my $pg_num = $param->{pg_num} // 128;

        my $pool_data = "${fs_name}_data";
        my $pool_metadata = "${fs_name}_metadata";

        my $rados = PVE::RADOS->new();
        my $ls_pools = PVE::Ceph::Tools::ls_pools();
        my $existing_pools = { map { $_->{poolname} => 1 } @$ls_pools };

        die "ceph pools '$pool_data' and/or '$pool_metadata' already exist\n"
            if $existing_pools->{$pool_data} || $existing_pools->{$pool_metadata};

        my $fs = PVE::Ceph::Tools::ls_fs($rados);
        die "ceph fs '$fs_name' already exists\n"
            if (grep { $_->{name} eq $fs_name } @$fs);

        my $running_mds = PVE::Ceph::Services::get_cluster_mds_state($rados);
        die "no running Metadata Server (MDS) found!\n" if !scalar(keys %$running_mds);
        die "no standby Metadata Server (MDS) found!\n"
            if !grep { $_->{state} eq 'up:standby' } values(%$running_mds);

        PVE::Storage::assert_sid_unused($fs_name) if $param->{'add-storage'};

        my $worker = sub {
            $rados = PVE::RADOS->new();

            my $pool_param = {
                application => 'cephfs',
                pg_num => $pg_num,
            };

            my @created_pools = ();
            eval {
                print "creating data pool '$pool_data'...\n";
                PVE::Ceph::Tools::create_pool($pool_data, $pool_param, $rados);
                push @created_pools, $pool_data;

                print "creating metadata pool '$pool_metadata'...\n";
                $pool_param->{pg_num} = $pg_num >= 32 ? $pg_num / 4 : 8;
                PVE::Ceph::Tools::create_pool($pool_metadata, $pool_param, $rados);
                push @created_pools, $pool_metadata;

                print "configuring new CephFS '$fs_name'\n";
                my $param = {
                    pool_metadata => $pool_metadata,
                    pool_data => $pool_data,
                };
                PVE::Ceph::Tools::create_fs($fs_name, $param, $rados);
            };
            if (my $err = $@) {
                $@ = undef;

                if (@created_pools > 0) {
                    warn "Encountered error after creating at least one pool\n";
                    # our old connection is very likely broken now, recreate
                    $rados = PVE::RADOS->new();
                    foreach my $pool (@created_pools) {
                        warn "cleaning up left over pool '$pool'\n";
                        eval { PVE::Ceph::Tools::destroy_pool($pool, $rados) };
                        warn "$@\n" if $@;
                    }
                }

                die "$err\n";
            }
            print "Successfully create CephFS '$fs_name'\n";

            if ($param->{'add-storage'}) {
                print "Adding '$fs_name' to storage configuration...\n";

                my $waittime = 0;
                while (!PVE::Ceph::Services::is_mds_active($rados, $fs_name)) {
                    if ($waittime >= 10) {
                        die "Need MDS to add storage, but none got active!\n";
                    }

                    print "Waiting for an MDS to become active\n";
                    sleep(1);
                    $waittime++;
                }

                eval {
                    PVE::API2::Storage::Config->create({
                        type => 'cephfs',
                        storage => $fs_name,
                        content => 'backup,iso,vztmpl',
                        'fs-name' => $fs_name,
                    });
                };
                die "adding storage for CephFS '$fs_name' failed, check log "
                    . "and add manually!\n$@\n"
                    if $@;
            }
        };

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        return $rpcenv->fork_worker('cephfscreate', $fs_name, $user, $worker);
    },
});

my $get_pveceph_managed_storages = sub {
    my ($fs, $is_default) = @_;

    my $cfg = PVE::Storage::config();
    my $storages = $cfg->{ids};
    my $res = {};
    for my $storeid (keys %$storages) {
        my $curr = $storages->{$storeid};
        next if $curr->{type} ne 'cephfs';
        my $cur_fs = $curr->{'fs-name'};
        $res->{$storeid} = $curr
            if (!defined($cur_fs) && $is_default) || (defined($cur_fs) && $fs eq $cur_fs);
    }
    return $res;
};

__PACKAGE__->register_method({
    name => 'destroyfs',
    path => '{name}',
    method => 'DELETE',
    description =>
        "Destroy a Ceph filesystem. Refuses if any PVE storage entry of type 'cephfs'"
        . " still references the filesystem and is not disabled. Optionally also removes the"
        . " storage entries and/or the underlying metadata and data pools.",
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
                description => "The Ceph filesystem name.",
                type => 'string',
            },
            'remove-storages' => {
                description =>
                    "Remove pveceph-managed storages configured for this filesystem.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            'remove-pools' => {
                description => "Remove the metadata and data pools used by this filesystem.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $fs_name = $param->{name};

        my $fs;
        my $fs_list = PVE::Ceph::Tools::ls_fs();
        for my $entry (@$fs_list) {
            next if $entry->{name} ne $fs_name;
            $fs = $entry;
            last;
        }
        die "no such cephfs '$fs_name'\n" if !$fs;

        my $worker = sub {
            my $rados = PVE::RADOS->new();

            if ($param->{'remove-storages'}) {
                my $defaultfs;
                my $fs_dump = $rados->mon_command({ prefix => "fs dump" });
                for my $entry ($fs_dump->{filesystems}->@*) {
                    next if $entry->{id} != $fs_dump->{default_fscid};
                    $defaultfs = $entry->{mdsmap}->{fs_name};
                }
                warn "no default fs found, maybe not all relevant storages are removed\n"
                    if !defined($defaultfs);

                my $storages = $get_pveceph_managed_storages->(
                    $fs_name, $fs_name eq ($defaultfs // ''),
                );
                for my $storeid (keys %$storages) {
                    my $store = $storages->{$storeid};
                    if (!$store->{disable}) {
                        die "storage '$storeid' is not disabled, make sure to disable"
                            . " and unmount the storage first\n";
                    }
                }

                my $err;
                for my $storeid (keys %$storages) {
                    # skip external clusters, not managed by pveceph
                    next if $storages->{$storeid}->{monhost};
                    eval { PVE::API2::Storage::Config->delete({ storage => $storeid }) };
                    if ($@) {
                        warn "failed to remove storage '$storeid': $@\n";
                        $err = 1;
                    }
                }
                die "failed to remove (some) storages - check log and remove manually!\n"
                    if $err;
            }

            PVE::Ceph::Tools::destroy_fs($fs_name, $rados);

            if ($param->{'remove-pools'}) {
                warn "removing metadata pool '$fs->{metadata_pool}'\n";
                eval { PVE::Ceph::Tools::destroy_pool($fs->{metadata_pool}, $rados) };
                warn "$@\n" if $@;

                for my $pool ($fs->{data_pools}->@*) {
                    warn "removing data pool '$pool'\n";
                    eval { PVE::Ceph::Tools::destroy_pool($pool, $rados) };
                    warn "$@\n" if $@;
                }
            }
        };

        return $rpcenv->fork_worker('cephdestroyfs', $fs_name, $user, $worker);
    },
});

1;
