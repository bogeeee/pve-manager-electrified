package PVE::API2::Ceph::OSD;

use strict;
use warnings;

use Cwd qw(abs_path);
use IO::File;
use JSON;
use UUID;

use PVE::Ceph::Tools;
use PVE::Ceph::Services;
use PVE::CephConfig;
use PVE::Cluster qw(cfs_read_file cfs_write_file);
use PVE::Diskmanage;
use PVE::Storage::LVMPlugin;
use PVE::Exception qw(raise_param_exc);
use PVE::JSONSchema qw(get_standard_option);
use PVE::INotify;
use PVE::RADOS;
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::Tools qw(run_command file_set_contents);
use PVE::ProcFSTools;
use PVE::Network;

use base qw(PVE::RESTHandler);

my $nodename = PVE::INotify::nodename();

my $get_osd_status = sub {
    my ($rados, $osdid) = @_;

    my $stat = $rados->mon_command({ prefix => 'osd dump' });

    my $osdlist = $stat->{osds} || [];

    my $flags = $stat->{flags} || undef;

    my $osdstat;
    foreach my $d (@$osdlist) {
        $osdstat->{ $d->{osd} } = $d if defined($d->{osd});
    }
    if (defined($osdid)) {
        die "no such OSD '$osdid'\n" if !$osdstat->{$osdid};
        return $osdstat->{$osdid};
    }

    return wantarray ? ($osdstat, $flags) : $osdstat;
};

my $get_osd_usage = sub {
    my ($rados) = @_;

    my $osdlist = $rados->mon_command({ prefix => 'pg dump', dumpcontents => ['osds'] });
    if (!($osdlist && ref($osdlist))) {
        warn "got unknown result format for 'pg dump osds' command\n";
        return [];
    }

    if (ref($osdlist) eq "HASH") { # since nautilus
        $osdlist = $osdlist->{osd_stats};
    }

    my $osdstat = {};
    for my $d (@$osdlist) {
        $osdstat->{ $d->{osd} } = $d if defined($d->{osd});
    }

    return $osdstat;
};

