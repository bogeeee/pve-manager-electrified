package PVE::Ceph::Tools;

use strict;
use warnings;

use File::Path;
use File::Basename;
use IO::File;
use JSON;

use PVE::Tools qw(run_command dir_glob_foreach extract_param);
use PVE::Cluster qw(cfs_read_file);
use PVE::RADOS;
use PVE::Ceph::Services;
use PVE::CephConfig;

my $ccname = 'ceph'; # ceph cluster name
my $ceph_cfgdir = "/etc/ceph";
my $pve_ceph_cfgpath = "/etc/pve/$ccname.conf";
my $ceph_cfgpath = "$ceph_cfgdir/$ccname.conf";
my $pve_ceph_cfgdir = "/etc/pve/ceph";

my $pve_ceph_crash_key_path = "$pve_ceph_cfgdir/$ccname.client.crash.keyring";
my $pve_mon_key_path = "/etc/pve/priv/$ccname.mon.keyring";
my $pve_ckeyring_path = "/etc/pve/priv/$ccname.client.admin.keyring";
my $ckeyring_path = "/etc/ceph/ceph.client.admin.keyring";
my $ceph_bootstrap_osd_keyring = "/var/lib/ceph/bootstrap-osd/$ccname.keyring";
my $ceph_bootstrap_mds_keyring = "/var/lib/ceph/bootstrap-mds/$ccname.keyring";
my $ceph_mds_data_dir = '/var/lib/ceph/mds';

my $ceph_service = {
    ceph_bin => "/usr/bin/ceph",
    ceph_mon => "/usr/bin/ceph-mon",
    ceph_mgr => "/usr/bin/ceph-mgr",
    ceph_osd => "/usr/bin/ceph-osd",
    ceph_mds => "/usr/bin/ceph-mds",
    ceph_volume => '/usr/sbin/ceph-volume',
};

my $config_values = {
    ccname => $ccname,
    pve_ceph_cfgdir => $pve_ceph_cfgdir,
    ceph_mds_data_dir => $ceph_mds_data_dir,
    long_rados_timeout => 60,
};

my $config_files = {
    pve_ceph_cfgpath => $pve_ceph_cfgpath,
    pve_ceph_crash_key_path => $pve_ceph_crash_key_path,
    pve_mon_key_path => $pve_mon_key_path,
    pve_ckeyring_path => $pve_ckeyring_path,
    ceph_bootstrap_osd_keyring => $ceph_bootstrap_osd_keyring,
    ceph_bootstrap_mds_keyring => $ceph_bootstrap_mds_keyring,
    ceph_cfgpath => $ceph_cfgpath,
};

sub get_local_version {
    my ($noerr) = @_;

    return undef if !check_ceph_installed('ceph_bin', $noerr);

    my $ceph_version;
    run_command(
        [$ceph_service->{ceph_bin}, '--version'],
        noerr => $noerr,
        outfunc => sub { $ceph_version = shift if !defined $ceph_version },
    );

    return undef if !defined $ceph_version;

    my ($version, $buildcommit, $subversions) = parse_ceph_version($ceph_version);

    return undef if !defined($version);

    # return (version, buildid, [major, minor, ...]) : major;
    return wantarray ? ($version, $buildcommit, $subversions) : $subversions->[0];
}

sub parse_ceph_version : prototype($) {
    my ($ceph_version) = @_;

    my $re_ceph_version = qr/
	# Skip ahead to the version, which may optionally start with 'v'
	^ceph.*\sv?

	# Parse the version X.Y, X.Y.Z, etc.
	( \d+ (?:\.\d+)+ ) \s+

	# Parse the git commit hash between parentheses
	(?: \( ([a-zA-Z0-9]+) \) )
    /x;

    if ($ceph_version =~ /$re_ceph_version/) {
        my ($version, $buildcommit) = ($1, $2);
        my $subversions = [split(/\.|-/, $version)];

        # return (version, buildid, [major, minor, ...]) : major;
        return wantarray
            ? ($version, $buildcommit, $subversions)
            : $subversions->[0];
    }

    return undef;
}

