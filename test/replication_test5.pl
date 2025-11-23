#!/usr/bin/perl

# Note:
# 1.) Start replication job with single disk
# 2.) add non-existent disk (replication fails)
# 3.) create disk (replication continues).
# 4.) remove job

use strict;
use warnings;
use JSON;

use lib ('.', '../..');

use Test::MockModule;
use ReplicationTestEnv;

use PVE::Tools;

$ReplicationTestEnv::mocked_nodename = 'node1';

use PVE::INotify;
use PVE::Cluster;
use PVE::QemuConfig;
use PVE::QemuServer;
use PVE::LXC::Config;
use PVE::LXC;
use PVE::Storage;

my $replicated_volume_status = {};

my $mocked_remote_prepare_local_job = sub {
    my ($ssh_info, $jobid, $vmid, $volumes, $storeid_list, $last_sync, $parent_snapname, $force)
        = @_;

    my $target = $ssh_info->{node};

    my $last_snapshots = {};

    return $last_snapshots if !defined($replicated_volume_status->{$target});

    my $last_sync_snapname =
        PVE::ReplicationState::replication_snapshot_name($jobid, $last_sync);

    foreach my $volid (keys %{ $replicated_volume_status->{$target} }) {
        if (!grep { $_ eq $volid } @$volumes) {
            delete $replicated_volume_status->{$target}->{$volid};
            next;
        }
        my $snapname = $replicated_volume_status->{$target}->{$volid};

        $last_snapshots->{$volid}->{$snapname} = 1 if $last_sync_snapname eq $snapname;
    }

    return $last_snapshots;
};

my $mocked_remote_finalize_local_job = sub {
    my ($ssh_info, $jobid, $vmid, $volumes, $last_sync) = @_;

    # do nothing
};

my $mocked_replicate_volume = sub {
    my ($ssh_info, $storecfg, $volid, $base_snapshot, $sync_snapname) = @_;

    my $target = $ssh_info->{node};

    $replicated_volume_status->{$target}->{$volid} = $sync_snapname;
};

my $mocked_delete_job = sub {
    my ($jobid) = @_;

    delete $ReplicationTestEnv::mocked_replication_jobs->{$jobid};
};

my $pve_replication_config_module = Test::MockModule->new('PVE::ReplicationConfig');
$pve_replication_config_module->mock(delete_job => $mocked_delete_job);

my $pve_replication_module = Test::MockModule->new('PVE::Replication');
$pve_replication_module->mock(
    remote_prepare_local_job => $mocked_remote_prepare_local_job,
    remote_finalize_local_job => $mocked_remote_finalize_local_job,
    replicate_volume => $mocked_replicate_volume,
);

my $testjob = {
    'type' => 'local',
    'target' => 'node1',
    'guest' => 900,
};

$ReplicationTestEnv::mocked_replication_jobs = {
    job_900_to_node2 => {
        'type' => 'local',
        'target' => 'node2',
        'guest' => 900,
    },
};

$ReplicationTestEnv::mocked_vm_configs = {
    900 => {
        node => 'node1',
        snapshots => {},
        ide0 => 'local-zfs:vm-900-disk-1,size=4G',
        memory => 512,
        ide2 => 'none,media=cdrom',
    },
};

ReplicationTestEnv::setup();

ReplicationTestEnv::register_mocked_volid('local-zfs:vm-900-disk-1');

my $ctime = 1000;

my $status;

ReplicationTestEnv::openlog();

for (my $i = 0; $i < 15; $i++) {
    ReplicationTestEnv::track_jobs($ctime);
    $ctime += 60;
}

# add a new, disk (but disk does not exist, so replication fails)
$ReplicationTestEnv::mocked_vm_configs->{900}->{ide1} = 'local-zfs:vm-900-disk-2,size=4G';
for (my $i = 0; $i < 15; $i++) {
    ReplicationTestEnv::track_jobs($ctime);
    $ctime += 60;
}

# register disk, so replication should succeed
ReplicationTestEnv::register_mocked_volid('local-zfs:vm-900-disk-2');
for (my $i = 0; $i < 15; $i++) {
    ReplicationTestEnv::track_jobs($ctime);
    $ctime += 60;
}

# mark job for removal
$ReplicationTestEnv::mocked_replication_jobs->{job_900_to_node2}->{remove_job} = 'full';
for (my $i = 0; $i < 15; $i++) {
    ReplicationTestEnv::track_jobs($ctime);
    $ctime += 60;
}

ReplicationTestEnv::commit_log();

exit(0);