my sub get_proc_pss_from_pid {
    my ($pid) = @_;
    return if !defined($pid) || $pid <= 1;

    open(my $SMAPS_FH, '<', "/proc/$pid/smaps_rollup")
        or die "failed to open PSS memory-stat from process - $!\n";

    while (my $line = <$SMAPS_FH>) {
        if ($line =~ m/^Pss:\s+([0-9]+) kB$/) { # using PSS avoids bias with many OSDs
            close $SMAPS_FH;
            return int($1) * 1024;
        }
    }
    close $SMAPS_FH;
    die "internal error: failed to find PSS memory-stat in procfs for PID $pid\n";
}

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Get Ceph osd list/tree.",
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
    # fixme: return a list instead of extjs tree format ?
    returns => {
        type => "object",
        items => {
            type => "object",
            properties => {
                flags => { type => "string" },
                root => {
                    type => "object",
                    description => "Tree with OSDs in the CRUSH map structure.",
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados = PVE::RADOS->new();
        my $res = $rados->mon_command({ prefix => 'osd df', output_method => 'tree' });

        die "no tree nodes found\n" if !($res && $res->{nodes});

        my ($osdhash, $flags) = $get_osd_status->($rados);

        my $osd_usage = $get_osd_usage->($rados);

        my $osdmetadata_res = $rados->mon_command({ prefix => 'osd metadata' });
        my $osdmetadata = { map { $_->{id} => $_ } @$osdmetadata_res };

        my $hostversions = PVE::Ceph::Services::get_ceph_versions();

        my $nodes = {};
        my $newnodes = {};
        foreach my $e (@{ $res->{nodes} }) {
            my ($id, $name) = $e->@{qw(id name)};

            $nodes->{$id} = $e;

            my $new = {
                id => $id,
                name => $name,
                type => $e->{type},
            };

            foreach my $opt (qw(status crush_weight reweight device_class pgs)) {
                $new->{$opt} = $e->{$opt} if defined($e->{$opt});
            }

            if (my $stat = $osdhash->{$id}) {
                $new->{in} = $stat->{in} if defined($stat->{in});
            }

            if (my $stat = $osd_usage->{$id}) {
                $new->{total_space} = ($stat->{kb} || 1) * 1024;
                $new->{bytes_used} = ($stat->{kb_used} || 0) * 1024;
                $new->{percent_used} = ($new->{bytes_used} * 100) / $new->{total_space};
                if (my $d = $stat->{perf_stat}) {
                    $new->{commit_latency_ms} = $d->{commit_latency_ms};
                    $new->{apply_latency_ms} = $d->{apply_latency_ms};
                }
            }

            my $osdmd = $osdmetadata->{$id};
            if ($e->{type} eq 'osd' && $osdmd) {
                if ($osdmd->{bluefs}) {
                    $new->{osdtype} = 'bluestore';
                    $new->{blfsdev} = $osdmd->{bluestore_bdev_dev_node};
                    $new->{dbdev} = $osdmd->{bluefs_db_dev_node};
                    $new->{waldev} = $osdmd->{bluefs_wal_dev_node};
                } else {
                    $new->{osdtype} = 'filestore';
                }
                for my $field (qw(ceph_version ceph_version_short)) {
                    $new->{$field} = $osdmd->{$field} if $osdmd->{$field};
                }
            }

            $newnodes->{$id} = $new;
        }

        foreach my $e (@{ $res->{nodes} }) {
            my ($id, $name) = $e->@{qw(id name)};
            my $new = $newnodes->{$id};

            if ($e->{children} && scalar(@{ $e->{children} })) {
                $new->{children} = [];
                $new->{leaf} = 0;
                foreach my $cid (@{ $e->{children} }) {
                    $nodes->{$cid}->{parent} = $id;
                    if ($nodes->{$cid}->{type} eq 'osd' && $e->{type} eq 'host') {
                        $newnodes->{$cid}->{host} = $name;
                    }
                    push @{ $new->{children} }, $newnodes->{$cid};
                }
            } else {
                $new->{leaf} = ($id >= 0) ? 1 : 0;
            }

            if ($name && $e->{type} eq 'host') {
                $new->{version} = $hostversions->{$name}->{version}->{str};
            }
        }

        my $realroots = [];
        foreach my $e (@{ $res->{nodes} }) {
            my $id = $e->{id};
            if (!$nodes->{$id}->{parent}) {
                push @$realroots, $newnodes->{$id};
            }
        }

        die "no root node\n" if scalar(@$realroots) < 1;

        my $data = {
            root => {
                leaf => 0,
                children => $realroots,
            },
        };

        $data->{flags} = $flags if $flags; # we want this for the noout flag

        return $data;
    },
});

__PACKAGE__->register_method({
    name => 'createosd',
    path => '',
    method => 'POST',
    description => "Create OSD",
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            dev => {
                description => "Block device name.",
                type => 'string',
            },
            db_dev => {
                description => "Block device name for block.db.",
                optional => 1,
                type => 'string',
            },
            db_dev_size => {
                description => "Size in GiB for block.db.",
                verbose_description =>
                    "If a block.db is requested but the size is not given, will"
                    . " be automatically selected by: bluestore_block_db_size from the ceph database"
                    . " (osd or global section) or config (osd or global section) in that order."
                    . " If this is not available, it will be sized 10% of the size of the OSD device."
                    . " Fails if the available size is not enough.",
                optional => 1,
                type => 'number',
                default => 'bluestore_block_db_size or 10% of OSD size',
                requires => 'db_dev',
                minimum => 1.0,
            },
            wal_dev => {
                description => "Block device name for block.wal.",
                optional => 1,
                type => 'string',
            },
            wal_dev_size => {
                description => "Size in GiB for block.wal.",
                verbose_description =>
                    "If a block.wal is requested but the size is not given, will"
                    . " be automatically selected by: bluestore_block_wal_size from the ceph database"
                    . " (osd or global section) or config (osd or global section) in that order."
                    . " If this is not available, it will be sized 1% of the size of the OSD device."
                    . " Fails if the available size is not enough.",
                optional => 1,
                minimum => 0.5,
                default => 'bluestore_block_wal_size or 1% of OSD size',
                requires => 'wal_dev',
                type => 'number',
            },
            encrypted => {
                type => 'boolean',
                optional => 1,
                default => 0,
                description => "Enables encryption of the OSD.",
            },
            'crush-device-class' => {
                optional => 1,
                type => 'string',
                description => "Set the device class of the OSD in crush.",
            },
            'osds-per-device' => {
                optional => 1,
                type => 'integer',
                minimum => '1',
                description =>
                    'OSD services per physical device. Only useful for fast NVMe devices"
		    ." to utilize their performance better.',
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        # test basic requirements
        PVE::Ceph::Tools::check_ceph_inited();
        PVE::Ceph::Tools::setup_pve_symlinks();
        PVE::Ceph::Tools::check_ceph_installed('ceph_osd');
        PVE::Ceph::Tools::check_ceph_installed('ceph_volume');

        # extract parameter info and fail if a device is set more than once
        my $devs = {};

        # allow 'osds-per-device' only without dedicated db and/or wal devs. We cannot specify them with
        # 'ceph-volume lvm batch' and they don't make a lot of sense on fast NVMEs anyway.
        if ($param->{'osds-per-device'}) {
            for my $type (qw(db_dev wal_dev)) {
                raise_param_exc(
                    { $type => "cannot use 'osds-per-device' parameter with '${type}'" })
                    if $param->{$type};
            }
        }

        my $ceph_conf = cfs_read_file('ceph.conf');

        my $osd_network = $ceph_conf->{global}->{cluster_network};
        $osd_network //= $ceph_conf->{global}->{public_network}; # fallback

        if ($osd_network) { # check only if something is configured
            my $cluster_net_ips = PVE::Network::get_local_ip_from_cidr($osd_network);
            if (scalar(@$cluster_net_ips) < 1) {
                my $osd_net_obj = PVE::Network::IP_from_cidr($osd_network);
                my $osd_base_cidr = $osd_net_obj->{ip} . "/" . $osd_net_obj->{prefixlen};

                die
                    "No address from ceph cluster network (${osd_base_cidr}) found on node '$nodename'. "
                    . "Check your network config.\n";
            }
        }

        for my $type (qw(dev db_dev wal_dev)) {
            next if !$param->{$type};

            my $type_dev = PVE::Diskmanage::verify_blockdev_path($param->{$type});
            (my $type_devname = $type_dev) =~ s|/dev/||;

            raise_param_exc({ $type => "cannot chose '$type_dev' for more than one type." })
                if grep { $_->{name} eq $type_devname } values %$devs;

            $devs->{$type} = {
                dev => $type_dev,
                name => $type_devname,
            };

            if (my $size = $param->{"${type}_size"}) {
                $devs->{$type}->{size} = PVE::Tools::convert_size($size, 'gb' => 'b');
            }
        }

        my $test_disk_requirements = sub {
            my ($disklist) = @_;

            my $dev = $devs->{dev}->{dev};
            my $devname = $devs->{dev}->{name};
            die "unable to get device info for '$dev'\n" if !$disklist->{$devname};
            die "device '$dev' is already in use\n" if $disklist->{$devname}->{used};

            for my $type (qw(db_dev wal_dev)) {
                my $d = $devs->{$type};
                next if !$d;
                my $name = $d->{name};
                my $info = $disklist->{$name};
                die "unable to get device info for '$d->{dev}' for type $type\n"
                    if !$disklist->{$name};
                if (my $usage = $info->{used}) {
                    if ($usage eq 'partitions') {
                        die "device '$d->{dev}' is not GPT partitioned\n" if !$info->{gpt};
                    } elsif ($usage ne 'LVM') {
                        die "device '$d->{dev}' is already in use and has no LVM on it\n";
                    }
                }
            }
        };

        # test disk requirements early
        my $devlist = [map { $_->{name} } values %$devs];
        my $disklist = PVE::Diskmanage::get_disks($devlist, 1, 1);
        $test_disk_requirements->($disklist);

        # get necessary ceph infos
        my $rados = PVE::RADOS->new();
        my $monstat = $rados->mon_command({ prefix => 'quorum_status' });

        my $ceph_bootstrap_osd_keyring =
            PVE::Ceph::Tools::get_config('ceph_bootstrap_osd_keyring');

        if (
            !-f $ceph_bootstrap_osd_keyring
            && $ceph_conf->{global}->{auth_client_required} eq 'cephx'
        ) {
            my $bindata = $rados->mon_command({
                prefix => 'auth get-or-create',
                entity => 'client.bootstrap-osd',
                caps => [
                    'mon' => 'allow profile bootstrap-osd',
                ],
                format => 'plain',
            });
            file_set_contents($ceph_bootstrap_osd_keyring, $bindata);
        }

        # See FIXME below
        my @udev_trigger_devs = ();

        # $size is in kibibytes
        my $osd_lvcreate = sub {
            my ($vg, $lv, $size) = @_;

            my $cmd = [
                '/sbin/lvcreate',
                '-aly',
                '-Wy',
                '--yes',
                '--size',
                $size . "k",
                '--name',
                $lv,
                # explicitly enable autoactivation, because Ceph never explicitly
                # activates LVs by itself
                '--setautoactivation',
                'y',
                $vg,
            ];

            run_command($cmd, errmsg => "lvcreate '$vg/$lv' error");
        };

        my $create_part_or_lv = sub {
            my ($dev, $size, $type) = @_;

            $size =~ m/^(\d+)$/ or die "invalid size '$size'\n";
            $size = $1;

            die "'$dev->{devpath}' is smaller than requested size '$size' bytes\n"
                if $dev->{size} < $size;

            # sgdisk and lvcreate can only sizes divisible by 512b
            # so we round down to the nearest kb
            $size = PVE::Tools::convert_size($size, 'b' => 'kb', 1);

            if (!$dev->{used}) {
                # create pv,vg,lv

                my $vg = "ceph-" . UUID::uuid();
                my $lv = $type . "-" . UUID::uuid();

                PVE::Storage::LVMPlugin::lvm_create_volume_group($dev->{devpath}, $vg);
                $osd_lvcreate->($vg, $lv, $size);

                if (PVE::Diskmanage::is_partition($dev->{devpath})) {
                    eval { PVE::Diskmanage::change_parttype($dev->{devpath}, '8E00'); };
                    warn $@ if $@;
                }

                push @udev_trigger_devs, $dev->{devpath};

                return "$vg/$lv";

            } elsif ($dev->{used} eq 'LVM') {
                # check pv/vg and create lv

                my $vgs = PVE::Storage::LVMPlugin::lvm_vgs(1);
                my $vg;
                for my $vgname (sort keys %$vgs) {
                    next if $vgname !~ /^ceph-/;

                    for my $pv (@{ $vgs->{$vgname}->{pvs} }) {
                        next if $pv->{name} ne $dev->{devpath};
                        $vg = $vgname;
                        last;
                    }
                    last if $vg;
                }

                die "no ceph vg found on '$dev->{devpath}'\n" if !$vg;
                die "vg '$vg' has not enough free space\n" if $vgs->{$vg}->{free} < $size;

                my $lv = $type . "-" . UUID::uuid();

                $osd_lvcreate->($vg, $lv, $size);

                return "$vg/$lv";

            } elsif ($dev->{used} eq 'partitions' && $dev->{gpt}) {
                # create new partition at the end
                my $parttypes = {
                    'osd-db' => '30CD0809-C2B2-499C-8879-2D6B78529876',
                    'osd-wal' => '5CE17FCE-4087-4169-B7FF-056CC58473F9',
                };

                my $part = PVE::Diskmanage::append_partition($dev->{devpath}, $size * 1024);

                if (my $parttype = $parttypes->{$type}) {
                    eval { PVE::Diskmanage::change_parttype($part, $parttype); };
                    warn $@ if $@;
                }

                push @udev_trigger_devs, $part;
                return $part;
            }

            die "cannot use '$dev->{devpath}' for '$type'\n";
        };

        my $worker = sub {
            my $upid = shift;

            PVE::Diskmanage::locked_disk_action(sub {
                # update disklist and re-test requirements
                $disklist = PVE::Diskmanage::get_disks($devlist, 1, 1);
                $test_disk_requirements->($disklist);

                my $dev_class = $param->{'crush-device-class'};
                # create allows for detailed configuration of DB and WAL devices
                # batch for easy creation of multiple OSDs (per device)
                my $create_mode = $param->{'osds-per-device'} ? 'batch' : 'create';
                my $cmd = ['ceph-volume', 'lvm', $create_mode];
                push @$cmd, '--crush-device-class', $dev_class if $dev_class;

                my $devname = $devs->{dev}->{name};
                my $devpath = $disklist->{$devname}->{devpath};
                print "create OSD on $devpath (bluestore)\n";

                push @udev_trigger_devs, $devpath;

                my $osd_size = $disklist->{$devname}->{size};
                my $size_map = {
                    db => int($osd_size / 10), # 10% of OSD
                    wal => int($osd_size / 100), # 1% of OSD
                };

                my $sizes;
                foreach my $type (qw(db wal)) {
                    my $fallback_size = $size_map->{$type};
                    my $d = $devs->{"${type}_dev"};
                    next if !$d;

                    # size was not set via api, getting from config/fallback
                    if (!defined($d->{size})) {
                        $sizes = PVE::Ceph::Tools::get_db_wal_sizes() if !$sizes;
                        $d->{size} = $sizes->{$type} // $fallback_size;
                    }
                    print "creating block.$type on '$d->{dev}'\n";
                    my $name = $d->{name};
                    my $part_or_lv =
                        $create_part_or_lv->($disklist->{$name}, $d->{size}, "osd-$type");

                    print "using '$part_or_lv' for block.$type\n";
                    push @$cmd, "--block.$type", $part_or_lv;
                }

                push @$cmd, '--data', $devpath if $create_mode eq 'create';
                push @$cmd, '--dmcrypt' if $param->{encrypted};

                if ($create_mode eq 'batch') {
                    push @$cmd,
                        '--osds-per-device', $param->{'osds-per-device'},
                        '--yes',
                        '--no-auto',
                        '--',
                        $devpath;
                }
                PVE::Diskmanage::wipe_blockdev($devpath);

                if (PVE::Diskmanage::is_partition($devpath)) {
                    eval { PVE::Diskmanage::change_parttype($devpath, '8E00'); };
                    warn $@ if $@;
                }

                run_command($cmd);

                # FIXME: Remove once we depend on systemd >= v249.
                # Work around udev bug https://github.com/systemd/systemd/issues/18525 to ensure the
                # udev database is updated.
                eval { run_command(['udevadm', 'trigger', @udev_trigger_devs]); };
                warn $@ if $@;
            });
        };

        return $rpcenv->fork_worker('cephcreateosd', $devs->{dev}->{name}, $authuser, $worker);
    },
});

my $OSD_DEV_RETURN_PROPS = {
    device => {
        type => 'string',
        enum => ['block', 'db', 'wal'],
        description => 'Kind of OSD device',
    },
    dev_node => {
        type => 'string',
        description => 'Device node',
    },
    devices => {
        type => 'string',
        description => 'Physical disks used',
    },
    size => {
        type => 'integer',
        description => 'Size in bytes',
    },
    support_discard => {
        type => 'boolean',
        description => 'Discard support of the physical device',
    },
    type => {
        type => 'string',
        description => 'Type of device. For example, hdd or ssd',
    },
};

__PACKAGE__->register_method({
    name => 'osdindex',
    path => '{osdid}',
    method => 'GET',
    permissions => { user => 'all' },
    description => "OSD index.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
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
            { name => 'metadata' }, { name => 'lv-info' },
        ];

        return $result;
    },
});