sub get_cluster_versions {
    my ($service, $noerr) = @_;

    my $rados = PVE::RADOS->new();
    my $cmd = $service ? "$service versions" : 'versions';
    return $rados->mon_command({ prefix => $cmd });
}

sub get_config {
    my $key = shift;

    my $value = $config_values->{$key} // $config_files->{$key};

    die "no such ceph config '$key'" if !defined($value);

    return $value;
}

sub purge_all_ceph_files {
    my ($services) = @_;
    my $is_local_mon;
    my $monlist = [split(',', PVE::CephConfig::get_monaddr_list($pve_ceph_cfgpath))];

    foreach my $service (keys %$services) {
        my $type = $services->{$service};
        next if (!%$type);

        foreach my $name (keys %$type) {
            my $dir_exists = $type->{$name}->{direxists};

            $is_local_mon = grep($type->{$name}->{addr}, @$monlist)
                if $service eq 'mon';

            my $path = "/var/lib/ceph/$service";
            $path = '/var/log/ceph' if $service eq 'logs';
            if ($dir_exists) {
                my $err;
                File::Path::remove_tree(
                    $path,
                    {
                        keep_root => 1,
                        error => \$err,
                    },
                );
                warn "Error removing path, '$path'\n" if @$err;
            }
        }
    }

    if (scalar @$monlist > 0 && !$is_local_mon) {
        warn "Foreign MON address in ceph.conf. Keeping config & keyrings\n";
    } else {
        print "Removing config & keyring files\n";
        for my $file (%$config_files) {
            unlink $file if (-e $file);
        }
    }
}

sub purge_all_ceph_services {
    my ($services) = @_;

    foreach my $service (keys %$services) {
        my $type = $services->{$service};
        next if (!%$type);

        foreach my $name (keys %$type) {
            my $service_exists = $type->{$name}->{service};

            if ($service_exists) {
                eval { PVE::Ceph::Services::ceph_service_cmd('disable', "$service.$name") };
                warn "Could not disable ceph-$service\@$name, error: $@\n" if $@;

                eval { PVE::Ceph::Services::ceph_service_cmd('stop', "$service.$name") };
                warn "Could not stop ceph-$service\@$name, error: $@\n" if $@;
            }
        }
    }
}

sub ceph_install_flag_file { return '/run/pve-ceph-install-flag' }

sub check_ceph_installed {
    my ($service, $noerr) = @_;

    $service = 'ceph_bin' if !defined($service);

    # NOTE: the flag file is checked as on a new installation, the binary gets
    # extracted by dpkg before the installation is finished
    if (!-x $ceph_service->{$service} || -f ceph_install_flag_file()) {
        die "binary not installed: $ceph_service->{$service}\n" if !$noerr;
        return undef;
    }

    return 1;
}

sub check_ceph_configured {

    check_ceph_inited();

    die "ceph not fully configured - missing '$pve_ckeyring_path'\n"
        if !-f $pve_ckeyring_path;

    return 1;
}

sub check_ceph_inited {
    my ($noerr) = @_;

    return undef if !check_ceph_installed('ceph_mon', $noerr);

    my @errors;

    push(@errors, "missing '$pve_ceph_cfgpath'") if !-f $pve_ceph_cfgpath;
    push(@errors, "missing '$pve_ceph_cfgdir'") if !-d $pve_ceph_cfgdir;

    if (@errors) {
        my $err = 'pveceph configuration not initialized - ' . join(', ', @errors) . "\n";
        die $err if !$noerr;
        return undef;
    }

    return 1;
}

sub check_ceph_enabled {
    my ($noerr) = @_;

    return undef if !check_ceph_inited($noerr);

    if (!-f $ceph_cfgpath) {
        die "pveceph configuration not enabled\n" if !$noerr;
        return undef;
    }

    return 1;
}

