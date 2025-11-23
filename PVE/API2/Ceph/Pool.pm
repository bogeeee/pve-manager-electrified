package PVE::API2::Ceph::Pool;

use strict;
use warnings;

use PVE::Ceph::Tools;
use PVE::Ceph::Services;
use PVE::JSONSchema qw(get_standard_option parse_property_string);
use PVE::RADOS;
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::Storage;
use PVE::Tools qw(extract_param);

use PVE::API2::Storage::Config;

use base qw(PVE::RESTHandler);

my $get_autoscale_status = sub {
    my ($rados) = shift;

    $rados = PVE::RADOS->new() if !defined($rados);

    my $autoscale = $rados->mon_command({ prefix => 'osd pool autoscale-status' });

    my $data;
    foreach my $p (@$autoscale) {
        $data->{ $p->{pool_name} } = $p;
    }

    return $data;
};

__PACKAGE__->register_method({
    name => 'lspools',
    path => '',
    method => 'GET',
    description =>
        "List all pools and their settings (which are settable by the POST/PUT endpoints).",
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
                pool => {
                    type => 'integer',
                    title => 'ID',
                },
                pool_name => {
                    type => 'string',
                    title => 'Name',
                },
                size => {
                    type => 'integer',
                    title => 'Size',
                },
                type => {
                    type => 'string',
                    title => 'Type',
                    enum => ['replicated', 'erasure', 'unknown'],
                },
                min_size => {
                    type => 'integer',
                    title => 'Min Size',
                },
                pg_num => {
                    type => 'integer',
                    title => 'PG Num',
                },
                pg_num_min => {
                    type => 'integer',
                    title => 'min. PG Num',
                    optional => 1,
                },
                pg_num_final => {
                    type => 'integer',
                    title => 'Optimal PG Num',
                    optional => 1,
                },
                pg_autoscale_mode => {
                    type => 'string',
                    title => 'PG Autoscale Mode',
                    optional => 1,
                },
                crush_rule => {
                    type => 'integer',
                    title => 'Crush Rule',
                },
                crush_rule_name => {
                    type => 'string',
                    title => 'Crush Rule Name',
                },
                percent_used => {
                    type => 'number',
                    title => '%-Used',
                },
                bytes_used => {
                    type => 'integer',
                    title => 'Used',
                    renderer => 'bytes',
                },
                target_size => {
                    type => 'integer',
                    title => 'PG Autoscale Target Size',
                    optional => 1,
                },
                target_size_ratio => {
                    type => 'number',
                    title => 'PG Autoscale Target Ratio',
                    optional => 1,
                },
                autoscale_status => {
                    type => 'object',
                    title => 'Autoscale Status',
                    optional => 1,
                },
                application_metadata => {
                    type => 'object',
                    title => 'Associated Applications',
                    optional => 1,
                },
            },
        },
        links => [{ rel => 'child', href => "{pool_name}" }],
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados = PVE::RADOS->new();

        my $stats = {};
        my $res = $rados->mon_command({ prefix => 'df' });

        foreach my $d (@{ $res->{pools} }) {
            next if !$d->{stats};
            next if !defined($d->{id});
            $stats->{ $d->{id} } = $d->{stats};
        }

        $res = $rados->mon_command({ prefix => 'osd dump' });
        my $rulestmp = $rados->mon_command({ prefix => 'osd crush rule dump' });

        my $rules = {};
        for my $rule (@$rulestmp) {
            $rules->{ $rule->{rule_id} } = $rule->{rule_name};
        }

        my $data = [];
        my $attr_list = [
            'pool',
            'pool_name',
            'size',
            'min_size',
            'pg_num',
            'crush_rule',
            'pg_autoscale_mode',
            'application_metadata',
        ];

        # pg_autoscaler module is not enabled in Nautilus
        my $autoscale = eval { $get_autoscale_status->($rados) };

        foreach my $e (@{ $res->{pools} }) {
            my $d = {};
            foreach my $attr (@$attr_list) {
                $d->{$attr} = $e->{$attr} if defined($e->{$attr});
            }

            if ($autoscale) {
                $d->{autoscale_status} = $autoscale->{ $d->{pool_name} };
                $d->{pg_num_final} = $d->{autoscale_status}->{pg_num_final};
                # some info is nested under options instead
                $d->{pg_num_min} = $e->{options}->{pg_num_min};
                $d->{target_size} = $e->{options}->{target_size_bytes};
                $d->{target_size_ratio} = $e->{options}->{target_size_ratio};
            }

            if (defined($d->{crush_rule}) && defined($rules->{ $d->{crush_rule} })) {
                $d->{crush_rule_name} = $rules->{ $d->{crush_rule} };
            }

            if (my $s = $stats->{ $d->{pool} }) {
                $d->{bytes_used} = $s->{bytes_used};
                $d->{percent_used} = $s->{percent_used};
            }

            # Cephs numerical pool types are barely documented. Found the following in the Ceph
            # codebase: https://github.com/ceph/ceph/blob/ff144995a849407c258bcb763daa3e03cfce5059/src/osd/osd_types.h#L1221-L1233
            if ($e->{type} == 1) {
                $d->{type} = 'replicated';
            } elsif ($e->{type} == 3) {
                $d->{type} = 'erasure';
            } else {
                # we should never get here, but better be safe
                $d->{type} = 'unknown';
            }
            push @$data, $d;
        }

        return $data;
    },
});

