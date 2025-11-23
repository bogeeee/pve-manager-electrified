package PVE::PullMetric;
use strict;
use warnings;

use Proxmox::RS::SharedCache;
use PVE::Network;

# with the pvestatd 10s update interval this covers 30 minutes of data.
use constant OLD_GENERATIONS => 180;
use constant LOCK_TIMEOUT => 2;

my $cache;
my $get_cache = sub {
    if (!defined($cache)) {

        my $uid = getpwnam('root');
        my $gid = getgrnam('www-data');

        $cache = Proxmox::RS::SharedCache->new(
            {
                path => "/run/pve/metrics",
                owner => $uid,
                group => $gid,
                entry_mode => 0640, # Entry permissions
                keep_old => OLD_GENERATIONS,
            },
        );
    }

    return $cache;
};

# Return the number of generations stored by the metrics cache
sub max_generations {
    # Number of old stats plus the most recent ones
    return OLD_GENERATIONS + 1;
}

sub transaction_start {
    return {};
}

sub transaction_finish {
    my ($txn) = @_;

    $get_cache->()->set($txn, 2);
}

sub update {
    my ($txn, $subsystem, $data, $timestamp) = @_;

    $txn->{$subsystem}->{data} = $data;
    $txn->{$subsystem}->{timestamp} = $timestamp;
}

my sub gauge {
    my ($id, $timestamp, $metric, $value) = @_;

    return {
        metric => $metric,
        id => $id,
        value => $value + 0,
        timestamp => $timestamp + 0,
        type => 'gauge',
    };
}

my sub derive {
    my ($id, $timestamp, $metric, $value) = @_;

    return {
        metric => $metric,
        id => $id,
        value => $value + 0,
        timestamp => $timestamp + 0,
        type => 'derive',
    };
}

my $nodename = PVE::INotify::nodename();

my sub get_node_metrics {
    my ($stats) = @_;

    my $metrics = [];

    my $data = $stats->{data};
    my $timestamp = $stats->{timestamp};

    my $id = "node/$nodename";

    push @$metrics, gauge($id, $timestamp, "uptime", $data->{uptime});

    my ($netin, $netout) = (0, 0);

    for my $dev (keys $data->{nics}->%*) {
        my $nic_data = $data->{nics}->{$dev};

        if ($nic_data->{type}) {
            next if $nic_data->{type} ne 'physical';
        } else {
            next if $dev !~ /^$PVE::Network::PHYSICAL_NIC_RE$/;
        }

        $netin += $nic_data->{receive};
        $netout += $nic_data->{transmit};
    }
    push @$metrics, derive($id, $timestamp, "net_in", $netin);
    push @$metrics, derive($id, $timestamp, "net_out", $netout);

    my $cpustat = $data->{cpustat};
    push @$metrics, gauge($id, $timestamp, "cpu_avg1", $cpustat->{avg1});
    push @$metrics, gauge($id, $timestamp, "cpu_avg5", $cpustat->{avg5});
    push @$metrics, gauge($id, $timestamp, "cpu_avg15", $cpustat->{avg15});
    push @$metrics, gauge($id, $timestamp, "cpu_max", $cpustat->{cpus});
    push @$metrics, gauge($id, $timestamp, "cpu_current", $cpustat->{cpu});
    push @$metrics, gauge($id, $timestamp, "cpu_iowait", $cpustat->{wait});

    my $memory = $data->{memory};
    push @$metrics, gauge($id, $timestamp, "mem_total", $memory->{memtotal});
    push @$metrics, gauge($id, $timestamp, "mem_used", $memory->{memused});
    push @$metrics, gauge($id, $timestamp, "swap_total", $memory->{swaptotal});
    push @$metrics, gauge($id, $timestamp, "swap_used", $memory->{swapused});

    my $blockstat = $data->{blockstat};
    my $dused = $blockstat->{blocks} - $blockstat->{bfree};
    push @$metrics, gauge($id, $timestamp, "disk_total", $blockstat->{blocks});
    push @$metrics, gauge($id, $timestamp, "disk_used", $dused);

    return $metrics;
}