my $set_pool_setting = sub {
    my ($pool, $setting, $value, $rados) = @_;

    my $command;
    if ($setting eq 'application') {
        $command = {
            prefix => "osd pool application enable",
            pool => "$pool",
            app => "$value",
        };
    } else {
        $command = {
            prefix => "osd pool set",
            pool => "$pool",
            var => "$setting",
            val => "$value",
            format => 'plain',
        };
    }

    $rados = PVE::RADOS->new() if !$rados;
    eval { $rados->mon_command($command); };
    return $@ ? $@ : undef;
};

sub set_pool {
    my ($pool, $param) = @_;

    my $rados = PVE::RADOS->new();

    if (get_pool_type($pool, $rados) eq 'erasure') {
        #remove parameters that cannot be changed for erasure coded pools
        my $ignore_params = ['size', 'crush_rule'];
        for my $setting (@$ignore_params) {
            if ($param->{$setting}) {
                print "cannot set '${setting}' for erasure coded pool\n";
                delete $param->{$setting};
            }
        }
    }
    # by default, pool size always resets min_size, so set it as first item
    # https://tracker.ceph.com/issues/44862
    my $keys = [grep { $_ ne 'size' } sort keys %$param];
    unshift @$keys, 'size' if exists $param->{size};

    my $current_properties = get_pool_properties($pool, $rados);

    for my $setting (@$keys) {
        my $value = $param->{$setting};

        if (defined($current_properties->{$setting}) && $value eq $current_properties->{$setting}) {
            print "skipping '${setting}', did not change\n";
            delete $param->{$setting};
            next;
        }

        print "pool $pool: applying $setting = $value\n";
        if (my $err = $set_pool_setting->($pool, $setting, $value, $rados)) {
            print "$err";
        } else {
            delete $param->{$setting};
        }
    }

    if (scalar(keys %$param) > 0) {
        my $missing = join(', ', sort keys %$param);
        die "Could not set: $missing\n";
    }

}

sub get_pool_properties {
    my ($pool, $rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);
    my $command = {
        prefix => "osd pool get",
        pool => "$pool",
        var => "all",
        format => 'json',
    };
    return $rados->mon_command($command);
}

sub get_pool_type {
    my ($pool, $rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);
    return 'erasure' if get_pool_properties($pool, $rados)->{erasure_code_profile};
    return 'replicated';
}

sub create_pool {
    my ($pool, $param, $rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);

    my $pg_num = $param->{pg_num} || 128;

    my $mon_params = {
        prefix => "osd pool create",
        pool => $pool,
        pg_num => int($pg_num),
        format => 'plain',
    };
    $mon_params->{pool_type} = extract_param($param, 'pool_type') if $param->{pool_type};
    $mon_params->{erasure_code_profile} = extract_param($param, 'erasure_code_profile')
        if $param->{erasure_code_profile};

    $rados->mon_command($mon_params);

    set_pool($pool, $param);

}

sub ls_pools {
    my ($pool, $rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);

    my $res = $rados->mon_command({ prefix => "osd lspools" });

    return $res;
}

sub destroy_pool {
    my ($pool, $rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);

    # fixme: '--yes-i-really-really-mean-it'
    $rados->mon_command({
        prefix => "osd pool delete",
        pool => $pool,
        pool2 => $pool,
        'yes_i_really_really_mean_it' => JSON::true,
        format => 'plain',
    });
}

# we get something like:
#[{
#   'metadata_pool_id' => 2,
#   'data_pool_ids' => [ 1 ],
#   'metadata_pool' => 'cephfs_metadata',
#   'data_pools' => [ 'cephfs_data' ],
#   'name' => 'cephfs',
#}]
sub ls_fs {
    my ($rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);

    my $res = $rados->mon_command({ prefix => "fs ls" });

    return $res;
}

sub create_fs {
    my ($fs, $param, $rados) = @_;

    if (!defined($rados)) {
        $rados = PVE::RADOS->new();
    }

    $rados->mon_command({
        prefix => "fs new",
        fs_name => $fs,
        metadata => $param->{pool_metadata},
        data => $param->{pool_data},
        format => 'plain',
    });
}

sub destroy_fs {
    my ($fs, $rados) = @_;
    $rados = PVE::RADOS->new() if !defined($rados);

    $rados->mon_command({
        prefix => "fs rm",
        fs_name => $fs,
        'yes_i_really_mean_it' => JSON::true,
        format => 'plain',
    });
}

