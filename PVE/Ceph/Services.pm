package PVE::Ceph::Services;

use strict;
use warnings;

use PVE::Ceph::Tools;
use PVE::Cluster qw(cfs_read_file);
use PVE::INotify;
use PVE::Tools qw(run_command lock_file_full);
use PVE::RADOS;

use JSON;
use File::Path;
use POSIX ();
use Time::HiRes qw(time);

use constant SERVICE_REGEX => '[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?';

# Scans both /etc/systemd/system/ and /run/systemd/system/ for enabled ceph-$type
# units (pveceph create-* uses persistent enable for mon/mgr/mds; ceph-volume
# uses --runtime enable for OSDs, which lands in /run), plus /var/lib/ceph/$type
# for data directories.
sub get_local_services {
    my $res = {};

    for my $type (qw(mds mgr mon osd)) {
        $res->{$type} = {};

        for my $base ('/etc/systemd/system', '/run/systemd/system') {
            my $path = "$base/ceph-$type.target.wants";
            my $regex = "ceph-$type\@(.*)\.service";
            PVE::Tools::dir_glob_foreach(
                $path,
                $regex,
                sub {
                    my (undef, $id) = @_;
                    $res->{$type}->{$id}->{service} = JSON::true;
                },
            );
        }

        my $path = "/var/lib/ceph/$type";
        my $regex = "([^-]+)-(.*)";
        PVE::Tools::dir_glob_foreach(
            $path,
            $regex,
            sub {
                my (undef, $clustername, $id) = @_;
                $res->{$type}->{$id}->{direxists} = JSON::true;
            },
        );
    }
    return $res;
}

