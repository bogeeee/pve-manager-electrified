package PVE::Ceph::Services;

use strict;
use warnings;

use PVE::Ceph::Tools;
use PVE::Cluster qw(cfs_read_file);
use PVE::Tools qw(run_command);
use PVE::RADOS;

use JSON;
use File::Path;

use constant SERVICE_REGEX => '[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?';

# checks /etc/systemd/system/ceph-* to list all services, even if not running
# also checks /var/lib/ceph/$type
sub get_local_services {
    my $res = {};

    for my $type (qw(mds mgr mon)) {
        $res->{$type} = {};

        my $path = "/etc/systemd/system/ceph-$type.target.wants";
        my $regex = "ceph-$type\@(.*)\.service";
        PVE::Tools::dir_glob_foreach(
            $path,
            $regex,
            sub {
                my (undef, $id) = @_;
                $res->{$type}->{$id}->{service} = 1;
            },
        );

        $path = "/var/lib/ceph/$type";
        $regex = "([^-]+)-(.*)";
        PVE::Tools::dir_glob_foreach(
            $path,
            $regex,
            sub {
                my (undef, $clustername, $id) = @_;
                $res->{$type}->{$id}->{direxists} = 1;
            },
        );
    }
    return $res;
}

sub broadcast_ceph_services {
    my $services = get_local_services();

    for my $type (keys %$services) {
        my $data = encode_json($services->{$type});
        PVE::Cluster::broadcast_node_kv("ceph-$type", $data);
    }
}

sub broadcast_ceph_versions {
    my ($version, $buildcommit, $vers_parts) = PVE::Ceph::Tools::get_local_version(1);

    return undef if !$version;

    my $nodename = PVE::INotify::nodename();
    my $old_versions = PVE::Cluster::get_node_kv("ceph-versions", $nodename);
    if (length(my $old_version_raw = $old_versions->{$nodename})) {
        my $old = eval { decode_json($old_version_raw) };
        warn "failed to parse ceph-versions '$old_version_raw' as JSON - $@" if $@; # should not happen
        if (
            defined($old)
            && $old->{buildcommit} eq $buildcommit
            && $old->{version}->{str} eq $version
        ) {
            return; # up to date, nothing to do so avoid (not exactly cheap) broadcast
        }
    }

    my $node_versions = {
        version => {
            str => $version,
            parts => $vers_parts,
        },
        buildcommit => $buildcommit,
    };
    PVE::Cluster::broadcast_node_kv("ceph-versions", encode_json($node_versions));
}

sub get_ceph_versions {
    my $res;

    if (defined(my $versions = PVE::Cluster::get_node_kv("ceph-versions"))) {
        $res = {
            map {
                eval { $_ => decode_json($versions->{$_}) }
            } keys %$versions
        };
    }

    return $res;
}

sub get_cluster_service {
    my ($type) = @_;

    my $raw = PVE::Cluster::get_node_kv("ceph-$type");
    my $res = {
        map {
            $_ => eval { decode_json($raw->{$_}) }
        } keys $raw->%*
    };

    return $res;
}

sub ceph_service_cmd {
    my ($action, $service) = @_;

    if ($service && $service =~ m/^(mon|osd|mds|mgr|radosgw)(\.(${\SERVICE_REGEX}))?$/) {
        $service = defined($3) ? "ceph-$1\@$3" : "ceph-$1.target";
    } else {
        $service = "ceph.target";
    }

    run_command(['/bin/systemctl', $action, $service]);
}