my sub get_qemu_metrics {
    my ($stats) = @_;

    my $metrics = [];

    my $timestamp = $stats->{timestamp};

    for my $vmid (keys $stats->{data}->%*) {
        my $id = "qemu/$vmid";
        my $guest_data = $stats->{data}->{$vmid};

        if ($guest_data->{status} eq 'running') {
            push @$metrics, gauge($id, $timestamp, "cpu_current", $guest_data->{cpu});
            push @$metrics, gauge($id, $timestamp, "mem_used", $guest_data->{mem});
            push @$metrics, derive($id, $timestamp, "disk_read", $guest_data->{diskread});
            push @$metrics, derive($id, $timestamp, "disk_write", $guest_data->{diskwrite});
            push @$metrics, derive($id, $timestamp, "net_in", $guest_data->{netin});
            push @$metrics, derive($id, $timestamp, "net_out", $guest_data->{netout});
        }

        push @$metrics, gauge($id, $timestamp, "uptime", $guest_data->{uptime});
        push @$metrics, gauge($id, $timestamp, "cpu_max", $guest_data->{cpus});
        push @$metrics, gauge($id, $timestamp, "mem_total", $guest_data->{maxmem});
        push @$metrics, gauge($id, $timestamp, "disk_total", $guest_data->{maxdisk});
        # TODO: This one always seems to be 0?
        # push @$metrics, num_metric("disk_used", $id, $guest_data->{disk}, $timestamp);
    }

    return $metrics;
}

my sub get_lxc_metrics {
    my ($stats) = @_;

    my $metrics = [];

    my $timestamp = $stats->{timestamp};

    for my $vmid (keys $stats->{data}->%*) {
        my $id = "lxc/$vmid";
        my $guest_data = $stats->{data}->{$vmid};

        if ($guest_data->{status} eq 'running') {
            push @$metrics, gauge($id, $timestamp, "cpu_current", $guest_data->{cpu});
            push @$metrics, gauge($id, $timestamp, "mem_used", $guest_data->{mem});
            push @$metrics, derive($id, $timestamp, "disk_read", $guest_data->{diskread});
            push @$metrics, derive($id, $timestamp, "disk_write", $guest_data->{diskwrite});
            push @$metrics, derive($id, $timestamp, "net_in", $guest_data->{netin});
            push @$metrics, derive($id, $timestamp, "net_out", $guest_data->{netout});
            push @$metrics, gauge($id, $timestamp, "disk_used", $guest_data->{disk});
        }

        push @$metrics, gauge($id, $timestamp, "uptime", $guest_data->{uptime});
        push @$metrics, gauge($id, $timestamp, "cpu_max", $guest_data->{cpus});
        push @$metrics, gauge($id, $timestamp, "mem_total", $guest_data->{maxmem});
        push @$metrics, gauge($id, $timestamp, "disk_total", $guest_data->{maxdisk});
    }

    return $metrics;
}

my sub get_storage_metrics {
    my ($stats) = @_;

    my $metrics = [];

    my $timestamp = $stats->{timestamp};

    for my $sid (keys $stats->{data}->%*) {
        my $id = "storage/$nodename/$sid";
        my $data = $stats->{data}->{$sid};

        push @$metrics, gauge($id, $timestamp, "disk_total", $data->{total});
        push @$metrics, gauge($id, $timestamp, "disk_used", $data->{used});
    }

    return $metrics;
}

# Return local metrics, including some recent history if needed.
#
sub get_local_metrics {
    my ($history) = @_;

    # If we do not provide the history parameter, set it to 0 -> only
    # query most recent metrics from the cache.
    $history = $history // 0;
    $history = int($history);

    my $metrics = [];

    my $data = $get_cache->()->get_last($history);

    for my $stat_gen ($data->@*) {
        push @$metrics, get_node_metrics($stat_gen->{node})->@*;
        push @$metrics, get_qemu_metrics($stat_gen->{qemu})->@*;
        push @$metrics, get_lxc_metrics($stat_gen->{lxc})->@*;
        push @$metrics, get_storage_metrics($stat_gen->{storage})->@*;
    }

    return $metrics;
}

1;