sub setup_pve_symlinks {
    # fail if we find a real file instead of a link
    if (-f $ceph_cfgpath) {
        my $lnk = readlink($ceph_cfgpath);
        die "file '$ceph_cfgpath' already exists and is not a symlink to $pve_ceph_cfgpath\n"
            if !$lnk || $lnk ne $pve_ceph_cfgpath;
    } else {
        mkdir $ceph_cfgdir;
        symlink($pve_ceph_cfgpath, $ceph_cfgpath)
            || die "unable to create symlink '$ceph_cfgpath' - $!\n";
    }
    my $ceph_uid = getpwnam('ceph');
    my $ceph_gid = getgrnam('ceph');
    chown $ceph_uid, $ceph_gid, $ceph_cfgdir;
}

sub get_or_create_admin_keyring {
    if (!-f $pve_ckeyring_path) {
        run_command("ceph-authtool --create-keyring $pve_ckeyring_path "
            . "--gen-key -n client.admin "
            . "--cap mon 'allow *' "
            . "--cap osd 'allow *' "
            . "--cap mds 'allow *' "
            . "--cap mgr 'allow *' ");
        # we do not want to overwrite it
        if (!-f $ckeyring_path) {
            run_command("cp $pve_ckeyring_path $ckeyring_path");
            run_command("chown ceph:ceph $ckeyring_path");
        }
    }
    return $pve_ckeyring_path;
}

# is also used in `pve-init-ceph-crash` helper
sub create_or_update_crash_keyring_file {
    my ($rados) = @_;

    if (!defined($rados)) {
        $rados = PVE::RADOS->new();
    }

    my $output = $rados->mon_command({
        prefix => 'auth get-or-create',
        entity => 'client.crash',
        caps => [
            mon => 'profile crash',
            mgr => 'profile crash',
        ],
        format => 'plain',
    });

    if (-f $pve_ceph_crash_key_path) {
        my $contents = PVE::Tools::file_get_contents($pve_ceph_crash_key_path);

        if ($contents ne $output) {
            PVE::Tools::file_set_contents($pve_ceph_crash_key_path, $output);
            return 1;
        }
    } else {
        PVE::Tools::file_set_contents($pve_ceph_crash_key_path, $output);
        return 1;
    }

    return 0;
}

# get ceph-volume managed osds
sub ceph_volume_list {
    my $result = {};

    if (!check_ceph_installed('ceph_volume', 1)) {
        return $result;
    }

    my $output = '';
    my $cmd = [$ceph_service->{ceph_volume}, 'lvm', 'list', '--format', 'json'];
    run_command($cmd, outfunc => sub { $output .= shift });

    $result = eval { decode_json($output) };
    warn $@ if $@;
    return $result;
}

sub ceph_volume_zap {
    my ($osdid, $destroy) = @_;

    die "no osdid given\n" if !defined($osdid);

    my $cmd = [$ceph_service->{ceph_volume}, 'lvm', 'zap', '--osd-id', $osdid];
    push @$cmd, '--destroy' if $destroy;

    run_command($cmd);
}

sub get_db_wal_sizes {
    my $res = {};

    my $rados = PVE::RADOS->new();
    my $db_config = $rados->mon_command({ prefix => 'config-key dump', key => 'config/' });

    $res->{db} = $db_config->{"config/osd/bluestore_block_db_size"}
        // $db_config->{"config/global/bluestore_block_db_size"};

    $res->{wal} = $db_config->{"config/osd/bluestore_block_wal_size"}
        // $db_config->{"config/global/bluestore_block_wal_size"};

    if (!$res->{db} || !$res->{wal}) {
        my $cfg = cfs_read_file('ceph.conf');
        if (!$res->{db}) {
            $res->{db} = $cfg->{osd}->{bluestore_block_db_size}
                // $cfg->{global}->{bluestore_block_db_size};
        }

        if (!$res->{wal}) {
            $res->{wal} = $cfg->{osd}->{bluestore_block_wal_size}
                // $cfg->{global}->{bluestore_block_wal_size};
        }
    }

    return $res;
}

