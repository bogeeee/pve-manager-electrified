package PVE::Service::pvestatd;

use strict;
use warnings;

use PVE::SafeSyslog;
use PVE::Daemon;

use JSON;

use Time::HiRes qw (gettimeofday);
use PVE::Tools qw(dir_glob_foreach file_read_firstline);
use PVE::ProcFSTools;
use PVE::CpuSet;
use Filesys::Df;
use PVE::INotify;
use PVE::Network;
use PVE::Network::SDN::Zones;
use PVE::RS::SDN::Fabrics;
use PVE::NodeConfig;
use PVE::Cluster qw(cfs_read_file);
use PVE::Storage;
use PVE::QemuServer;
use PVE::QemuServer::Monitor;
use PVE::LXC;
use PVE::CGroup;
use PVE::LXC::Config;
use PVE::RPCEnvironment;
use PVE::API2::Subscription;
use PVE::AutoBalloon;
use PVE::AccessControl;
use PVE::Ceph::Services;
use PVE::Ceph::Tools;
use PVE::pvecfg;

use PVE::ExtMetric;
use PVE::PullMetric;
use PVE::Status::Plugin;

use base qw(PVE::Daemon);

my $opt_debug;
my $restart_request;

my $nodename = PVE::INotify::nodename();

my $cmdline = [$0, @ARGV];

my %daemon_options = (restart_on_error => 5, stop_wait_time => 5);
my $daemon = __PACKAGE__->new('pvestatd', $cmdline, %daemon_options);

sub init {
    my ($self) = @_;

    $opt_debug = $self->{debug};

    PVE::Cluster::cfs_update();
}

sub shutdown {
    my ($self) = @_;

    syslog('info', "server closing");

    # wait for children
    1 while (waitpid(-1, POSIX::WNOHANG()) > 0);

    $self->exit_daemon(0);
}

sub hup {
    my ($self) = @_;

    $restart_request = 1;
}

my $cached_kvm_version = '';
my $next_flag_update_time;
my $failed_flag_update_delay_sec = 120;

# Checks if RRD files exist in the specified location.
my $rrd_dir_exists = sub {
    my ($location) = @_;
    return -d "/var/lib/rrdcached/db/${location}";
};

sub update_supported_cpuflags {
    my $kvm_version = PVE::QemuServer::kvm_user_version();

    # only update when QEMU/KVM version has changed, as that is the only reason
    # why flags could change without restarting pvestatd
    return if $cached_kvm_version && $cached_kvm_version eq $kvm_version;

    if ($next_flag_update_time && $next_flag_update_time > time()) {
        return;
    }
    $next_flag_update_time = 0;

    my $supported_cpuflags = eval { PVE::QemuServer::query_supported_cpu_flags() };
    warn $@ if $@;

    if (
        !$supported_cpuflags
        || (!$supported_cpuflags->{tcg} && !$supported_cpuflags->{kvm})
    ) {
        # something went wrong, clear broadcast flags and set try-again delay
        warn "CPU flag detection failed, will try again after delay\n";
        $next_flag_update_time = time() + $failed_flag_update_delay_sec;

        $supported_cpuflags = {};
    } else {
        # only set cached version if there's actually something to broadcast
        $cached_kvm_version = $kvm_version;
    }

    for my $accel ("tcg", "kvm") {
        if ($supported_cpuflags->{$accel}) {
            PVE::Cluster::broadcast_node_kv(
                "cpuflags-$accel",
                join(' ', @{ $supported_cpuflags->{$accel} }),
            );
        } else {
            # clear potentially invalid data
            PVE::Cluster::broadcast_node_kv("cpuflags-$accel", '');
        }
    }
}