__PACKAGE__->register_method({
    name => 'osddetails',
    path => '{osdid}/metadata',
    method => 'GET',
    description => "Get OSD details",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
            },
        },
    },
    returns => {
        type => 'object',
        properties => {
            osd => {
                type => 'object',
                description => 'General information about the OSD',
                properties => {
                    hostname => {
                        type => 'string',
                        description => 'Name of the host containing the OSD.',
                    },
                    id => {
                        type => 'integer',
                        description => 'ID of the OSD.',
                    },
                    mem_usage => {
                        type => 'integer',
                        description => 'Memory usage of the OSD service.',
                    },
                    osd_data => {
                        type => 'string',
                        description => "Path to the OSD's data directory.",
                    },
                    osd_objectstore => {
                        type => 'string',
                        description => 'The type of object store used.',
                    },
                    pid => {
                        type => 'integer',
                        description => 'OSD process ID.',
                    },
                    version => {
                        type => 'string',
                        description => 'Ceph version of the OSD service.',
                    },
                    front_addr => {
                        type => 'string',
                        description => 'Address and port used to talk to clients and monitors.',
                    },
                    back_addr => {
                        type => 'string',
                        description => 'Address and port used to talk to other OSDs.',
                    },
                    hb_front_addr => {
                        type => 'string',
                        description => 'Heartbeat address and port for clients and monitors.',
                    },
                    hb_back_addr => {
                        type => 'string',
                        description => 'Heartbeat address and port for other OSDs.',
                    },
                },
            },
            devices => {
                type => 'array',
                description => 'Array containing data about devices',
                items => {
                    type => "object",
                    properties => $OSD_DEV_RETURN_PROPS,
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $osdid = $param->{osdid};
        my $rados = PVE::RADOS->new();
        my $metadata = $rados->mon_command({ prefix => 'osd metadata', id => int($osdid) });

        die "OSD '${osdid}' does not exists on host '${nodename}'\n"
            if $nodename ne $metadata->{hostname};

        my $pid;
        my $parser = sub {
            my $line = shift;
            if ($line =~ m/^MainPID=([0-9]*)$/) {
                $pid = int($1);
            }
        };

        my $cmd = [
            '/bin/systemctl', 'show', "ceph-osd\@${osdid}.service", '--property', 'MainPID',
        ];
        run_command(
            $cmd,
            errmsg => 'fetching OSD PID and memory usage failed',
            outfunc => $parser,
        );

        my $osd_pss_memory = eval { get_proc_pss_from_pid($pid) } // 0;
        warn $@ if $@;

        my $data = {
            osd => {
                hostname => $metadata->{hostname},
                id => $metadata->{id},
                mem_usage => $osd_pss_memory,
                osd_data => $metadata->{osd_data},
                osd_objectstore => $metadata->{osd_objectstore},
                pid => $pid,
                version => "$metadata->{ceph_version_short} ($metadata->{ceph_release})",
                front_addr => $metadata->{front_addr},
                back_addr => $metadata->{back_addr},
                hb_front_addr => $metadata->{hb_front_addr},
                hb_back_addr => $metadata->{hb_back_addr},
            },
        };

        $data->{devices} = [];

        my $get_data = sub {
            my ($dev, $prefix, $device) = @_;
            push(
                @{ $data->{devices} },
                {
                    dev_node => $metadata->{"${prefix}_${dev}_dev_node"},
                    physical_device => $metadata->{"${prefix}_${dev}_devices"},
                    size => int($metadata->{"${prefix}_${dev}_size"}),
                    support_discard => int($metadata->{"${prefix}_${dev}_support_discard"}),
                    type => $metadata->{"${prefix}_${dev}_type"},
                    device => $device,
                },
            );
        };

        $get_data->("bdev", "bluestore", "block");
        $get_data->("db", "bluefs", "db") if $metadata->{bluefs_dedicated_db};
        $get_data->("wal", "bluefs", "wal") if $metadata->{bluefs_dedicated_wal};

        return $data;
    },
});

__PACKAGE__->register_method({
    name => 'osdvolume',
    path => '{osdid}/lv-info',
    method => 'GET',
    description => "Get OSD volume details",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
            },
            type => {
                description => 'OSD device type',
                type => 'string',
                enum => ['block', 'db', 'wal'],
                default => 'block',
                optional => 1,
            },
        },
    },
    returns => {
        type => 'object',
        properties => {
            creation_time => {
                type => 'string',
                description => "Creation time as reported by `lvs`.",
            },
            lv_name => {
                type => 'string',
                description => 'Name of the logical volume (LV).',
            },
            lv_path => {
                type => 'string',
                description => 'Path to the logical volume (LV).',
            },
            lv_size => {
                type => 'integer',
                description => 'Size of the logical volume (LV).',
            },
            lv_uuid => {
                type => 'string',
                description => 'UUID of the logical volume (LV).',
            },
            vg_name => {
                type => 'string',
                description => 'Name of the volume group (VG).',
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $osdid = $param->{osdid};
        my $type = $param->{type} // 'block';

        my $raw = '';
        my $parser = sub { $raw .= shift };
        my $cmd = ['/usr/sbin/ceph-volume', 'lvm', 'list', $osdid, '--format', 'json'];
        run_command($cmd, errmsg => 'listing Ceph LVM volumes failed', outfunc => $parser);

        my $result;
        if ($raw =~ m/^(\{.*\})$/s) { #untaint
            $result = JSON::decode_json($1);
        } else {
            die "got unexpected data from ceph-volume: '${raw}'\n";
        }
        if (!$result->{$osdid}) {
            die "OSD '${osdid}' not found in 'ceph-volume lvm list' on node '${nodename}'.\n"
                . "Maybe it was created before LVM became the default?\n";
        }

        my $lv_data = { map { $_->{type} => $_ } @{ $result->{$osdid} } };
        my $volume = $lv_data->{$type}
            || die "volume type '${type}' not found for OSD ${osdid}\n";

        $raw = '';
        $cmd = ['/sbin/lvs', $volume->{lv_path}, '--reportformat', 'json', '-o', 'lv_time'];
        run_command($cmd, errmsg => 'listing logical volumes failed', outfunc => $parser);

        if ($raw =~ m/(\{.*\})$/s) { #untaint, lvs has whitespace at beginning
            $result = JSON::decode_json($1);
        } else {
            die "got unexpected data from lvs: '${raw}'\n";
        }

        my $data = { map { $_ => $volume->{$_} } qw(lv_name lv_path lv_uuid vg_name) };
        $data->{lv_size} = int($volume->{lv_size});

        $data->{creation_time} = @{ $result->{report} }[0]->{lv}->[0]->{lv_time};

        return $data;
    },
});