my $ceph_pool_common_options = sub {
    my ($nodefault) = shift;
    my $options = {
        name => {
            title => 'Name',
            description => "The name of the pool. It must be unique.",
            type => 'string',
            pattern => qr|^[^:/\s]+$|,
        },
        size => {
            title => 'Size',
            description => 'Number of replicas per object',
            type => 'integer',
            default => 3,
            optional => 1,
            minimum => 1,
            maximum => 7,
        },
        min_size => {
            title => 'Min Size',
            description => 'Minimum number of replicas per object',
            type => 'integer',
            default => 2,
            optional => 1,
            minimum => 1,
            maximum => 7,
        },
        pg_num => {
            title => 'PG Num',
            description => "Number of placement groups.",
            type => 'integer',
            default => 128,
            optional => 1,
            minimum => 1,
            maximum => 32768,
        },
        pg_num_min => {
            title => 'min. PG Num',
            description => "Minimal number of placement groups.",
            type => 'integer',
            optional => 1,
            maximum => 32768,
        },
        crush_rule => {
            title => 'Crush Rule Name',
            description => "The rule to use for mapping object placement in the cluster.",
            type => 'string',
            optional => 1,
        },
        application => {
            title => 'Application',
            description => "The application of the pool.",
            default => 'rbd',
            type => 'string',
            enum => ['rbd', 'cephfs', 'rgw'],
            optional => 1,
        },
        pg_autoscale_mode => {
            title => 'PG Autoscale Mode',
            description => "The automatic PG scaling mode of the pool.",
            type => 'string',
            enum => ['on', 'off', 'warn'],
            default => 'warn',
            optional => 1,
        },
        target_size => {
            description => "The estimated target size of the pool for the PG autoscaler.",
            title => 'PG Autoscale Target Size',
            type => 'string',
            pattern => '^(\d+(\.\d+)?)([KMGT])?$',
            optional => 1,
        },
        target_size_ratio => {
            description => "The estimated target ratio of the pool for the PG autoscaler.",
            title => 'PG Autoscale Target Ratio',
            type => 'number',
            optional => 1,
        },
    };

    if ($nodefault) {
        delete $options->{$_}->{default} for keys %$options;
    }
    return $options;
};

my $add_storage = sub {
    my ($pool, $storeid, $ec_data_pool) = @_;

    my $storage_params = {
        type => 'rbd',
        pool => $pool,
        storage => $storeid,
        krbd => 0,
        content => 'rootdir,images',
    };

    $storage_params->{'data-pool'} = $ec_data_pool if $ec_data_pool;

    PVE::API2::Storage::Config->create($storage_params);
};