my $generate_rrd_string = sub {
    my ($data) = @_;

    return join(':', map { $_ // 'U' } @$data);
};

my sub broadcast_static_node_info {
    my ($cpus, $memory) = @_;

    my $cgroup_mode = eval { PVE::CGroup::cgroup_mode(); };
    syslog('err', "cgroup mode error: $@") if $@;

    my $old = PVE::Cluster::get_node_kv('static-info', $nodename);
    $old = eval { decode_json($old->{$nodename}) } if defined($old->{$nodename});

    if (
        !defined($old->{cpus})
        || $old->{cpus} != $cpus
        || !defined($old->{memory})
        || $old->{memory} != $memory
        || ($old->{'cgroup-mode'} // -1) != ($cgroup_mode // -1)
    ) {
        my $info = {
            cpus => $cpus,
            memory => $memory,
        };
        $info->{'cgroup-mode'} = $cgroup_mode if defined($cgroup_mode);
        PVE::Cluster::broadcast_node_kv('static-info', encode_json($info));
    }
}

my ($cached_ip_links, $cached_ip_link_last_update) = (undef, 0);
my $MAX_IP_LINK_CACHE_AGE_SECONDS = 15 * 60; # every 15 minutes

sub update_node_status {
    my ($status_cfg, $pull_txn) = @_;

    my ($uptime) = PVE::ProcFSTools::read_proc_uptime();

    my ($avg1, $avg5, $avg15) = PVE::ProcFSTools::read_loadavg();
    my $stat = PVE::ProcFSTools::read_proc_stat();
    my $cpuinfo = PVE::ProcFSTools::read_cpuinfo();
    my $maxcpu = $cpuinfo->{cpus};

    update_supported_cpuflags();

    my $subinfo = PVE::API2::Subscription::read_etc_subscription();
    my $sublevel = $subinfo->{level} || '';

    my $netdev = PVE::ProcFSTools::read_proc_net_dev();

    my $ctime = time();
    if (
        !defined($cached_ip_links)
        || ($ctime - $cached_ip_link_last_update) > $MAX_IP_LINK_CACHE_AGE_SECONDS
    ) {
        $cached_ip_links = PVE::Network::ip_link_details();
        $cached_ip_link_last_update = $ctime;
    }

    # traffic from/to physical interface cards
    my ($netin, $netout) = (0, 0);
    for my $dev (keys %$netdev) {
        my $ip_link = $cached_ip_links->{$dev};

        if ($ip_link && PVE::Network::ip_link_is_physical($ip_link)) {
            $netdev->{$dev}->{type} = 'physical';
        } else {
            $netdev->{$dev}->{type} = 'virtual';
            next;
        }

        $netin += $netdev->{$dev}->{receive};
        $netout += $netdev->{$dev}->{transmit};
    }

    my $meminfo = PVE::ProcFSTools::read_meminfo();

    my $pressures = PVE::ProcFSTools::read_pressure();

    my $dinfo = df('/', 1); # output is bytes
    # everything not free is considered to be used
    my $dused = $dinfo->{blocks} - $dinfo->{bfree};

    $ctime = time(); # df can need a long time, so requery time.

    my $data;
    # TODO: drop old pve2- schema with PVE 10
    if ($rrd_dir_exists->("pve-node-9.0")) {
        $data = $generate_rrd_string->(
            [
                $uptime,
                $sublevel,
                $ctime,
                $avg1,
                $maxcpu,
                $stat->{cpu},
                $stat->{wait},
                $meminfo->{memtotal},
                $meminfo->{memused},
                $meminfo->{swaptotal},
                $meminfo->{swapused},
                $dinfo->{blocks},
                $dused,
                $netin,
                $netout,
                $meminfo->{memavailable},
                $meminfo->{arcsize},
                $pressures->{cpu}->{some}->{avg10},
                $pressures->{io}->{some}->{avg10},
                $pressures->{io}->{full}->{avg10},
                $pressures->{memory}->{some}->{avg10},
                $pressures->{memory}->{full}->{avg10},
            ],
        );
        PVE::Cluster::broadcast_rrd("pve-node-9.0/$nodename", $data);
    } else {
        $data = $generate_rrd_string->(
            [
                $uptime,
                $sublevel,
                $ctime,
                $avg1,
                $maxcpu,
                $stat->{cpu},
                $stat->{wait},
                $meminfo->{memtotal},
                $meminfo->{memused},
                $meminfo->{swaptotal},
                $meminfo->{swapused},
                $dinfo->{blocks},
                $dused,
                $netin,
                $netout,
            ],
        );
        PVE::Cluster::broadcast_rrd("pve2-node/$nodename", $data);
    }

    my $node_metric = {
        uptime => $uptime,
        cpustat => $stat,
        memory => $meminfo,
        blockstat => $dinfo,
        nics => $netdev,
    };
    $node_metric->{cpustat}->@{qw(avg1 avg5 avg15)} = ($avg1, $avg5, $avg15);
    $node_metric->{cpustat}->{cpus} = $maxcpu;

    my $transactions = PVE::ExtMetric::transactions_start($status_cfg);
    PVE::ExtMetric::update_all($transactions, 'node', $nodename, $node_metric, $ctime);
    PVE::ExtMetric::transactions_finish($transactions);

    PVE::PullMetric::update($pull_txn, 'node', $node_metric, $ctime);

    broadcast_static_node_info($maxcpu, $meminfo->{memtotal});
}

sub auto_balloning {
    my ($vmstatus) = @_;

    my $log = sub { $opt_debug and printf @_ };

    my $hostmeminfo = PVE::ProcFSTools::read_meminfo();
    # NOTE: to debug, run 'pvestatd -d' and set  memtotal here
    #$hostmeminfo->{memtotal} = int(2*1024*1024*1024/0.8); # you can set this to test
    my $hostfreemem = $hostmeminfo->{memtotal} - $hostmeminfo->{memused};

    # try to keep host memory usage at a certain percentage (= target), default is 80%
    my $config = PVE::NodeConfig::load_config($nodename);
    my $target = int($config->{'ballooning-target'} // 80);
    # goal is the change amount required to achieve that
    my $goal = int($hostmeminfo->{memtotal} * $target / 100 - $hostmeminfo->{memused});
    $log->(
        "target: $target%% host goal: $goal free: $hostfreemem total: $hostmeminfo->{memtotal}\n");

    my $maxchange = 100 * 1024 * 1024;
    my $res = PVE::AutoBalloon::compute_alg1($vmstatus, $goal, $maxchange);

    for my $vmid (sort keys %$res) {
        my $target = int($res->{$vmid});
        my $current = int($vmstatus->{$vmid}->{balloon});
        next if $target == $current; # no need to change

        $log->("BALLOON $vmid to $target (%d)\n", $target - $current);
        eval { PVE::QemuServer::Monitor::mon_cmd($vmid, "balloon", value => int($target)) };
        warn $@ if $@;
    }
}

sub update_qemu_status {
    my ($status_cfg, $pull_txn) = @_;

    my $ctime = time();
    my $vmstatus = PVE::QemuServer::vmstatus(undef, 1);

    eval { auto_balloning($vmstatus); };
    syslog('err', "auto ballooning error: $@") if $@;

    my $transactions = PVE::ExtMetric::transactions_start($status_cfg);
    foreach my $vmid (keys %$vmstatus) {
        my $d = $vmstatus->{$vmid};
        my $data;
        my $status = $d->{qmpstatus} || $d->{status} || 'stopped';
        my $template = $d->{template} ? $d->{template} : "0";

        # TODO: drop old pve2.3- schema with PVE 10
        if ($rrd_dir_exists->("pve-vm-9.0")) {
            if ($d->{pid}) { # running
                $data = $generate_rrd_string->([
                    $d->{uptime},
                    $d->{name},
                    $status,
                    $template,
                    $ctime,
                    $d->{cpus},
                    $d->{cpu},
                    $d->{maxmem},
                    $d->{mem},
                    $d->{maxdisk},
                    $d->{disk},
                    $d->{netin},
                    $d->{netout},
                    $d->{diskread},
                    $d->{diskwrite},
                    $d->{memhost},
                    $d->{pressurecpusome},
                    $d->{pressurecpufull},
                    $d->{pressureiosome},
                    $d->{pressureiofull},
                    $d->{pressurememorysome},
                    $d->{pressurememoryfull},
                ]);
            } else {
                $data = $generate_rrd_string->([
                    0,
                    $d->{name},
                    $status,
                    $template,
                    $ctime,
                    $d->{cpus},
                    undef,
                    $d->{maxmem},
                    undef,
                    $d->{maxdisk},
                    $d->{disk},
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                ]);
            }
            PVE::Cluster::broadcast_rrd("pve-vm-9.0/$vmid", $data);
        } else {
            if ($d->{pid}) { # running
                $data = $generate_rrd_string->([
                    $d->{uptime},
                    $d->{name},
                    $status,
                    $template,
                    $ctime,
                    $d->{cpus},
                    $d->{cpu},
                    $d->{maxmem},
                    $d->{mem},
                    $d->{maxdisk},
                    $d->{disk},
                    $d->{netin},
                    $d->{netout},
                    $d->{diskread},
                    $d->{diskwrite},
                ]);
            } else {
                $data = $generate_rrd_string->([
                    0,
                    $d->{name},
                    $status,
                    $template,
                    $ctime,
                    $d->{cpus},
                    undef,
                    $d->{maxmem},
                    undef,
                    $d->{maxdisk},
                    $d->{disk},
                    undef,
                    undef,
                    undef,
                    undef,
                ]);
            }
            PVE::Cluster::broadcast_rrd("pve2.3-vm/$vmid", $data);
        }

        PVE::ExtMetric::update_all($transactions, 'qemu', $vmid, $d, $ctime, $nodename);
    }

    PVE::ExtMetric::transactions_finish($transactions);

    PVE::PullMetric::update($pull_txn, 'qemu', $vmstatus, $ctime);
}

sub remove_stale_lxc_consoles {

    my $vmstatus = PVE::LXC::vmstatus();
    my $pidhash = PVE::LXC::find_lxc_console_pids();

    foreach my $vmid (keys %$pidhash) {
        next if defined($vmstatus->{$vmid});
        syslog('info', "remove stale lxc-console for CT $vmid");
        foreach my $pid (@{ $pidhash->{$vmid} }) {
            kill(9, $pid);
        }
    }
}

my $rebalance_error_count = {};

my $NO_REBALANCE;

sub rebalance_lxc_containers {
    # Make sure we can find the cpuset controller path:
    return if $NO_REBALANCE;
    my $cpuset_base = eval { PVE::CGroup::cpuset_controller_path() };
    if (my $err = $@) {
        syslog('info', "could not get cpuset controller path: $err");
    }

    if (!defined($cpuset_base)) {
        $NO_REBALANCE = 1;
        return;
    }

    # Figure out the cpu count & highest ID
    my $all_cpus = PVE::CpuSet->new_from_path($cpuset_base, 1);
    my @allowed_cpus = $all_cpus->members();
    my $cpucount = scalar(@allowed_cpus);
    my $max_cpuid = $allowed_cpus[-1];

    my @cpu_ctcount = (0) x ($max_cpuid + 1);
    my @balanced_cts;

    # A mapping { vmid => cgroup_payload_path } for containers where namespace
    # separation is active and recognized.
    my $ctinfo = {};

    my $modify_cpuset = sub {
        my ($vmid, $cpuset, $newset) = @_;

        if (!$rebalance_error_count->{$vmid}) {
            syslog('info', "modified cpu set for lxc/$vmid: " . $newset->short_string());
        }

        eval {
            my $cgbase = $ctinfo->{$vmid};

            if (defined($cgbase)) {
                # allow all, so that we can set new cpuset in /ns
                $all_cpus->write_to_path($cgbase);
                eval { $newset->write_to_path("$cgbase/ns"); };
                if (my $err = $@) {
                    warn $err if !$rebalance_error_count->{$vmid}++;
                    # restore original
                    $cpuset->write_to_path($cgbase);
                } else {
                    # also apply to container root cgroup
                    $newset->write_to_path($cgbase);
                    $rebalance_error_count->{$vmid} = 0;
                }
            } else {
                # old style container
                $newset->write_to_path($cgbase);
                $rebalance_error_count->{$vmid} = 0;
            }
        };
        if (my $err = $@) {
            warn $err if !$rebalance_error_count->{$vmid}++;
        }
    };

    my $ctlist = PVE::LXC::config_list();

    foreach my $vmid (sort keys %$ctlist) {
        my $cgpath = "$cpuset_base/lxc/$vmid";
        if (-d "$cgpath/ns") {
            $ctinfo->{$vmid} = $cgpath;
        } else {
            next; # old style container
        }

        my ($conf, $cpuset) =
            eval { (PVE::LXC::Config->load_config($vmid), PVE::CpuSet->new_from_path($cgpath)) };
        if (my $err = $@) {
            warn $err;
            next;
        }

        my @cpuset_members = $cpuset->members();

        if (
            !PVE::LXC::Config->has_lxc_entry($conf, 'lxc.cgroup.cpuset.cpus')
            && !PVE::LXC::Config->has_lxc_entry($conf, 'lxc.cgroup2.cpuset.cpus')
        ) {
            my $cores = $conf->{cores} || $cpucount;
            $cores = $cpucount if $cores > $cpucount;

            # see if the number of cores was hot-reduced or hasn't been enacted at all yet
            my $newset = PVE::CpuSet->new();
            if ($cores < scalar(@cpuset_members)) {
                for (my $i = 0; $i < $cores; $i++) {
                    $newset->insert($cpuset_members[$i]);
                }
            } elsif ($cores > scalar(@cpuset_members)) {
                my $count = $newset->insert(@cpuset_members);
                foreach my $cpu (@allowed_cpus) {
                    $count += $newset->insert($cpu);
                    last if $count >= $cores;
                }
            } else {
                $newset->insert(@cpuset_members);
            }

            # Apply hot-plugged changes if any:
            if (!$newset->is_equal($cpuset)) {
                @cpuset_members = $newset->members();
                $modify_cpuset->($vmid, $cpuset, $newset);
            }

            # Note: no need to rebalance if we already use all cores
            push @balanced_cts, [$vmid, $cores, $newset]
                if defined($conf->{cores}) && ($cores != $cpucount);
        }

        foreach my $cpu (@cpuset_members) {
            $cpu_ctcount[$cpu]++ if $cpu <= $max_cpuid;
        }
    }

    my $find_best_cpu = sub {
        my ($cpulist, $cpu) = @_;

        my $cur_cost = $cpu_ctcount[$cpu];
        my $cur_cpu = $cpu;

        foreach my $candidate (@$cpulist) {
            my $cost = $cpu_ctcount[$candidate];
            if ($cost < ($cur_cost - 1)) {
                $cur_cost = $cost;
                $cur_cpu = $candidate;
            }
        }

        return $cur_cpu;
    };

    foreach my $bct (@balanced_cts) {
        my ($vmid, $cores, $cpuset) = @$bct;

        my $rest = [grep { !$cpuset->has($_) } @allowed_cpus];

        my $newset = PVE::CpuSet->new();
        for my $cpu ($cpuset->members()) {
            my $best = $find_best_cpu->($rest, $cpu);
            if ($best != $cpu) {
                $cpu_ctcount[$best]++;
                $cpu_ctcount[$cpu]--;
            }
            $newset->insert($best);
        }

        if (!$newset->is_equal($cpuset)) {
            $modify_cpuset->($vmid, $cpuset, $newset);
        }
    }
}

sub update_lxc_status {
    my ($status_cfg, $pull_txn) = @_;

    my $ctime = time();
    my $vmstatus = PVE::LXC::vmstatus();

    my $transactions = PVE::ExtMetric::transactions_start($status_cfg);

    foreach my $vmid (keys %$vmstatus) {
        my $d = $vmstatus->{$vmid};
        my $template = $d->{template} ? $d->{template} : "0";
        my $data;
        # TODO: drop old pve2.3-vm schema with PVE 10
        if ($rrd_dir_exists->("pve-vm-9.0")) {
            if ($d->{pid}) { # running
                $data = $generate_rrd_string->([
                    $d->{uptime},
                    $d->{name},
                    $d->{status},
                    $template,
                    $ctime,
                    $d->{cpus},
                    $d->{cpu},
                    $d->{maxmem},
                    $d->{mem},
                    $d->{maxdisk},
                    $d->{disk},
                    $d->{netin},
                    $d->{netout},
                    $d->{diskread},
                    $d->{diskwrite},
                    undef,
                    $d->{pressurecpusome},
                    $d->{pressurecpufull},
                    $d->{pressureiosome},
                    $d->{pressureiofull},
                    $d->{pressurememorysome},
                    $d->{pressurememoryfull},
                ]);
            } else {
                $data = $generate_rrd_string->([
                    0,
                    $d->{name},
                    $d->{status},
                    $template,
                    $ctime,
                    $d->{cpus},
                    undef,
                    $d->{maxmem},
                    undef,
                    $d->{maxdisk},
                    $d->{disk},
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                    undef,
                ]);
            }
            PVE::Cluster::broadcast_rrd("pve-vm-9.0/$vmid", $data);
        } else {
            if ($d->{status} eq 'running') { # running
                $data = $generate_rrd_string->([
                    $d->{uptime},
                    $d->{name},
                    $d->{status},
                    $template,
                    $ctime,
                    $d->{cpus},
                    $d->{cpu},
                    $d->{maxmem},
                    $d->{mem},
                    $d->{maxdisk},
                    $d->{disk},
                    $d->{netin},
                    $d->{netout},
                    $d->{diskread},
                    $d->{diskwrite},
                ]);
            } else {
                $data = $generate_rrd_string->([
                    0,
                    $d->{name},
                    $d->{status},
                    $template,
                    $ctime,
                    $d->{cpus},
                    undef,
                    $d->{maxmem},
                    undef,
                    $d->{maxdisk},
                    $d->{disk},
                    undef,
                    undef,
                    undef,
                    undef,
                ]);
            }
            PVE::Cluster::broadcast_rrd("pve2.3-vm/$vmid", $data);
        }

        PVE::ExtMetric::update_all($transactions, 'lxc', $vmid, $d, $ctime, $nodename);
    }
    PVE::ExtMetric::transactions_finish($transactions);

    PVE::PullMetric::update($pull_txn, 'lxc', $vmstatus, $ctime);
}

sub update_storage_status {
    my ($status_cfg, $pull_txn) = @_;

    my $cfg = PVE::Storage::config();
    my $ctime = time();
    my $info = PVE::Storage::storage_info($cfg);

    my $transactions = PVE::ExtMetric::transactions_start($status_cfg);

    foreach my $storeid (keys %$info) {
        my $d = $info->{$storeid};
        next if !$d->{active};

        my $data = $generate_rrd_string->([$ctime, $d->{total}, $d->{used}]);

        my $key = "pve2-storage/${nodename}/$storeid";
        $key = "pve-storage-9.0/${nodename}/$storeid" if $rrd_dir_exists->("pve-storage-9.0");
        PVE::Cluster::broadcast_rrd($key, $data);

        PVE::ExtMetric::update_all($transactions, 'storage', $nodename, $storeid, $d, $ctime);
    }
    PVE::ExtMetric::transactions_finish($transactions);

    PVE::PullMetric::update($pull_txn, 'storage', $info, $ctime);
}

sub rotate_authkeys {
    PVE::AccessControl::rotate_authkey() if !PVE::AccessControl::check_authkey(1);
}

sub update_ceph_metadata {
    return if !PVE::Ceph::Tools::check_ceph_inited(1); # nothing to do

    PVE::Ceph::Services::broadcast_ceph_services();

    PVE::Ceph::Services::broadcast_ceph_versions();
}

sub update_sdn_status {
    my ($zone_status, $vnet_status) = PVE::Network::SDN::Zones::status();

    my $status = $zone_status ? encode_json($zone_status) : undef;
    PVE::Cluster::broadcast_node_kv("sdn", $status);
}

sub update_network_status {
    my $network_status = {};

    my ($fabric_status) = PVE::RS::SDN::Fabrics::status();
    for my $fabric (values $fabric_status->%*) {
        $network_status->{"fabric/$fabric->{network}"} = $fabric;
    }

    my ($zone_status, $vnet_status) = PVE::Network::SDN::Zones::status();
    for my $id (sort keys $zone_status->%*) {
        my $zone = $zone_status->{$id};

        $zone->{'network-type'} = 'zone';
        $zone->{network} = $id;
        $zone->{type} = 'network';

        $network_status->{"zone/$id"} = $zone;
    }

    PVE::Cluster::broadcast_node_kv("network", encode_json($network_status));
}

my $broadcast_version_info_done = 0;
my sub broadcast_version_info : prototype() {
    if (
        !$broadcast_version_info_done
        || !scalar(keys PVE::Cluster::get_node_kv('version-info', $nodename)->%*)
    ) {
        PVE::Cluster::broadcast_node_kv(
            'version-info', encode_json(PVE::pvecfg::version_info()),
        );
        $broadcast_version_info_done = 1;
    }
}

sub update_status {
    # update worker list. This is not really required, but we want to make sure that we also have a
    # correct list in case of an unexpected crash.
    my $rpcenv = PVE::RPCEnvironment::get();

    my $pull_txn = PVE::PullMetric::transaction_start();

    eval {
        my $tlist = $rpcenv->active_workers();
        PVE::Cluster::broadcast_tasklist($tlist);
    };
    my $err = $@;
    syslog('err', $err) if $err;

    my $status_cfg = PVE::Cluster::cfs_read_file('status.cfg');

    eval { update_node_status($status_cfg, $pull_txn); };
    $err = $@;
    syslog('err', "node status update error: $err") if $err;

    eval { update_qemu_status($status_cfg, $pull_txn); };
    $err = $@;
    syslog('err', "qemu status update error: $err") if $err;

    eval { update_lxc_status($status_cfg, $pull_txn); };
    $err = $@;
    syslog('err', "lxc status update error: $err") if $err;

    eval { rebalance_lxc_containers(); };
    $err = $@;
    syslog('err', "lxc cpuset rebalance error: $err") if $err;

    eval { update_storage_status($status_cfg, $pull_txn); };
    $err = $@;
    syslog('err', "storage status update error: $err") if $err;

    eval { remove_stale_lxc_consoles(); };
    $err = $@;
    syslog('err', "lxc console cleanup error: $err") if $err;

    eval { rotate_authkeys(); };
    $err = $@;
    syslog('err', "authkey rotation error: $err") if $err;

    eval { update_ceph_metadata(); };
    $err = $@;
    syslog('err', "ceph metadata update error: $err") if $err;

    eval { update_sdn_status(); };
    $err = $@;
    syslog('err', "sdn status update error: $err") if $err;

    eval { update_network_status(); };
    $err = $@;
    syslog('err', "network status update error: $err") if $err;

    eval { broadcast_version_info(); };
    $err = $@;
    syslog('err', "version info update error: $err") if $err;

    eval { PVE::PullMetric::transaction_finish($pull_txn); };
    $err = $@;
    syslog('err', "could not populate metric data cache: $err") if $err;
}

my $next_update = 0;

# do not update directly after startup, because install scripts
# have a problem with that
my $cycle = 0;
my $updatetime = 10;

my $initial_memory_usage;

sub run {
    my ($self) = @_;

    for (;;) { # forever

        $next_update = time() + $updatetime;

        if ($cycle) {
            my ($ccsec, $cusec) = gettimeofday();
            eval {
                # syslog('info', "start status update");
                PVE::Cluster::cfs_update();
                update_status();
            };
            my $err = $@;

            if ($err) {
                syslog('err', "status update error: $err");
            }

            my ($ccsec_end, $cusec_end) = gettimeofday();
            my $cptime = ($ccsec_end - $ccsec) + ($cusec_end - $cusec) / 1000000;

            syslog('info', sprintf("status update time (%.3f seconds)", $cptime))
                if ($cptime > 5);
        }

        $cycle++;

        my $mem = PVE::ProcFSTools::read_memory_usage();
        my $resident_kb = $mem->{resident} / 1024;

        if (!defined($initial_memory_usage) || ($cycle < 10)) {
            $initial_memory_usage = $resident_kb;
        } else {
            my $diff = $resident_kb - $initial_memory_usage;
            if ($diff > 15 * 1024) {
                syslog(
                    'info',
                    "restarting server after $cycle cycles to "
                        . "reduce memory usage (free $resident_kb ($diff) KB)",
                );
                $self->restart_daemon();
            }
        }

        my $wcount = 0;
        while (
            (time() < $next_update)
            && ($wcount < $updatetime)
            && # protect against time wrap
            !$restart_request
        ) {
            $wcount++;
            sleep(1);
        }

        $self->restart_daemon() if $restart_request;
    }
}

$daemon->register_start_command();
$daemon->register_restart_command(1);
$daemon->register_stop_command();
$daemon->register_status_command();

our $cmddef = {
    start => [__PACKAGE__, 'start', []],
    restart => [__PACKAGE__, 'restart', []],
    stop => [__PACKAGE__, 'stop', []],
    status => [__PACKAGE__, 'status', [], undef, sub { print shift . "\n"; }],
};

1;