# Check if $osdid belongs to $nodename
# $tree ... rados osd tree (passing the tree makes it easy to test)
sub osd_belongs_to_node {
    my ($tree, $nodename, $osdid) = @_;
    return 0 if !($tree && $tree->{nodes});

    my $node_map = {};
    for my $el (grep { defined($_->{type}) && $_->{type} eq 'host' } @{ $tree->{nodes} }) {
        my $name = $el->{name};
        die "internal error: duplicate host name found '$name'\n" if $node_map->{$name};
        $node_map->{$name} = $el;
    }

    my $osds = $node_map->{$nodename}->{children};
    return 0 if !$osds;

    return grep($_ == $osdid, @$osds);
}

__PACKAGE__->register_method({
    name => 'destroyosd',
    path => '{osdid}',
    method => 'DELETE',
    description => "Destroy OSD",
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
            },
            cleanup => {
                description => "If set, we remove partition table entries.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        PVE::Ceph::Tools::check_ceph_inited();

        my $osdid = $param->{osdid};
        my $cleanup = $param->{cleanup};

        my $rados = PVE::RADOS->new();

        my $osd_belongs_to_node = osd_belongs_to_node(
            $rados->mon_command({ prefix => 'osd tree' }),
            $param->{node},
            $osdid,
        );
        die "OSD osd.$osdid does not belong to node $param->{node}!"
            if !$osd_belongs_to_node;

        # dies if osdid is unknown
        my $osdstat = $get_osd_status->($rados, $osdid);

        die "osd is in use (in == 1)\n" if $osdstat->{in};
        #&$run_ceph_cmd(['osd', 'out', $osdid]);

        die "osd is still running (up == 1)\n" if $osdstat->{up};

        my $osdsection = "osd.$osdid";

        my $worker = sub {
            my $upid = shift;

            # reopen with longer timeout
            $rados =
                PVE::RADOS->new(timeout => PVE::Ceph::Tools::get_config('long_rados_timeout'));

            print "destroy OSD $osdsection\n";

            eval {
                PVE::Ceph::Services::ceph_service_cmd('stop', $osdsection);
                PVE::Ceph::Services::ceph_service_cmd('disable', $osdsection);
            };
            warn $@ if $@;

            print "Remove $osdsection from the CRUSH map\n";
            $rados->mon_command(
                { prefix => "osd crush remove", name => $osdsection, format => 'plain' });

            print "Remove the $osdsection authentication key.\n";
            $rados->mon_command({
                prefix => "auth del", entity => $osdsection, format => 'plain' });

            print "Remove OSD $osdsection\n";
            $rados->mon_command({
                prefix => "osd rm", ids => [$osdsection], format => 'plain' });

            print "Remove $osdsection mclock max capacity iops settings from config\n";
            $rados->mon_command(
                {
                    prefix => "config rm",
                    who => $osdsection,
                    name => 'osd_mclock_max_capacity_iops_ssd',
                },
            );
            $rados->mon_command(
                {
                    prefix => "config rm",
                    who => $osdsection,
                    name => 'osd_mclock_max_capacity_iops_hdd',
                },
            );

            # try to unmount from standard mount point
            my $mountpoint = "/var/lib/ceph/osd/ceph-$osdid";

            # See FIXME below
            my $udev_trigger_devs = {};

            my $remove_partition = sub {
                my ($part) = @_;

                return if !$part || (!-b $part);
                my $partnum = PVE::Diskmanage::get_partnum($part);
                my $devpath = PVE::Diskmanage::get_blockdev($part);

                $udev_trigger_devs->{$devpath} = 1;

                PVE::Diskmanage::wipe_blockdev($part);
                print "remove partition $part (disk '${devpath}', partnum $partnum)\n";
                eval { run_command(['/sbin/sgdisk', '-d', $partnum, "${devpath}"]); };
                warn $@ if $@;
            };

            my $osd_list = PVE::Ceph::Tools::ceph_volume_list();

            if ($osd_list->{$osdid}) { # ceph-volume managed

                eval { PVE::Ceph::Tools::ceph_volume_zap($osdid, $cleanup) };
                warn $@ if $@;

                if ($cleanup) {
                    # try to remove pvs, but do not fail if it does not work
                    for my $osd_part (@{ $osd_list->{$osdid} }) {
                        for my $dev (@{ $osd_part->{devices} }) {
                            ($dev) = ($dev =~ m|^(/dev/[-_.a-zA-Z0-9\/]+)$|); #untaint

                            eval {
                                run_command(['/sbin/pvremove', $dev], errfunc => sub { });
                            };
                            warn $@ if $@;

                            $udev_trigger_devs->{$dev} = 1;
                        }
                    }
                }
            } else {
                my $partitions_to_remove = [];
                if ($cleanup) {
                    if (my $mp = PVE::ProcFSTools::parse_proc_mounts()) {
                        foreach my $line (@$mp) {
                            my ($dev, $path, $fstype) = @$line;
                            next if !($dev && $path && $fstype);
                            next if $dev !~ m|^/dev/|;

                            if ($path eq $mountpoint) {
                                abs_path($dev) =~ m|^(/.+)| or die "invalid dev: $dev\n";
                                push @$partitions_to_remove, $1;
                                last;
                            }
                        }
                    }

                    foreach my $path (qw(journal block block.db block.wal)) {
                        abs_path("$mountpoint/$path") =~ m|^(/.+)|
                            or die "invalid path: $path\n";
                        push @$partitions_to_remove, $1;
                    }
                }

                print "Unmount OSD $osdsection from  $mountpoint\n";
                eval { run_command(['/bin/umount', $mountpoint]); };
                if (my $err = $@) {
                    warn $err;
                } elsif ($cleanup) {
                    #be aware of the ceph udev rules which can remount.
                    foreach my $part (@$partitions_to_remove) {
                        $remove_partition->($part);
                    }
                }
            }

            # FIXME: Remove once we depend on systemd >= v249.
            # Work around udev bug https://github.com/systemd/systemd/issues/18525 to ensure the
            # udev database is updated.
            if ($cleanup) {
                eval { run_command(['udevadm', 'trigger', keys $udev_trigger_devs->%*]); };
                warn $@ if $@;
            }
        };

        return $rpcenv->fork_worker('cephdestroyosd', $osdsection, $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'in',
    path => '{osdid}/in',
    method => 'POST',
    description => "ceph osd in",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
            },
        },
    },
    returns => { type => "null" },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $osdid = $param->{osdid};

        my $rados = PVE::RADOS->new();

        $get_osd_status->($rados, $osdid); # osd exists?

        my $osdsection = "osd.$osdid";

        $rados->mon_command({ prefix => "osd in", ids => [$osdsection], format => 'plain' });

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'out',
    path => '{osdid}/out',
    method => 'POST',
    description => "ceph osd out",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
            },
        },
    },
    returns => { type => "null" },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $osdid = $param->{osdid};

        my $rados = PVE::RADOS->new();

        $get_osd_status->($rados, $osdid); # osd exists?

        my $osdsection = "osd.$osdid";

        $rados->mon_command({ prefix => "osd out", ids => [$osdsection], format => 'plain' });

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'scrub',
    path => '{osdid}/scrub',
    method => 'POST',
    description => "Instruct the OSD to scrub.",
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => 'OSD ID',
                type => 'integer',
            },
            deep => {
                description => 'If set, instructs a deep scrub instead of a normal one.',
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => "null" },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $osdid = $param->{osdid};
        my $deep = $param->{deep} // 0;

        my $rados = PVE::RADOS->new();

        $get_osd_status->($rados, $osdid); # osd exists?

        my $prefix = $deep ? 'osd deep-scrub' : 'osd scrub';
        $rados->mon_command({ prefix => $prefix, who => $osdid });

        return undef;
    },
});

1;