my $get_storages = sub {
    my ($pool) = @_;

    my $cfg = PVE::Storage::config();

    my $storages = $cfg->{ids};
    my $res = {};
    foreach my $storeid (keys %$storages) {
        my $curr = $storages->{$storeid};
        next if $curr->{type} ne 'rbd';
        $curr->{pool} = 'rbd' if !defined $curr->{pool}; # set default
        if (
            $pool eq $curr->{pool}
            || (defined $curr->{'data-pool'} && $pool eq $curr->{'data-pool'})
        ) {
            $res->{$storeid} = $storages->{$storeid};
        }
    }

    return $res;
};

my $ec_format = {
    k => {
        type => 'integer',
        description => "Number of data chunks. Will create an erasure coded pool plus a"
            . " replicated pool for metadata.",
        minimum => 2,
    },
    m => {
        type => 'integer',
        description => "Number of coding chunks. Will create an erasure coded pool plus a"
            . " replicated pool for metadata.",
        minimum => 1,
    },
    'failure-domain' => {
        type => 'string',
        description => "CRUSH failure domain. Default is 'host'. Will create an erasure"
            . " coded pool plus a replicated pool for metadata.",
        format_description => 'domain',
        optional => 1,
        default => 'host',
    },
    'device-class' => {
        type => 'string',
        description => "CRUSH device class. Will create an erasure coded pool plus a"
            . " replicated pool for metadata.",
        format_description => 'class',
        optional => 1,
    },
    profile => {
        description => "Override the erasure code (EC) profile to use. Will create an"
            . " erasure coded pool plus a replicated pool for metadata.",
        type => 'string',
        format_description => 'profile',
        optional => 1,
    },
};

sub ec_parse_and_check {
    my ($property, $rados) = @_;
    return if !$property;

    my $ec = parse_property_string($ec_format, $property);

    die "Erasure code profile '$ec->{profile}' does not exist.\n"
        if $ec->{profile} && !PVE::Ceph::Tools::ecprofile_exists($ec->{profile}, $rados);

    return $ec;
}