sub broadcast_ceph_services {
    my $services = get_local_services();

    my $nodename = PVE::INotify::nodename();
    my $json = JSON->new->canonical(1); # canonical for stable string comparison below

    for my $type (keys %$services) {
        my $data = $json->encode($services->{$type});
        my $old = PVE::Cluster::get_node_kv("ceph-$type", $nodename);
        my $old_raw = $old->{$nodename} // '';
        next if length($old_raw) && $old_raw eq $data; # unchanged, skip the (not cheap) broadcast
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

# Ceph metadata can report an FQDN while Proxmox VE node names use the first label. A match is a
# candidate location, not proof of daemon identity: an unrelated domain can share that label.
sub metadata_host_node {
    my ($hostname, $nodes) = @_;

    return $hostname if !defined($hostname) || ref($hostname) || !length($hostname);
    return $hostname if $nodes->{$hostname};

    my ($short) = $hostname =~ m/^([^.]+)\./;
    return defined($short) && $nodes->{$short} ? $short : $hostname;
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
        $state->{standby_replay} = $mds->{standby_replay} ? JSON::true : JSON::false;
        $state->{state} = $mds->{state};
        $state->{fs_name} = $fsname if defined($fsname);

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

    PVE::Tools::file_set_contents($service_keyring, $output, 0600);

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
    PVE::Tools::file_set_contents($mgrkeyring, $output, 0600);

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

# Returns an arrayref of 'osd.<id>' daemon strings (suitable for ceph_service_cmd) for
# all OSDs on the local node. Source is the local systemd / /var/lib/ceph view via
# get_local_services(), so the caller must run on the target node (typically via
# proxyto => 'node'). $rados and $nodename are accepted for API symmetry with the
# pre-existing per-type helpers and are unused for the OSD path. Only OSDs are
# supported: cluster-wide MON/MGR/MDS enumeration goes through get_services_info
# directly in the cluster endpoint.
sub get_node_daemons {
    my ($rados, $type, $nodename) = @_;

    die "get_node_daemons only supports type 'osd', got '$type'\n" if $type ne 'osd';

    my $local_services = get_local_services();
    my $osd_services = $local_services->{osd} // {};

    # Require both a numeric id and an enabled systemd unit; data dirs without a
    # corresponding unit are not restartable via 'systemctl restart ceph-osd@N'.
    my @ids = grep { /^[0-9]+$/ && $osd_services->{$_}->{service} } keys %$osd_services;
    return [map { "osd.$_" } sort { $a <=> $b } @ids];
}

# Returns the locally-installed ceph-<daemon_type> binary version, parsed from its --version
# output. Captures the "<X.Y.Z[-suffix]> (<commit>)" tuple so a same-version rebuild with a
# different commit still counts as outdated. Returns undef if the binary is missing or
# unparseable.
sub get_local_ceph_binary_version {
    my ($daemon_type) = @_;
    $daemon_type //= 'osd';
    my $bin = "/usr/bin/ceph-$daemon_type";
    return undef if !-x $bin;

    my $out = '';
    eval {
        run_command([$bin, '--version'],
            outfunc => sub { $out .= "$_[0]\n" if !length($out); });
    };
    return undef if $@;

    return $1 if $out =~ /^ceph version (\S+ \([0-9a-f]+\))/;
    return $1 if $out =~ /^ceph version (\S+)/;
    return undef;
}

# Filter <type>.<id> daemons to those whose running version != $local_version. Looks up running
# versions via '<type> metadata'. Daemons absent from metadata are kept (unknown != installed
# is safer than silently skipping). Dies on metadata fetch failure.
sub filter_outdated_daemons {
    my ($rados, $daemon_type, $daemons, $local_version) = @_;
    die "filter_outdated_daemons: local_version required\n" if !defined($local_version);

    my $metadata =
        eval { $rados->mon_command({ prefix => "$daemon_type metadata", format => 'json' }) };
    die "could not fetch '$daemon_type metadata' for outdated filter: $@\n" if $@;
    die "could not fetch '$daemon_type metadata': unexpected response shape\n"
        if ref($metadata) ne 'ARRAY';

    my %running_ver;
    for my $m (@$metadata) {
        my $id = $m->{id} // $m->{name};
        next if !defined($id);
        my $ver = $m->{ceph_version} // '';
        if ($ver =~ /^ceph version (\S+ \([0-9a-f]+\))/) {
            $running_ver{$id} = $1;
        } elsif ($ver =~ /^ceph version (\S+)/) {
            $running_ver{$id} = $1;
        }
    }

    my @outdated;
    for my $daemon (@$daemons) {
        my $id = $daemon =~ s/^\Q$daemon_type\E\.//r;
        # OSD metadata indexes by integer, MON/MGR/MDS by string; try both.
        my $rv = $running_ver{$id} // ($id =~ /^[0-9]+$/ ? $running_ver{ int($id) } : undef);
        push @outdated, $daemon if !defined($rv) || $rv ne $local_version;
    }
    return \@outdated;
}

# Health checks that are safe to ignore during a bulk restart: things that do not materially
# affect rolling-restart safety (the per-step ok-to-stop check still gates every daemon).
#
# The AUTH_INSECURE_* entries only describe cephx key posture, never availability, and every
# cluster upgraded to ceph 19.2.6 or 20.2.4 raises them (two as HEALTH_ERR) until its keys are
# migrated - which needs all monitors restarted first, so blocking on them is circular.
# AUTH_BAD_CAPS (real corruption) and AUTH_EMERGENCY_CIPHERS_SET (policy override) stay out.
my %BENIGN_HEALTH_CHECKS = map { $_ => 1 } qw(
    MON_CLOCK_SKEW
    RECENT_CRASH
    TELEMETRY_CHANGED
    AUTH_INSECURE_GLOBAL_ID_RECLAIM_ALLOWED
    AUTH_INSECURE_GLOBAL_ID_RECLAIM
    BLUESTORE_BLUEFS_OVERSIZED
    BLUESTORE_DISK_SIZE_MISMATCH
    BLUESTORE_SLOW_OP_ALERT
    PG_NOT_SCRUBBED
    PG_NOT_DEEP_SCRUBBED
    LARGE_OMAP_OBJECTS
    AUTH_INSECURE_KEYS_ALLOWED
    AUTH_INSECURE_KEYS_CREATABLE
    AUTH_INSECURE_SERVICE_TICKETS
    AUTH_INSECURE_CLIENT_KEY_TYPE
    AUTH_INSECURE_SERVICE_KEY_TYPE
    AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE
);

# OSDMAP_FLAGS check is acceptable only if every cluster-wide OSD flag that
# is set comes from this allowlist. The first group is operator-relevant but
# rolling-restart-safe (or actively wanted, in noout's case); the second is
# always-on internal Ceph format flags that ceph reports under 'flags' but
# never count as a real WARN to a human operator.
my %BENIGN_OSDMAP_FLAGS = map { $_ => 1 } qw(
    noout
    noscrub
    nodeep-scrub
    nosnaptrim
    noautoscale
    notieragent
    sortbitwise
    recovery_deletes
    purged_snapdirs
    pglog_hardlimit
);

# An unknown or missing severity ranks worst, so an unexpected ceph value fails closed.
my %HEALTH_SEVERITY_RANK = (
    HEALTH_OK => 0,
    HEALTH_WARN => 1,
    HEALTH_ERR => 2,
);

# OSDMAP_FLAGS carries no verdict of its own, only the flags, so judge those: safe exactly when
# every cluster-wide flag that is set is allowlisted. A failed fetch counts as unsafe, since we
# cannot tell what is set. Returns ($safe, \@bad_flags, $fetch_error).
sub osdmap_flags_verdict {
    my ($rados) = @_;

    my $dump = eval { $rados->mon_command({ prefix => 'osd dump', format => 'json' }) };
    if ($@ || ref($dump) ne 'HASH') {
        my $err = $@ ? "$@" : 'unexpected response shape';
        chomp $err;
        return (0, [], $err);
    }
    my @bad = grep { !$BENIGN_OSDMAP_FLAGS{$_} } sort split(/\s*,\s*/, $dump->{flags} // '');

    return (scalar(@bad) ? 0 : 1, \@bad, undef);
}

# Classifies a 'ceph health' response for rolling restarts, returning ($worst_blocking_severity,
# \@blockers, \@ignored_names, \@error_blockers, \%blocking_severity_by_name), with the severity
# undef if nothing blocks. Each check is judged on its own severity, not on the aggregate status,
# so one we ignore cannot block.
sub classify_health_checks {
    my ($rados, $health, $service_type) = @_;

    my $checks = $health->{checks} // {};

    my $worst;
    my (@blockers, @error_blockers, @ignored);
    my $blocking = {};

    my $add_blocker = sub {
        my ($name, $msg) = @_;

        my $severity = $checks->{$name}->{severity} // '';
        $severity = 'HEALTH_ERR' if !defined($HEALTH_SEVERITY_RANK{$severity});

        # Ceph reports HEALTH_OK for a mgr-module check whose severity it did not recognize,
        # and a check ceph itself calls OK is nothing to refuse a rolling restart over.
        if ($severity eq 'HEALTH_OK') {
            push @ignored, $name;
            return;
        }

        $worst = $severity
            if !defined($worst)
            || $HEALTH_SEVERITY_RANK{$severity} > $HEALTH_SEVERITY_RANK{$worst};

        $blocking->{$name} = $severity;
        push @blockers, "$name: $msg";
        push @error_blockers, "$name: $msg" if $severity eq 'HEALTH_ERR';
    };

    for my $name (sort keys %$checks) {
        next if ref($checks->{$name}) ne 'HASH';

        if ($BENIGN_HEALTH_CHECKS{$name}) {
            push @ignored, $name;
            next;
        }

        if ($name eq 'OSDMAP_FLAGS') {
            # Every flag in the osdmap governs OSD behaviour: up/down/in/out marking, recovery,
            # scrubbing, client IO. None of it reaches mon quorum, mgr failover or MDS takeover,
            # and only the OSD branch of daemon_is_up() reads the osdmap at all. An undefined
            # type means the caller does not know, so judge it then.
            if (defined($service_type) && $service_type ne 'osd') {
                push @ignored, $name;
                next;
            }

            my ($safe, $bad, $err) = osdmap_flags_verdict($rados);
            if ($err) {
                $add_blocker->(
                    $name, "could not fetch cluster flags to evaluate allowlist: $err",
                );
            } elsif ($safe) {
                push @ignored, $name;
            } else {
                $add_blocker->(
                    $name,
                    "cluster-wide flag(s) interfering with rolling restart: "
                        . join(', ', @$bad),
                );
            }
            next;
        }

        # The monitors answer 'ok-to-stop' for mon and mds daemons, only the OSD variant goes
        # through the active manager. No other restart depends on one, and restarting the
        # managers is what brings one back, so refusing that would block the remedy.
        if ($name eq 'MGR_DOWN' && defined($service_type) && $service_type ne 'osd') {
            push @ignored, $name;
            next;
        }

        # Ceph leaves muted checks out of the cluster status, so do the same here. Stays below
        # the OSDMAP_FLAGS branch, as muting that check must not hide a nodown or noup flag.
        if ($checks->{$name}->{muted}) {
            push @ignored, "$name (muted in ceph)";
            next;
        }

        $add_blocker->($name, $checks->{$name}->{summary}->{message} // 'no message');
    }

    return ($worst, \@blockers, \@ignored, \@error_blockers, $blocking);
}

# Maps every health check to the daemon types whose restart it refuses, as
# { <check> => { osd => 0|1, mon => 0|1, mgr => 0|1, mds => 0|1 } }. The only place that
# answers this, so no caller needs its own allowlist. OSDMAP_FLAGS depends on which flags
# are set, so the answer has to come from the classifier and cannot be a static list.
sub restart_blocking_by_type {
    my ($rados, $health) = @_;

    my $checks = ref($health) eq 'HASH' ? $health->{checks} : undef;
    return {} if ref($checks) ne 'HASH';

    # two passes cover all four types, and the mon pass never fetches the osdmap
    my (undef, undef, undef, undef, $for_osd) = classify_health_checks($rados, $health, 'osd');
    my (undef, undef, undef, undef, $for_other) = classify_health_checks($rados, $health, 'mon');

    my $res = {};
    for my $name (keys %$checks) {
        next if ref($checks->{$name}) ne 'HASH';
        $res->{$name} = {
            osd => $for_osd->{$name} ? 1 : 0,
            mon => $for_other->{$name} ? 1 : 0,
            mgr => $for_other->{$name} ? 1 : 0,
            mds => $for_other->{$name} ? 1 : 0,
        };
    }

    return $res;
}

# Marks each check of a 'ceph status' reply with the daemon types it blocks, so the GUI does
# not need a second copy of this policy.
sub annotate_restart_blocking {
    my ($status, $rados) = @_;

    # Not a chained deref, that would autovivify 'health' on a status without any.
    return $status if ref($status->{health}) ne 'HASH';
    my $checks = $status->{health}->{checks};
    return $status if ref($checks) ne 'HASH';

    my $blocking = restart_blocking_by_type($rados, $status->{health});
    $checks->{$_}->{'blocks-restart'} = $blocking->{$_} for keys %$blocking;

    return $status;
}

# Returns ($acceptable, $severity, \@blocker_messages, \@ignored_check_names). The severity
# describes the checks that still block, not the cluster, so a HEALTH_ERR cluster whose firing
# checks are all ignored comes back as HEALTH_OK. $force_warn relaxes only the HEALTH_WARN path.
sub check_health_acceptable {
    my ($rados, $force_warn, $service_type) = @_;

    my $health = eval { $rados->mon_command({ prefix => 'health' }) };
    return (0, 'HEALTH_FETCH_FAIL', ["could not get ceph health: " . ($@ || 'no data')], [])
        if $@ || ref($health) ne 'HASH';

    my ($worst, $blockers, $ignored) = classify_health_checks($rados, $health, $service_type);

    return (1, 'HEALTH_OK', [], $ignored) if !defined($worst);
    return (0, 'HEALTH_ERR', $blockers, $ignored) if $worst eq 'HEALTH_ERR';

    return ($force_warn ? 1 : 0, 'HEALTH_WARN', $blockers, $ignored);
}

# The blocking HEALTH_ERR checks, for the re-checks between rolling-restart steps: those must
# abort when the cluster degrades underneath them, but must not trip over what the entry gate
# already ignored. Warnings are left out because a restart causes them by itself, PG_DEGRADED
# in particular. A failing health command is left to propagate to the caller.
sub get_blocking_health_errors {
    my ($rados, $service_type) = @_;

    my $health = $rados->mon_command({ prefix => 'health' });
    return [] if !$health;

    my (undef, undef, undef, $errors) = classify_health_checks($rados, $health, $service_type);

    return $errors;
}

# The cephx aes256k cipher landed in these Ceph releases. Daemons and librados clients from
# before that cannot use such a key at all, so the running versions gate the whole migration.
my $AES256K_MIN_CEPH_RELEASE = {
    19 => [19, 2, 6],
    20 => [20, 2, 4],
};

# The in-kernel ceph clients (krbd, kernel cephfs) speak aes256k from this kernel major on. A
# node that merely has 7.0 installed but still runs 6.x cannot take an aes256k client key.
my $AES256K_MIN_KERNEL_MAJOR = 7;

# The monmap feature (FEATURE_CEPHX_AUTH_AES256K) that every monitor in the quorum has to
# advertise before any aes256k cipher can be set, so it gates every migration step.
my $AES256K_MON_FEATURE = 'cephx_auth_aes256k';

my $AES256K_CIPHER = 'aes256k';
my $CEPHX_MIGRATION_HELPER = '/usr/share/pve-manager/migrations/pve-cephx-rotate-service-keys';

# Health checks that enumerate the entities still on an old cipher, per entity class. Used as
# the fallback source when 'auth dump-keys' is not available.
my $INSECURE_KEY_TYPE_CHECKS = {
    service => 'AUTH_INSECURE_SERVICE_KEY_TYPE',
    client => 'AUTH_INSECURE_CLIENT_KEY_TYPE',
};

# Takes the full 'ceph version X.Y.Z (<commit>) <name>' string or the bare 'X.Y.Z' of
# 'ceph_version_short'. Returns undef when neither parses, so callers can tell that from a no.
sub ceph_version_supports_aes256k {
    my ($version_string) = @_;

    return undef if !defined($version_string);

    my (undef, undef, $parts) = PVE::Ceph::Tools::parse_ceph_version($version_string);

    # parse_ceph_version insists on the full string down to the commit hash, so a bare
    # version and a dev build carrying a git-describe suffix both fall through to here
    if (ref($parts) ne 'ARRAY') {
        # anchored like parse_ceph_version, so a number in front of the release such as a
        # build date or a package epoch cannot win over it
        my ($short) = $version_string =~ m/^(?:ceph\s+version\s+)?v?(\d+(?:\.\d+)+)/;
        return undef if !defined($short);
        $parts = [split(/\./, $short)];
    }

    my @have = map { $parts->[$_] // 0 } 0 .. 2;
    return undef if grep { $_ !~ /^\d+$/ } @have;

    my $min = $AES256K_MIN_CEPH_RELEASE->{ $have[0] };
    if (!defined($min)) {
        # the cipher landed mid-release, so only majors past the known ones always carry it
        my @known = sort { $a <=> $b } keys %$AES256K_MIN_CEPH_RELEASE;
        return $have[0] > $known[-1] ? 1 : 0;
    }

    for my $i (0 .. 2) {
        return 1 if $have[$i] > $min->[$i];
        return 0 if $have[$i] < $min->[$i];
    }
    return 1;
}

# Judges a kernel release as uname reports it, undef if it does not start with a major number.
sub kernel_supports_aes256k {
    my ($release) = @_;

    return undef if !defined($release) || $release !~ m/^(\d+)/;
    return $1 >= $AES256K_MIN_KERNEL_MAJOR ? 1 : 0;
}

# Ceph wraps ciphers inconsistently: the monmap settings use 'name', the auth dump 'type_str'. A
# bare string is taken as-is, for a release that does not wrap them at all.
my sub cipher_name {
    my ($cipher) = @_;

    return $cipher->{name} // $cipher->{type_str} if ref($cipher) eq 'HASH';
    return ref($cipher) ? undef : $cipher;
}

# PVE has no cluster-wide kernel broadcast, so the local node comes from uname() and the others
# from what their ceph daemons reported on start. A node without one stays unknown, not guessed.
my sub collect_node_kernels {
    my ($rados) = @_;

    my $res = { map { $_ => {} } PVE::Cluster::get_nodelist()->@* };

    for my $type (qw(mon mgr mds osd)) {
        my $metadata =
            eval { $rados->mon_command({ prefix => "$type metadata", format => 'json' }) };
        next if $@ || ref($metadata) ne 'ARRAY';

        for my $daemon (@$metadata) {
            my ($host, $kernel) = $daemon->@{ 'hostname', 'kernel_version' };
            next if !defined($host) || !defined($kernel);
            $res->{$host}->{kernel} //= $kernel;
            $res->{$host}->{source} //= 'ceph daemon metadata';
        }
    }

    # uname() beats the daemon metadata, which is only as fresh as the daemon's last start
    my (undef, undef, $release) = POSIX::uname();
    $res->{ PVE::INotify::nodename() } = { kernel => $release, source => 'uname' };

    for my $node (keys %$res) {
        my $supported = kernel_supports_aes256k($res->{$node}->{kernel});
        $res->{$node}->{'supports-aes256k'} = $supported if defined($supported);
    }

    return $res;
}

# Groups every cephx entity by class and cipher. Prefers 'auth dump-keys', which names the cipher
# per entity and, unlike 'auth ls', leaves the secrets out; falls back to the health check details.
my sub collect_entity_ciphers {
    my ($rados, $checks) = @_;

    # 'mon.' lives in the monitor keyring, not the auth database, so it shows up only once rotated
    my $res = {
        service => {},
        client => {},
        details => {},
        complete => 1,
        'pending-keys-known' => 0,
    };

    # Ceph classifies this as a write command though it changes nothing, so it is the one command
    # here that needs a reachable leader, and it refuses any format but json.
    my $dump = eval { $rados->mon_command({ prefix => 'auth dump-keys', format => 'json' }) };
    my $secrets = ref($dump) eq 'HASH' ? $dump->{data}->{secrets} : undef;

    if (ref($secrets) eq 'ARRAY') {
        my $pending = 0;
        for my $secret (@$secrets) {
            my ($type, $id) = ($secret->{entity} // {})->@{ 'type_str', 'id' };
            if (!defined($type) || !defined($id)) {
                $res->{complete} = 0;
                next;
            }

            my $auth = $secret->{auth} // {};
            my $cipher = cipher_name($auth->{key}) // 'unknown';
            my $class = $type eq 'client' ? 'client' : 'service';
            my $entity = "$type.$id";
            push $res->{$class}->{$cipher}->@*, $entity;

            my $pending_cipher =
                defined($auth->{pending_key})
                ? (cipher_name($auth->{pending_key}) // 'unknown')
                : 'none';
            $res->{details}->{$entity} = {
                class => $class,
                'current-cipher' => $cipher,
                $pending_cipher ne 'none' ? ('pending-cipher' => $pending_cipher) : (),
            };
            $pending++ if $pending_cipher ne 'none';
        }
        $res->{source} = 'auth dump-keys';
        $res->{'pending-keys'} = $pending;
        $res->{'pending-keys-known'} = $res->{complete};
    } else {
        for my $class (sort keys %$INSECURE_KEY_TYPE_CHECKS) {
            my $detail = ($checks->{ $INSECURE_KEY_TYPE_CHECKS->{$class} } // {})->{detail};
            for my $entry ((ref($detail) eq 'ARRAY' ? $detail : [])->@*) {
                my $message = $entry->{message} // '';
                next if $message !~ m/^entity (\S+) using insecure key type: (\S+)$/;
                push $res->{$class}->{$2}->@*, $1;
                $res->{details}->{$1} = {
                    class => $class,
                    'current-cipher' => $2,
                };
            }
        }
        $res->{source} = 'health check detail';
        $res->{complete} = 0; # these checks only name what is still on an old cipher
    }

    for my $class (qw(service client)) {
        for my $cipher (keys $res->{$class}->%*) {
            $res->{$class}->{$cipher} = [sort $res->{$class}->{$cipher}->@*];
        }
    }

    return $res;
}

my sub count_old_cipher_entities {
    my ($by_cipher) = @_;

    my $count = 0;
    for my $cipher (keys %$by_cipher) {
        next if $cipher eq $AES256K_CIPHER || $cipher eq 'unknown';
        $count += scalar($by_cipher->{$cipher}->@*);
    }
    return $count;
}

# This view has no staging journal or client inventory. Pending keys take precedence over
# rotation previews, regardless of who staged them or which cipher they would restore.
sub cephx_migration_verdicts {
    my ($status) = @_;

    my $entities = $status->{entities};
    my $old_service = count_old_cipher_entities($entities->{service});
    my $old_client = count_old_cipher_entities($entities->{client});
    my $unknown = scalar(($entities->{service}->{unknown} // [])->@*) +
        scalar(($entities->{client}->{unknown} // [])->@*);
    my $pending = $entities->{'pending-keys'} // 0;
    my $pending_known = $entities->{'pending-keys-known'};
    my $quorum_ok = $status->{quorum}->{'supports-aes256k'};
    my $outdated = $status->{'daemons-without-aes256k'};
    my $service_cipher = $status->{monmap}->{auth_service_cipher} // 'unknown';
    my $old_tickets = $service_cipher ne 'unknown' && $service_cipher ne $AES256K_CIPHER;
    my $res = [];

    push @$res,
        "$pending "
        . ($pending == 1 ? 'identity has' : 'identities have')
        . " a pending key. Continue the migration or rollback that staged it."
        if $pending;
    push @$res,
        "The key inventory is incomplete; missing entries are not evidence of migrated keys."
        if !$entities->{complete};
    push @$res,
        "Pending keys are unknown because the full 'auth dump-keys' inventory is unavailable."
        if !$pending_known;
    push @$res,
        "$unknown listed current "
        . ($unknown == 1 ? 'key has' : 'keys have')
        . " an unknown cipher, not a known old cipher."
        if $unknown;
    push @$res, "All listed current keys use aes256k; no pending keys reported."
        if $entities->{complete}
        && $pending_known
        && !$pending
        && !$unknown
        && !$old_service
        && !$old_client;
    push @$res, "Service tickets still use $service_cipher, independently of the identity keys."
        if $old_tickets;
    push @$res, "Service-ticket cipher unknown: 'mon dump' is unavailable or lacks cipher settings."
        if $service_cipher eq 'unknown';

    my $daemons_known = scalar(grep { scalar(@$_) } values $status->{daemons}->%*);
    if (!$daemons_known) {
        push @$res, "Daemon versions are unavailable; aes256k compatibility is unknown.";
    } elsif (scalar(@$outdated)) {
        push @$res, "Resolve the old or unknown daemon versions below before rotating keys.";
    }
    if (!defined($quorum_ok)) {
        push @$res, "Monitor quorum features could not be read; rotation support is unknown.";
    } elsif (!$quorum_ok) {
        push @$res,
            "The monitor quorum does not advertise aes256k; upgrade/restart monitors first.";
    }

    if ($pending) {
        push @$res, "For a helper-managed migration, check the next step:", $CEPHX_MIGRATION_HELPER;
    } elsif (
        !$entities->{complete}
        || !$pending_known
        || $unknown
        || $service_cipher eq 'unknown'
        || !$daemons_known
        || scalar(@$outdated)
        || !$quorum_ok
    ) {
        push @$res, "Resolve the missing or incompatible evidence, then recheck:",
            "pveceph auth status";
    } elsif ($old_service || $old_tickets) {
        push @$res, "Preview cluster-owned key and service-ticket migration:",
            "$CEPHX_MIGRATION_HELPER --rotate-cluster-keys";
    } elsif ($old_client) {
        push @$res,
            "Preview managed storage and administrative key migration; the helper identifies"
            . " any keys outside that selection:",
            "$CEPHX_MIGRATION_HELPER --rotate-all-storage-keys --rotate-admin-key";
    } else {
        # Current keys do not prove that clients refreshed or that cipher restriction is safe.
        push @$res,
            "For a helper-managed migration, check whether anything remains:",
            $CEPHX_MIGRATION_HELPER;
    }

    return $res;
}

# Strictly read-only. Every mon command is wrapped, since a release from before the cipher answers
# none of them, and a missing piece is reported as unknown rather than failing the whole report.
sub get_cephx_auth_status {
    my ($rados) = @_;
    $rados = PVE::Ceph::Services::ResilientRados->new(
        timeout => PVE::Ceph::Tools::get_config('long_rados_timeout'),
    ) if !$rados;

    my $health = eval { $rados->mon_command({ prefix => 'health', detail => 'detail' }) };
    $health = {} if ref($health) ne 'HASH';
    my $checks = ref($health->{checks}) eq 'HASH' ? $health->{checks} : {};

    # ask the same helper the status endpoint uses instead of deciding again here, so this
    # report and the restart endpoints can never disagree, and both report the same shape
    my $blocking = restart_blocking_by_type($rados, $health);

    my $res = { checks => {}, 'checks-known' => ref($health->{checks}) eq 'HASH' ? 1 : 0 };
    for my $name (sort keys %$checks) {
        next if $name !~ m/^AUTH_/ || ref($checks->{$name}) ne 'HASH';
        $res->{checks}->{$name} = {
            severity => $checks->{$name}->{severity} // 'unknown',
            message => $checks->{$name}->{summary}->{message} // '',
            muted => $checks->{$name}->{muted} ? 1 : 0,
            'blocks-restart' => $blocking->{$name},
        };
    }

    my $mondump = eval { $rados->mon_command({ prefix => 'mon dump', format => 'json' }) };
    $mondump = {} if ref($mondump) ne 'HASH';

    $res->{monmap} = {};
    for my $key (qw(auth_service_cipher auth_preferred_cipher)) {
        my $name = cipher_name($mondump->{$key});
        $res->{monmap}->{$key} = $name if defined($name);
    }
    if (ref($mondump->{auth_allowed_ciphers}) eq 'ARRAY') {
        $res->{monmap}->{auth_allowed_ciphers} =
            [grep { defined($_) } map { cipher_name($_) } $mondump->{auth_allowed_ciphers}->@*];
    }

    my $versions = eval { $rados->mon_command({ prefix => 'versions', format => 'json' }) };
    $versions = {} if ref($versions) ne 'HASH';

    $res->{daemons} = {};
    $res->{'daemons-without-aes256k'} = [];
    for my $type (qw(mon mgr osd mds)) {
        next if ref($versions->{$type}) ne 'HASH';

        my $entries = [];
        for my $version (sort keys $versions->{$type}->%*) {
            my $count = $versions->{$type}->{$version};
            my $supported = ceph_version_supports_aes256k($version);
            # ceph reports the full banner, which is unreadable in a summary line
            my $short = $version =~ m/^ceph version (\S+)/ ? $1 : $version;
            push @$entries,
                {
                    version => $version,
                    'version-short' => $short,
                    count => $count,
                    defined($supported) ? ('supports-aes256k' => $supported) : (),
                };
            # an unparseable version is reported as unknown in 'supports-aes256k' but still listed
            # here, so it blocks the migration instead of silently passing it
            push $res->{'daemons-without-aes256k'}->@*, "$type ($count) on $short"
                if !$supported;
        }
        $res->{daemons}->{$type} = $entries;
    }

    my $quorum = {};
    my $quorum_status =
        eval { $rados->mon_command({ prefix => 'quorum_status', format => 'json' }) };
    if (ref($quorum_status) eq 'HASH') {
        my $names = $quorum_status->{quorum_names};
        $quorum->{members} = $names if ref($names) eq 'ARRAY';

        my $features = ($quorum_status->{features} // {})->{quorum_mon};
        if (ref($features) eq 'ARRAY') {
            $quorum->{'supports-aes256k'} =
                (grep { $_ eq $AES256K_MON_FEATURE } @$features) ? 1 : 0;
            $quorum->{'feature-source'} = 'quorum mon features';
        }
    }
    if (!$quorum->{'feature-source'}) {
        # Only the quorum feature decides whether Ceph accepts a rotation, the versions are a
        # proxy. Leave 'supports-aes256k' unset so callers report unknown, the versions are a hint.
        my $mons = $res->{daemons}->{mon} // [];
        $quorum->{'versions-support-aes256k'} =
            (scalar(@$mons) && !grep { !$_->{'supports-aes256k'} } @$mons) ? 1 : 0;
        $quorum->{'feature-source'} = 'unknown, could not read the quorum features';
    }
    $res->{quorum} = $quorum;

    $res->{entities} = collect_entity_ciphers($rados, $checks);
    $res->{nodes} = collect_node_kernels($rados);
    $res->{conclusion} = cephx_migration_verdicts($res);

    return $res;
}

# Wraps Ceph's '$type ok-to-stop' mon command and returns ($safe, $message).
# Ceph has no 'mgr ok-to-stop' so we fall back to a standby-count check.
# Retries cover both mid-restart RPC transport failures and 'not safe' responses
# while the previous daemon's recovery still settles.
my $OK_TO_STOP_RETRIES = 4;
my $OK_TO_STOP_RETRY_SLEEP = 15;

sub is_safe_to_stop {
    my ($rados, $type, $id) = @_;

    if ($type eq 'mgr') {
        my $tries = $OK_TO_STOP_RETRIES;
        my $last_err = '';
        while ($tries > 0) {
            my $dump =
                eval { $rados->mon_command({ prefix => 'mgr dump', format => 'json' }) };
            if (my $err = $@) {
                chomp $err;
                $last_err = $err;
                $tries--;
                sleep($OK_TO_STOP_RETRY_SLEEP) if $tries > 0;
                next;
            }
            return (0, "'mgr dump' returned an unexpected response shape")
                if ref($dump) ne 'HASH';

            my $standbys = $dump->{standbys} // [];
            my $standby_count = ref($standbys) eq 'ARRAY' ? scalar(@$standbys) : 0;
            my $is_active = ($dump->{active_name} // '') eq $id;

            if ($is_active) {
                return (0, "no standby mgr available for failover, would cause mgr outage")
                    if $standby_count == 0;
                return (
                    1,
                    "active mgr restart will trigger failover"
                        . " ($standby_count standby available)",
                );
            }
            return (1, "standby mgr restart, no failover");
        }
        return (
            0, "could not query 'mgr dump' after $OK_TO_STOP_RETRIES attempts: $last_err",
        );
    }

    my $params = {
        prefix => "$type ok-to-stop",
        format => 'plain',
        ids => [$id],
    };

    my $tries = $OK_TO_STOP_RETRIES;
    my $last_msg = '';
    while ($tries > 0) {
        my $result = eval { $rados->mon_cmd($params, 1) };
        if (my $err = $@) {
            chomp $err;
            $last_msg = "transport error: $err";
        } elsif (($result->{return_code} // -1) == 0) {
            return (1, $result->{status_message} // 'safe');
        } else {
            $last_msg = $result->{status_message} // 'not safe';
        }
        $tries--;
        sleep($OK_TO_STOP_RETRY_SLEEP) if $tries > 0;
    }
    return (
        0,
        "'$type ok-to-stop' for '$id' did not pass after $OK_TO_STOP_RETRIES attempts: "
            . $last_msg,
    );
}

# Issues a mon_command and returns the response if it's a HASH, otherwise
# undef. Swallows transient transport failures during the post-restart wait
# phase: if the mon is briefly unreachable (e.g. mid-election after we just
# restarted one of its peers), the caller treats undef as "not yet up" and
# the poll loop in wait_for_daemon_up retries on the next tick.
my sub _safe_mon_hash {
    my ($rados, $cmd) = @_;
    my $result = eval { $rados->mon_command($cmd); };
    return undef if $@ || ref($result) ne 'HASH';
    return $result;
}

# Per-type "is this daemon back up" check. PG-level recovery is deliberately NOT polled:
# the next iteration's 'ok-to-stop' gate covers it, and a prior 'pg ls-by-osd' approach
# could hang the mon dispatch queue while the target OSD was mid-restart.
sub daemon_is_up {
    my ($rados, $type, $id) = @_;

    if ($type eq 'osd') {
        my $dump = _safe_mon_hash($rados, { prefix => 'osd dump', format => 'json' })
            or return 0;
        for my $osd (@{ $dump->{osds} // [] }) {
            return $osd->{up} ? 1 : 0 if "$osd->{osd}" eq "$id";
        }
        return 0;
    } elsif ($type eq 'mon') {
        my $qs = _safe_mon_hash($rados, { prefix => 'quorum_status' }) or return 0;
        return scalar(grep { $_ eq $id } @{ $qs->{quorum_names} // [] }) ? 1 : 0;
    } elsif ($type eq 'mgr') {
        my $dump = _safe_mon_hash($rados, { prefix => 'mgr dump', format => 'json' })
            or return 0;
        return 0 if !$dump->{available};
        return 1 if ($dump->{active_name} // '') eq $id;
        for my $standby (@{ $dump->{standbys} // [] }) {
            return 1 if ($standby->{name} // '') eq $id;
        }
        return 0;
    } elsif ($type eq 'mds') {
        my $dump = _safe_mon_hash($rados, { prefix => 'fs dump', format => 'json' })
            or return 0;
        for my $standby (@{ $dump->{standbys} // [] }) {
            return 1 if ($standby->{name} // '') eq $id;
        }
        for my $fs (@{ $dump->{filesystems} // [] }) {
            for my $info (values %{ $fs->{mdsmap}->{info} // {} }) {
                next if ($info->{name} // '') ne $id;
                # Accept any up:* state, not just up:active. standby_replay
                # MDSes live in mdsmap.info (not the standbys array) with
                # state up:standby-replay and would otherwise time out.
                return ($info->{state} // '') =~ /^up:/ ? 1 : 0;
            }
        }
        return 0;
    }
    die "unknown daemon type '$type'\n";
}

sub wait_for_daemon_up {
    my ($rados, $type, $id, $timeout) = @_;

    $timeout //= 600;
    my $poll = 2;
    my $deadline = time() + $timeout;
    my $is_up = 0;
    while (time() < $deadline) {
        if (daemon_is_up($rados, $type, $id)) {
            $is_up = 1;
            last;
        }
        sleep($poll);
    }
    die "daemon '$type.$id' did not come up within $timeout seconds\n" if !$is_up;

    # MON-specific settle: paxos can briefly report rejoined-but-not-yet-stable. Defensive
    # heuristic: require quorum membership across two consecutive successful polls separated
    # by a few seconds. Shares the caller's $deadline so the total wait never exceeds the
    # caller's $timeout - settle is opportunistic, taking whatever time is left.
    if ($type eq 'mon') {
        my $settle = 5;
        my $required_consecutive = 2;
        my $consecutive_ok = 1; # the loop above already saw one successful poll
        while (time() < $deadline && $consecutive_ok < $required_consecutive) {
            sleep($settle);
            if (daemon_is_up($rados, $type, $id)) {
                $consecutive_ok++;
            } else {
                $consecutive_ok = 0;
            }
        }
        warn "mon '$id' quorum membership did not stabilize before timeout,"
            . " continuing anyway\n"
            if $consecutive_ok < $required_consecutive;
    }
}

# Polls '<type> ok-to-stop' on $sample_id until safe or $timeout elapses. Used by the cluster
# orchestrator between nodes to absorb the recovery time from the previous node's restart, so
# the next per-node sub-task starts on a stabilized cluster. Returns (1, msg) or (0, msg).
sub wait_for_safe_to_stop {
    my ($rados, $type, $sample_id, $timeout) = @_;
    $timeout //= 600;
    my $deadline = time() + $timeout;
    my $poll = 10;
    my $last_msg = '';
    while (time() < $deadline) {
        my ($safe, $msg) = is_safe_to_stop($rados, $type, $sample_id);
        return (1, $msg) if $safe;
        $last_msg = $msg // '';
        last if time() + $poll >= $deadline;
        sleep($poll);
    }
    return (
        0,
        "recovery did not allow safe restart of '$type.$sample_id' within"
            . " ${timeout}s: $last_msg",
    );
}

# Sets per-OSD 'noout' on $osd_ids for the duration of $code, unsetting it again on
# completion, error, or SIGTERM/INT/HUP (e.g. 'pvesh task stop'). Per-OSD scope avoids
# blocking the mon_osd_down_out_interval countdown for unrelated OSDs that fail on
# other nodes during the restart window, and leaves any operator-set cluster-wide
# noout untouched. $we_set_it is recorded BEFORE the mon_command to guarantee a
# best-effort unset on signal or set-failure; spurious unsets are no-ops on Ceph.
# Reads the per-OSD 'noout' flag for the given ids. 'osd dump' reports it as a string in each
# OSD's 'state' array, which is what 'osd set-group' and 'osd unset-group' manipulate, and is
# separate from the cluster-wide 'flags' field. Callers pass either 'osd.N' or a bare N, so
# normalise before comparing. Returns the ids that do not carry the flag yet.
sub unflagged_noout_osds {
    my ($rados, $osd_ids) = @_;

    my @wanted = map { my $id = $_; $id =~ s/^osd\.//; $id } @$osd_ids;

    my $dump = eval { $rados->mon_command({ prefix => 'osd dump', format => 'json' }) };
    die "could not read the OSD map to check the 'noout' flags: $@" if $@;

    my $flagged = {};
    for my $osd ((ref($dump->{osds}) eq 'ARRAY' ? $dump->{osds} : [])->@*) {
        next if !defined($osd->{osd});
        my $state = ref($osd->{state}) eq 'ARRAY' ? $osd->{state} : [];
        $flagged->{ $osd->{osd} } = 1 if grep { $_ eq 'noout' } @$state;
    }

    return [grep { !$flagged->{$_} } @wanted];
}

# Sets 'noout' on the given OSDs for the duration of $code, then unsets it again.
#
# Only OSDs that do not already carry the flag are touched, so an operator's own 'noout' on a
# specific OSD survives. This reduces rather than removes the problem: a flag set by someone
# else while $code runs is still cleared at the end, and no re-read can tell that apart from
# our own. $on_owned, if given, is called with the intended owned ids before they are set. A
# caller can persist that intent before the mon command, then reconcile it after a hard kill.
sub with_noout {
    my ($rados, $osd_ids, $code, $on_owned) = @_;

    return $code->() if !$osd_ids || !@$osd_ids;

    my $owned = unflagged_noout_osds($rados, $osd_ids);
    return $code->() if !@$owned;

    my $we_set_it = 0;
    my $cleanup_done = 0;
    my $cleanup = sub {
        return if $cleanup_done;
        $cleanup_done = 1;
        return if !$we_set_it;
        print "unsetting 'noout' flag on " . scalar(@$owned) . " OSDs\n";
        eval {
            $rados->mon_command({
                prefix => 'osd unset-group',
                flags => 'noout',
                who => $owned,
            });
        };
        if (my $err = $@) {
            chomp $err;
            warn "failed to unset 'noout' flag on OSDs "
                . join(', ', @$owned)
                . ", they stay set until that is done by hand: $err\n";
            return;
        }
        $on_owned->([]) if $on_owned;
    };

    local $SIG{TERM} = sub { $cleanup->(); die "received SIGTERM, aborting bulk-restart\n"; };
    local $SIG{INT} = sub { $cleanup->(); die "received SIGINT, aborting bulk-restart\n"; };
    local $SIG{HUP} = sub { $cleanup->(); die "received SIGHUP, aborting bulk-restart\n"; };

    eval {
        # Persist the intent first. If the process dies before the mon command, the next run sees
        # that these OSDs are still unflagged and drops the harmless record.
        $on_owned->($owned) if $on_owned;
        print "setting 'noout' flag on " . scalar(@$owned) . " OSDs\n";
        $we_set_it = 1; # set BEFORE mon_command to close the signal/failure race
        $rados->mon_command({
            prefix => 'osd set-group',
            flags => 'noout',
            who => $owned,
        });
        $code->();
    };
    my $err = $@;

    $cleanup->();

    die $err if $err;
}

# State helpers for bulk-restart resumability via Ceph's config-key mon command
# (see src/mon/KVMonitor.cc for the server side). State is paxos-replicated on
# the mons and survives worker death including SIGKILL via 'pvesh task stop',
# so a follow-up invocation can resume from wherever the previous one stopped.
# This is the same primitive cephadm uses for its UpgradeState resumability
# (mgr.set_store under the hood).
#
# Keyed by node name: only one bulk-restart can be paused per node at a time,
# which lines up with the existing per-node lock_file_full serialization.

my $BULK_RESTART_STATE_KEY_PREFIX = 'pve/ceph-bulk-restart/node/';

# Returns the config-key path for $node's bulk-restart state. Exported so
# callers (and operator-facing error messages) can reference the same path
# without duplicating the prefix.
sub bulk_restart_state_key {
    my ($node) = @_;
    return "${BULK_RESTART_STATE_KEY_PREFIX}${node}";
}

# Persists $state (an arbitrary hashref) for $node, JSON-encoded. Adds a
# 'timestamp' field so callers / operators can spot stale entries.
sub save_bulk_restart_state {
    my ($rados, $node, $state) = @_;
    $state->{timestamp} = time();
    $rados->mon_command({
        prefix => 'config-key set',
        key => bulk_restart_state_key($node),
        val => encode_json($state),
    });
}

# Returns the saved state hashref, or undef if no state exists or it could
# not be parsed. The "no state" case is normal (no prior run), so this never
# dies on a missing key.
#
# format => 'plain' on the 'config-key get' is load-bearing: without it,
# mon_cmd's default format => 'json' makes RADOS auto-decode the response data
# into a hashref, and our own decode_json on the result would die on a non-string
# input. With format => 'plain', RADOS leaves the response as the raw stored
# string, which is what save_bulk_restart_state wrote via encode_json.
sub load_bulk_restart_state {
    my ($rados, $node) = @_;
    my $key = bulk_restart_state_key($node);

    my $result =
        eval { $rados->mon_cmd({ prefix => 'config-key get', key => $key, format => 'plain' }, 1); };
    return undef if $@;
    return undef if ($result->{return_code} // -1) != 0;
    my $state = eval { decode_json($result->{data} // '') };
    if (my $err = $@) {
        chomp $err;
        warn "bulk-restart state for '$node' is corrupt and will be ignored: $err\n";
        return undef;
    }
    return $state;
}

# Removes the saved state. Dies on failure: the only caller invokes this after
# a successful run, and a lingering state key would block the next non-resume
# run via the "state already exists" guard. Surfacing the error as a task
# failure is more transparent than a silent warning the operator may not
# notice until the next run.
sub clear_bulk_restart_state {
    my ($rados, $node) = @_;
    my $key = bulk_restart_state_key($node);
    eval { $rados->mon_command({ prefix => 'config-key rm', key => $key }); };
    if (my $err = $@) {
        chomp $err;
        die "rolling restart finished but failed to clear bulk-restart state for '$node': $err."
            . " Run 'ceph config-key rm $key' before starting another bulk-restart on this"
            . " node.\n";
    }
}

# Per-node file lock to serialize bulk-restart workers. Uses lock_file_full with a 5s
# acquisition timeout - concurrent invocations block briefly then fail. The lock is
# per-node only; cluster-wide protection against two operators on different nodes is
# not possible without a heavier mechanism (cfs_lock_file is unsuitable - it's not
# designed for hour-long critical sections and runs $code under a 60s alarm).
#
# lock_file_full sets $@ and returns undef on either lock-acquisition failure
# (prefixed "can't lock file '$lockfile'") or $code death (raw die message).
# We anchor the regex to the lock-fail prefix so a worker error containing the
# substring "can't lock file" doesn't get misclassified as a lock collision.
sub with_bulk_restart_lock {
    my ($code) = @_;
    my $lockfile = '/var/lock/pve-ceph-bulk-restart.lck';
    lock_file_full($lockfile, 5, 0, $code);
    if (my $err = $@) {
        die "another Ceph bulk-restart is already in progress on this node\n"
            if $err =~ /^can't lock file '\Q$lockfile\E'/;
        die $err;
    }
}

# Cluster-wide soft lock for bulk-restart orchestrators that touch shared Ceph state.
# Read-then-set under 'pve/ceph-bulk-restart/lock/<scope>' is racy (config-key has no
# set-if-not-exists) but combined with the per-node file lock - and, for MON/MGR/MDS
# sub-tasks, the remote node's srvrestart worker-queue serialization - it covers the
# realistic operator-error case of two concurrent restarts losing MON quorum. Stale
# entries auto-expire so a crashed orchestrator does not lock operators out forever.
my $CLUSTER_LOCK_KEY_PREFIX = 'pve/ceph-bulk-restart/lock/';
my $CLUSTER_LOCK_STALE_AFTER = 4 * 60 * 60; # 4h

sub cluster_lock_key {
    my ($scope) = @_;
    return "${CLUSTER_LOCK_KEY_PREFIX}${scope}";
}

# Every lock entry a given run holds, so a message about one of them can name the rest: a run
# takes one per daemon type it touches on top of its own, and a killed one leaves all of them.
my sub lock_keys_held_by {
    my ($rados, $upid) = @_;

    # 'json' comes back decoded already, unlike the 'plain' reads below
    my $keys = eval {
        my $reply = $rados->mon_cmd({ prefix => 'config-key ls', format => 'json' }, 1);
        my $data = $reply->{data};
        ref($data) eq 'ARRAY' ? $data : decode_json($data // '[]');
    };
    return [] if $@ || ref($keys) ne 'ARRAY';

    my $held = [];
    for my $key (sort @$keys) {
        next if $key !~ m/^\Q$CLUSTER_LOCK_KEY_PREFIX\E/;
        my $entry = eval {
            my $reply =
                $rados->mon_cmd({ prefix => 'config-key get', key => $key, format => 'plain' }, 1);
            decode_json($reply->{data} // '');
        };
        next if $@ || ref($entry) ne 'HASH';
        push @$held, $key if ($entry->{upid} // '') eq ($upid // '');
    }

    return $held;
}

sub acquire_cluster_bulk_restart_lock {
    my ($rados, $scope, $upid) = @_;
    my $key = cluster_lock_key($scope);

    my $existing =
        eval { $rados->mon_cmd({ prefix => 'config-key get', key => $key, format => 'plain' }, 1); };
    if (!$@ && $existing && ($existing->{return_code} // -1) == 0) {
        my $info = eval { decode_json($existing->{data} // '') };
        if ($info && ref($info) eq 'HASH') {
            # Time::HiRes is in scope, and a fractional age reads badly in a message
            my $age = int(time() - ($info->{timestamp} // 0));
            # The same upid coming back is the holder renewing, which a run that outlives the
            # stale timeout has to do. A crashed run cannot renew, as every run builds a new
            # upid, so its entry is only freed once it goes stale.
            my $ours = ($info->{upid} // '') eq ($upid // '');
            if ($age < $CLUSTER_LOCK_STALE_AFTER && !$ours) {
                # A run killed outright cannot release this, and it is only freed once it goes
                # stale hours later. One run can hold several of these, so name every entry it
                # left rather than send the operator round once per scope.
                my $held = lock_keys_held_by($rados, $info->{upid});
                my $how =
                    scalar(@$held) > 1
                    ? "remove its entries with 'ceph config-key rm "
                    . join("' and 'ceph config-key rm ", @$held) . "'"
                    : "remove its entry with 'ceph config-key rm $key'";
                die "another cluster-wide Ceph '$scope' bulk-restart is in progress"
                    . " (upid '$info->{upid}' on host '$info->{host}', started ${age}s ago)."
                    . " If that run is gone, for example because it was killed, $how and try"
                    . " again.\n";
            }
            warn "discarding stale cluster bulk-restart lock entry for '$scope'"
                . " (${age}s old, was upid '$info->{upid}' on host '$info->{host}')\n"
                if !$ours;
        }
    }

    $rados->mon_command({
        prefix => 'config-key set',
        key => $key,
        val => encode_json({
            upid => $upid,
            host => PVE::INotify::nodename(),
            timestamp => time(),
        }),
    });

    # config-key has no compare-and-swap, so two callers can both find no entry and both
    # write one. Reading our own write back does not make this a mutex, but it turns the
    # window from the whole get-to-set gap into the settle interval, and it stops a renewal
    # from silently stealing an entry that another run took over in the meantime.
    my $readback =
        eval { $rados->mon_cmd({ prefix => 'config-key get', key => $key, format => 'plain' }, 1); };
    if (!$@ && $readback && ($readback->{return_code} // -1) == 0) {
        my $info = eval { decode_json($readback->{data} // '') };
        if ($info && ref($info) eq 'HASH' && ($info->{upid} // '') ne $upid) {
            die "another cluster-wide Ceph '$scope' bulk-restart took the lock at the same"
                . " time (upid '$info->{upid}' on host '$info->{host}')\n";
        }
    }
}

sub release_cluster_bulk_restart_lock {
    my ($rados, $scope, $upid) = @_;
    my $key = cluster_lock_key($scope);

    # Only remove the entry if it is still ours. A run that overran the stale
    # window may have had its lock taken over by another orchestrator in the
    # meantime; we must not delete that one's lock out from under it. This read
    # is still racy against a concurrent takeover (config-key has no
    # compare-and-swap), but it closes the realistic "delete the new owner's
    # lock" window without changing the lock's soft-advisory nature.
    if (defined($upid)) {
        my $existing = eval {
            $rados->mon_cmd({ prefix => 'config-key get', key => $key, format => 'plain' }, 1);
        };
        my $err = $@;
        if ($err || !$existing || ($existing->{return_code} // -1) != 0) {
            # fail closed: the stale timeout clears the entry instead
            chomp $err if $err;
            warn "not releasing cluster bulk-restart lock for '$scope': could not read its"
                . " current owner"
                . ($err ? " ($err)" : "") . "\n";
            return;
        }
        my $info = eval { decode_json($existing->{data} // '') };
        if ($info && ref($info) eq 'HASH' && ($info->{upid} // '') ne $upid) {
            warn "not releasing cluster bulk-restart lock for '$scope': now held by"
                . " a different run (upid '"
                . ($info->{upid} // '?') . "')\n";
            return;
        }
    }

    eval { $rados->mon_command({ prefix => 'config-key rm', key => $key }); };
    warn "failed to release cluster bulk-restart lock for '$scope': $@" if $@;
}

# Convenience: acquire, run $code, release (even on die).
# Takes one scope or, given an arrayref, several at once, for a caller that touches more than
# one daemon type and has to keep the per-type restarts out at the same time. A scope that
# cannot be taken releases the ones already held, so a refusal leaves nothing behind.
sub with_cluster_bulk_restart_lock {
    my ($rados, $scope, $upid, $code) = @_;

    my @scopes = ref($scope) eq 'ARRAY' ? $scope->@* : ($scope);

    # a scope cannot be taken twice, and running the body with no lock at all would be worse
    # than refusing outright
    @scopes = do {
        my %seen;
        grep { defined($_) && !$seen{$_}++ } @scopes;
    };
    die "no scope given to lock a cluster-wide Ceph bulk restart\n" if !scalar(@scopes);

    my @held;
    for my $current (@scopes) {
        eval { acquire_cluster_bulk_restart_lock($rados, $current, $upid) };
        if (my $err = $@) {
            eval { release_cluster_bulk_restart_lock($rados, $_, $upid) } for reverse @held;
            die $err;
        }
        push @held, $current;
    }

    my $wantarray = wantarray;
    my @result = eval { $wantarray ? ($code->()) : scalar($code->()); };
    my $err = $@;
    eval { release_cluster_bulk_restart_lock($rados, $_, $upid) } for reverse @held;
    die $err if $err;
    return $wantarray ? @result : $result[0];
}

# Small PVE::RADOS wrapper that recreates the underlying connection on a
# detected dead-connection failure (EBADF / closed filehandle / write data
# failed) and retries the call once. PVE::RADOS' internal $sendcmd tears the
# socketpair down and SIGKILLs the librados subprocess on any timeout (default
# 5s, configurable via timeout => N) or transport error, after which every
# subsequent mon_command on the same handle fails forever. Long-running
# bulk-restart workers (minutes to hours) cannot survive that without
# transparent reconnect.
#
# Bulk-restart workers and helpers in this series use this wrapper instead of
# bare PVE::RADOS so a single transient mon-command failure during a peering
# storm or mon election does not strand the entire run.
package PVE::Ceph::Services::ResilientRados {
    use strict;
    use warnings;

    sub new {
        my ($class, %opts) = @_;
        my $self = {
            opts => \%opts,
            rados => PVE::RADOS->new(%opts),
        };
        return bless $self, $class;
    }

    my sub _is_dead_connection_error {
        my ($err) = @_;
        my $msg = ref($err) ? ($err->{msg} // "$err") : "$err";
        return $msg =~ /Bad file descriptor|closed filehandle|write data failed/i;
    }

    sub _call_with_reconnect {
        my ($self, $method, @args) = @_;
        # Suppress PVE::RADOS' own "syswrite() on closed filehandle" warning from
        # writedata: it's a misleading Perl-level artifact of the FH having been
        # closed by PVE::RADOS::kill_worker (which is exactly what we're about to
        # recover from). Other warnings pass through.
        my $result = eval {
            local $SIG{__WARN__} = sub {
                my ($msg) = @_;
                return if $msg =~ m{syswrite\(\) on closed filehandle.*PVE/RADOS\.pm};
                warn $msg;
            };
            $self->{rados}->$method(@args);
        };
        if (my $err = $@) {
            die $err if !_is_dead_connection_error($err);
            warn "RADOS connection lost during '$method', reconnecting: $err";
            $self->{rados} = PVE::RADOS->new(%{ $self->{opts} });
            return $self->{rados}->$method(@args); # rethrow if still failing
        }
        return $result;
    }

    # Only mon_command and mon_cmd are proxied because that is all the bulk-restart
    # code uses. If a future caller hands a wrapped instance to code expecting other
    # PVE::RADOS methods (cluster_stat, pool ops, ...) it will fail; add the proxy
    # method here when that need arises rather than auto-delegating, so reconnect
    # semantics stay explicit.
    sub mon_command { my $self = shift; return $self->_call_with_reconnect('mon_command', @_); }
    sub mon_cmd { my $self = shift; return $self->_call_with_reconnect('mon_cmd', @_); }
}

1;