sub get_services_info {
    my ($type, $cfg, $rados) = @_;

    my $result = {};
    my $services = get_cluster_service($type);

    foreach my $host (sort keys %$services) {
        foreach my $id (sort keys %{ $services->{$host} }) {
            my $service = $result->{$id} = $services->{$host}->{$id};
            $service->{host} = $host;
            $service->{name} = $id;
            $service->{state} = 'unknown';
            if ($service->{service}) {
                $service->{state} = 'stopped';
            }
        }
    }

    if (!$cfg) {
        $cfg = cfs_read_file('ceph.conf');
    }

    foreach my $section (keys %$cfg) {
        my $d = $cfg->{$section};
        if ($section =~ m/^$type\.(\S+)$/) {
            my $id = $1;
            my $service = $result->{$id};
            my $addr = $d->{"${type}_addr"} // $d->{public_addr} // $d->{host};
            $service->{name} //= $id;
            $service->{addr} //= $addr;
            $service->{state} //= 'unknown';
            $service->{host} //= $d->{host};
        }
    }

    if (!$rados) {
        return $result;
    }

    my $metadata = $rados->mon_command({ prefix => "$type metadata" });
    foreach my $info (@$metadata) {
        my $id = $info->{name} // $info->{id};
        my $service = $result->{$id};
        $service->{ceph_version_short} = $info->{ceph_version_short};
        $service->{ceph_version} = $info->{ceph_version};
        $service->{host} //= $info->{hostname};
        $service->{addr} //= $info->{addr};
    }

    return $result;
}

# MDS

sub list_local_mds_ids {
    my $mds_list = [];
    my $ceph_mds_data_dir = PVE::Ceph::Tools::get_config('ceph_mds_data_dir');
    my $ccname = PVE::Ceph::Tools::get_config('ccname');

    PVE::Tools::dir_glob_foreach(
        $ceph_mds_data_dir,
        qr/$ccname-(\S+)/,
        sub {
            my (undef, $mds_id) = @_;
            push @$mds_list, $mds_id;
        },
    );

    return $mds_list;
}

sub get_cluster_mds_state {
    my ($rados) = @_;

    my $mds_state = {};

    if (!defined($rados)) {
        $rados = PVE::RADOS->new();
    }

    my $add_state = sub {
        my ($mds, $fsname) = @_;

        my $state = {};
        $state->{addr} = $mds->{addr};
        $state->{rank} = $mds->{rank};
        $state->{standby_replay} = $mds->{standby_replay} ? 1 : 0;
        $state->{state} = $mds->{state};
        $state->{fs_name} = $fsname;

        $mds_state->{ $mds->{name} } = $state;
    };

    my $mds_dump = $rados->mon_command({ prefix => 'mds stat' });
    my $fsmap = $mds_dump->{fsmap};

    foreach my $mds (@{ $fsmap->{standbys} }) {
        $add_state->($mds);
    }

    for my $fs_info (@{ $fsmap->{filesystems} }) {
        my $active_mds = $fs_info->{mdsmap}->{info};

        # normally there's only one active MDS, but we can have multiple active for
        # different ranks (e.g., different cephs path hierarchy). So just add all.
        foreach my $mds (values %$active_mds) {
            $add_state->($mds, $fs_info->{mdsmap}->{fs_name});
        }
    }

    return $mds_state;
}

sub is_mds_active {
    my ($rados, $fs_name) = @_;

    if (!defined($rados)) {
        $rados = PVE::RADOS->new();
    }

    my $mds_dump = $rados->mon_command({ prefix => 'mds stat' });
    my $fsmap = $mds_dump->{fsmap}->{filesystems};

    if (!($fsmap && scalar(@$fsmap) > 0)) {
        return undef;
    }
    for my $fs (@$fsmap) {
        next if defined($fs_name) && $fs->{mdsmap}->{fs_name} ne $fs_name;

        my $active_mds = $fs->{mdsmap}->{info};
        for my $mds (values %$active_mds) {
            return 1 if $mds->{state} eq 'up:active';
        }
    }

    return 0;
}