sub get_possible_osd_flags {
    my $possible_flags = {
        pause => {
            description => 'Pauses read and writes.',
            type => 'boolean',
            optional => 1,
        },
        noup => {
            description => 'OSDs are not allowed to start.',
            type => 'boolean',
            optional => 1,
        },
        nodown => {
            description =>
                'OSD failure reports are being ignored, such that the monitors will not mark OSDs down.',
            type => 'boolean',
            optional => 1,
        },
        noout => {
            description =>
                'OSDs will not automatically be marked out after the configured interval.',
            type => 'boolean',
            optional => 1,
        },
        noin => {
            description =>
                'OSDs that were previously marked out will not be marked back in when they start.',
            type => 'boolean',
            optional => 1,
        },
        nobackfill => {
            description => 'Backfilling of PGs is suspended.',
            type => 'boolean',
            optional => 1,
        },
        norebalance => {
            description => 'Rebalancing of PGs is suspended.',
            type => 'boolean',
            optional => 1,
        },
        norecover => {
            description => 'Recovery of PGs is suspended.',
            type => 'boolean',
            optional => 1,
        },
        noscrub => {
            description => 'Scrubbing is disabled.',
            type => 'boolean',
            optional => 1,
        },
        'nodeep-scrub' => {
            description => 'Deep Scrubbing is disabled.',
            type => 'boolean',
            optional => 1,
        },
        notieragent => {
            description => 'Cache tiering activity is suspended.',
            type => 'boolean',
            optional => 1,
        },
    };
    return $possible_flags;
}

sub get_real_flag_name {
    my ($flag) = @_;

    # the 'pause' flag gets always set to both 'pauserd' and 'pausewr'
    # so decide that the 'pause' flag is set if we detect 'pauserd'
    my $flagmap = {
        'pause' => 'pauserd',
    };

    return $flagmap->{$flag} // $flag;
}

sub ceph_cluster_status {
    my ($rados) = @_;
    $rados = PVE::RADOS->new() if !$rados;

    my $status = $rados->mon_command({ prefix => 'status' });
    $status->{health} = $rados->mon_command({ prefix => 'health', detail => 'detail' });

    if (!exists $status->{monmap}->{mons}) { # octopus moved most info out of status, re-add
        $status->{monmap} = $rados->mon_command({ prefix => 'mon dump' });
        $status->{mgrmap} = $rados->mon_command({ prefix => 'mgr dump' });
    }

    return $status;
}

sub ecprofile_exists {
    my ($name, $rados) = @_;
    $rados = PVE::RADOS->new() if !$rados;

    my $res = $rados->mon_command({ prefix => 'osd erasure-code-profile ls' });

    my $profiles = { map { $_ => 1 } @$res };
    return $profiles->{$name};
}

sub create_ecprofile {
    my ($name, $k, $m, $failure_domain, $device_class, $rados) = @_;
    $rados = PVE::RADOS->new() if !$rados;

    $failure_domain = 'host' if !$failure_domain;

    my $profile = [
        "crush-failure-domain=${failure_domain}", "k=${k}", "m=${m}",
    ];

    push(@$profile, "crush-device-class=${device_class}") if $device_class;

    $rados->mon_command({
        prefix => 'osd erasure-code-profile set',
        name => $name,
        profile => $profile,
    });
}

sub destroy_ecprofile {
    my ($profile, $rados) = @_;
    $rados = PVE::RADOS->new() if !$rados;

    my $command = {
        prefix => 'osd erasure-code-profile rm',
        name => $profile,
        format => 'plain',
    };
    return $rados->mon_command($command);
}

sub get_ecprofile_name {
    my ($name) = @_;
    return "pve_ec_${name}";
}

sub destroy_crush_rule {
    my ($rule, $rados) = @_;
    $rados = PVE::RADOS->new() if !$rados;

    my $command = {
        prefix => 'osd crush rule rm',
        name => $rule,
        format => 'plain',
    };
    return $rados->mon_command($command);
}

1;