__PACKAGE__->register_method({
    name => 'createpool',
    path => '',
    method => 'POST',
    description => "Create Ceph pool",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            add_storages => {
                description => "Configure VM and CT storage using the new pool.",
                type => 'boolean',
                optional => 1,
                default => "0; for erasure coded pools: 1",
            },
            'erasure-coding' => {
                description => "Create an erasure coded pool for RBD with an accompaning"
                    . " replicated pool for metadata storage. With EC, the common ceph options 'size',"
                    . " 'min_size' and 'crush_rule' parameters will be applied to the metadata pool.",
                type => 'string',
                format => $ec_format,
                optional => 1,
            },
            %{ $ceph_pool_common_options->() },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Cluster::check_cfs_quorum();
        PVE::Ceph::Tools::check_ceph_configured();

        my $pool = my $name = extract_param($param, 'name');
        my $node = extract_param($param, 'node');
        my $add_storages = extract_param($param, 'add_storages');

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        # Ceph uses target_size_bytes
        if (defined($param->{'target_size'})) {
            my $target_sizestr = extract_param($param, 'target_size');
            $param->{target_size_bytes} = PVE::JSONSchema::parse_size($target_sizestr);
        }

        my $rados = PVE::RADOS->new();
        my $ec = ec_parse_and_check(extract_param($param, 'erasure-coding'), $rados);
        $add_storages = 1 if $ec && !defined($add_storages);

        if ($add_storages) {
            $rpcenv->check($user, '/storage', ['Datastore.Allocate']);
            die "pool name contains characters which are illegal for storage naming\n"
                if !PVE::JSONSchema::parse_storage_id($pool);
        }

        # pool defaults
        $param->{pg_num} //= 128;
        $param->{size} //= 3;
        $param->{min_size} //= 2;
        $param->{application} //= 'rbd';
        $param->{pg_autoscale_mode} //= 'warn';

        my $worker = sub {
            # reopen with longer timeout
            $rados =
                PVE::RADOS->new(timeout => PVE::Ceph::Tools::get_config('long_rados_timeout'));

            if ($ec) {
                if (!$ec->{profile}) {
                    $ec->{profile} = PVE::Ceph::Tools::get_ecprofile_name($pool, $rados);
                    eval {
                        PVE::Ceph::Tools::create_ecprofile(
                            $ec->@{ 'profile', 'k', 'm', 'failure-domain', 'device-class' },
                            $rados,
                        );
                    };
                    die "could not create erasure code profile '$ec->{profile}': $@\n" if $@;
                    print "created new erasure code profile '$ec->{profile}'\n";
                }

                my $ec_data_param = {};
                # copy all params, should be a flat hash
                $ec_data_param = { map { $_ => $param->{$_} } keys %$param };

                $ec_data_param->{pool_type} = 'erasure';
                $ec_data_param->{allow_ec_overwrites} = 'true';
                $ec_data_param->{erasure_code_profile} = $ec->{profile};
                delete $ec_data_param->{size};
                delete $ec_data_param->{min_size};
                delete $ec_data_param->{crush_rule};

                # metadata pool should be ok with 32 PGs
                $param->{pg_num} = 32;

                $pool = "${name}-metadata";
                $ec->{data_pool} = "${name}-data";

                PVE::Ceph::Tools::create_pool($ec->{data_pool}, $ec_data_param, $rados);
            }

            PVE::Ceph::Tools::create_pool($pool, $param, $rados);

            if ($add_storages) {
                eval { $add_storage->($pool, "${name}", $ec->{data_pool}) };
                die "adding PVE storage for ceph pool '$name' failed: $@\n" if $@;
            }
        };

        return $rpcenv->fork_worker('cephcreatepool', $pool, $user, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'destroypool',
    path => '{name}',
    method => 'DELETE',
    description => "Destroy pool",
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
                description => "The name of the pool. It must be unique.",
                type => 'string',
            },
            force => {
                description => "If true, destroys pool even if in use",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            remove_storages => {
                description => "Remove all pveceph-managed storages configured for this pool",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            remove_ecprofile => {
                description =>
                    "Remove the erasure code profile. Defaults to true, if applicable.",
                type => 'boolean',
                optional => 1,
                default => 1,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        $rpcenv->check($user, '/storage', ['Datastore.Allocate'])
            if $param->{remove_storages};

        my $pool = $param->{name};

        my $worker = sub {
            my $storages = $get_storages->($pool);

            # if not forced, destroy ceph pool only when no
            # vm disks are on it anymore
            if (!$param->{force}) {
                my $storagecfg = PVE::Storage::config();
                foreach my $storeid (keys %$storages) {
                    my $storage = $storages->{$storeid};

                    # check if any vm disks are on the pool
                    print "checking storage '$storeid' for RBD images..\n";
                    my $res = PVE::Storage::vdisk_list($storagecfg, $storeid);
                    die "ceph pool '$pool' still in use by storage '$storeid'\n"
                        if @{ $res->{$storeid} } != 0;
                }
            }
            my $rados = PVE::RADOS->new();

            my $pool_properties = PVE::Ceph::Tools::get_pool_properties($pool, $rados);

            PVE::Ceph::Tools::destroy_pool($pool, $rados);

            if (my $ecprofile = $pool_properties->{erasure_code_profile}) {
                print "found erasure coded profile '$ecprofile', destroying its CRUSH rule\n";
                my $crush_rule = $pool_properties->{crush_rule};
                eval { PVE::Ceph::Tools::destroy_crush_rule($crush_rule, $rados); };
                warn "removing crush rule '${crush_rule}' failed: $@\n" if $@;

                if ($param->{remove_ecprofile} // 1) {
                    print "destroying erasure coded profile '$ecprofile'\n";
                    eval { PVE::Ceph::Tools::destroy_ecprofile($ecprofile, $rados) };
                    warn "removing EC profile '${ecprofile}' failed: $@\n" if $@;
                }
            }

            if ($param->{remove_storages}) {
                my $err;
                foreach my $storeid (keys %$storages) {
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
        };
        return $rpcenv->fork_worker('cephdestroypool', $pool, $user, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'setpool',
    path => '{name}',
    method => 'PUT',
    description => "Change POOL settings",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            %{ $ceph_pool_common_options->('nodefault') },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $pool = extract_param($param, 'name');
        my $node = extract_param($param, 'node');

        # Ceph uses target_size_bytes
        if (defined($param->{'target_size'})) {
            my $target_sizestr = extract_param($param, 'target_size');
            $param->{target_size_bytes} = PVE::JSONSchema::parse_size($target_sizestr);
        }

        my $worker = sub {
            PVE::Ceph::Tools::set_pool($pool, $param);
        };

        return $rpcenv->fork_worker('cephsetpool', $pool, $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'poolindex',
    path => '{name}',
    method => 'GET',
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    description => "Pool index.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            name => {
                description => 'The name of the pool.',
                type => 'string',
            },
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
            { name => 'status' },
        ];

        return $result;
    },
});

__PACKAGE__->register_method({
    name => 'getpool',
    path => '{name}/status',
    method => 'GET',
    description => "Show the current pool status.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            name => {
                description => "The name of the pool. It must be unique.",
                type => 'string',
            },
            verbose => {
                type => 'boolean',
                default => 0,
                optional => 1,
                description => "If enabled, will display additional data" . "(eg. statistics).",
            },
        },
    },
    returns => {
        type => "object",
        properties => {
            id => { type => 'integer', title => 'ID' },
            pgp_num => { type => 'integer', title => 'PGP num' },
            noscrub => { type => 'boolean', title => 'noscrub' },
            'nodeep-scrub' => { type => 'boolean', title => 'nodeep-scrub' },
            nodelete => { type => 'boolean', title => 'nodelete' },
            nopgchange => { type => 'boolean', title => 'nopgchange' },
            nosizechange => { type => 'boolean', title => 'nosizechange' },
            write_fadvise_dontneed => { type => 'boolean', title => 'write_fadvise_dontneed' },
            hashpspool => { type => 'boolean', title => 'hashpspool' },
            use_gmt_hitset => { type => 'boolean', title => 'use_gmt_hitset' },
            fast_read => { type => 'boolean', title => 'Fast Read' },
            application_list => { type => 'array', title => 'Application', optional => 1 },
            statistics => { type => 'object', title => 'Statistics', optional => 1 },
            autoscale_status =>
                { type => 'object', title => 'Autoscale Status', optional => 1 },
            %{ $ceph_pool_common_options->() },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $verbose = $param->{verbose};
        my $pool = $param->{name};

        my $rados = PVE::RADOS->new();
        my $res = $rados->mon_command({
            prefix => 'osd pool get',
            pool => "$pool",
            var => 'all',
        });

        my $data = {
            id => $res->{pool_id},
            name => $pool,
            size => $res->{size},
            min_size => $res->{min_size},
            pg_num => $res->{pg_num},
            pg_num_min => $res->{pg_num_min},
            pgp_num => $res->{pgp_num},
            crush_rule => $res->{crush_rule},
            pg_autoscale_mode => $res->{pg_autoscale_mode},
            noscrub => "$res->{noscrub}",
            'nodeep-scrub' => "$res->{'nodeep-scrub'}",
            nodelete => "$res->{nodelete}",
            nopgchange => "$res->{nopgchange}",
            nosizechange => "$res->{nosizechange}",
            write_fadvise_dontneed => "$res->{write_fadvise_dontneed}",
            hashpspool => "$res->{hashpspool}",
            use_gmt_hitset => "$res->{use_gmt_hitset}",
            fast_read => "$res->{fast_read}",
            target_size => $res->{target_size_bytes},
            target_size_ratio => $res->{target_size_ratio},
        };

        if ($verbose) {
            my $stats;
            my $res = $rados->mon_command({ prefix => 'df' });

            # pg_autoscaler module is not enabled in Nautilus
            # avoid partial read further down, use new rados instance
            my $autoscale_status = eval { $get_autoscale_status->() };
            $data->{autoscale_status} = $autoscale_status->{$pool};

            foreach my $d (@{ $res->{pools} }) {
                next if !$d->{stats};
                next if !defined($d->{name}) && !$d->{name} ne "$pool";
                $data->{statistics} = $d->{stats};
            }

            my $apps =
                $rados->mon_command({ prefix => "osd pool application get", pool => "$pool" });
            $data->{application_list} = [keys %$apps];
        }

        return $data;
    },
});

1;