sub create_mds {
    my ($id, $rados) = @_;

    # `ceph fs status` fails with numeric only ID.
    die "ID: $id, numeric only IDs are not supported\n"
        if $id =~ /^\d+$/;

    if (!defined($rados)) {
        $rados = PVE::RADOS->new();
    }

    my $ccname = PVE::Ceph::Tools::get_config('ccname');
    my $service_dir = "/var/lib/ceph/mds/$ccname-$id";
    my $service_keyring = "$service_dir/keyring";
    my $service_name = "mds.$id";

    die "ceph MDS directory '$service_dir' already exists\n"
        if -d $service_dir;

    print "creating MDS directory '$service_dir'\n";
    eval { File::Path::mkpath($service_dir) };
    my $err = $@;
    die "creation MDS directory '$service_dir' failed\n" if $err;

    # http://docs.ceph.com/docs/luminous/install/manual-deployment/#adding-mds
    my $priv = [
        mon => 'allow profile mds',
        osd => 'allow rwx',
        mds => 'allow *',
    ];

    print "creating keys for '$service_name'\n";
    my $output = $rados->mon_command({
        prefix => 'auth get-or-create',
        entity => $service_name,
        caps => $priv,
        format => 'plain',
    });

    PVE::Tools::file_set_contents($service_keyring, $output);

    print "setting ceph as owner for service directory\n";
    run_command(["chown", 'ceph:ceph', '-R', $service_dir]);

    print "enabling service 'ceph-mds\@$id.service'\n";
    ceph_service_cmd('enable', $service_name);
    print "starting service 'ceph-mds\@$id.service'\n";
    ceph_service_cmd('start', $service_name);

    broadcast_ceph_services();

    return undef;
}

sub destroy_mds {
    my ($id, $rados) = @_;

    if (!defined($rados)) {
        $rados = PVE::RADOS->new();
    }

    my $ccname = PVE::Ceph::Tools::get_config('ccname');

    my $service_name = "mds.$id";
    my $service_dir = "/var/lib/ceph/mds/$ccname-$id";

    print "disabling service 'ceph-mds\@$id.service'\n";
    ceph_service_cmd('disable', $service_name);
    print "stopping service 'ceph-mds\@$id.service'\n";
    ceph_service_cmd('stop', $service_name);

    if (-d $service_dir) {
        print "removing ceph-mds directory '$service_dir'\n";
        File::Path::remove_tree($service_dir);
    } else {
        warn "cannot cleanup MDS $id directory, '$service_dir' not found\n";
    }

    print "removing ceph auth for '$service_name'\n";
    $rados->mon_command({
        prefix => 'auth del',
        entity => $service_name,
        format => 'plain',
    });

    broadcast_ceph_services();

    return undef;
}

# MGR

sub create_mgr {
    my ($id, $rados) = @_;

    my $clustername = PVE::Ceph::Tools::get_config('ccname');
    my $mgrdir = "/var/lib/ceph/mgr/$clustername-$id";
    my $mgrkeyring = "$mgrdir/keyring";
    my $mgrname = "mgr.$id";

    die "ceph manager directory '$mgrdir' already exists\n" if -d $mgrdir;

    print "creating manager directory '$mgrdir'\n";
    mkdir $mgrdir;
    print "creating keys for '$mgrname'\n";
    my $output = $rados->mon_command({
        prefix => 'auth get-or-create',
        entity => $mgrname,
        caps => [
            mon => 'allow profile mgr',
            osd => 'allow *',
            mds => 'allow *',
        ],
        format => 'plain',
    });
    PVE::Tools::file_set_contents($mgrkeyring, $output);

    print "setting owner for directory\n";
    run_command(["chown", 'ceph:ceph', '-R', $mgrdir]);

    print "enabling service 'ceph-mgr\@$id.service'\n";
    ceph_service_cmd('enable', $mgrname);
    print "starting service 'ceph-mgr\@$id.service'\n";
    ceph_service_cmd('start', $mgrname);

    broadcast_ceph_services();

    return undef;
}

sub destroy_mgr {
    my ($mgrid, $rados) = @_;

    my $clustername = PVE::Ceph::Tools::get_config('ccname');
    my $mgrname = "mgr.$mgrid";
    my $mgrdir = "/var/lib/ceph/mgr/$clustername-$mgrid";

    die "ceph manager directory '$mgrdir' not found\n"
        if !-d $mgrdir;

    print "disabling service 'ceph-mgr\@$mgrid.service'\n";
    ceph_service_cmd('disable', $mgrname);
    print "stopping service 'ceph-mgr\@$mgrid.service'\n";
    ceph_service_cmd('stop', $mgrname);

    print "removing manager directory '$mgrdir'\n";
    File::Path::remove_tree($mgrdir);

    print "removing authkeys for $mgrname\n";
    if (!$rados) {
        $rados = PVE::RADOS->new();
    }

    $rados->mon_command({ prefix => 'auth del', entity => "$mgrname" });

    broadcast_ceph_services();

    return undef;
}

1;
