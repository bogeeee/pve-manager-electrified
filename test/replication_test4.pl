#!/usr/bin/perl

# Note: Test replication job failure

use strict;
use warnings;
use JSON;

use lib ('.', '../..');

use Test::MockModule;
use ReplicationTestEnv;

use PVE::Tools;

$ReplicationTestEnv::mocked_nodename = 'node1';

my $pve_replication_module = Test::MockModule->new('PVE::Replication');
$pve_replication_module->mock(replicate => sub { die "faked replication error\n"; });

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
    job_900_to_node1 => {
        'type' => 'local',
        'target' => 'node1', # local node, job should be skipped
        'guest' => 900,
    },
};

$ReplicationTestEnv::mocked_vm_configs = {
    900 => {
        node => 'node1',
        snapshots => {},
        ide0 => 'local-lvm:vm-900-disk-1,size=4G',
        memory => 512,
        ide2 => 'none,media=cdrom',
    },
};

ReplicationTestEnv::setup();

my $ctime = 1000;

my $status;

ReplicationTestEnv::openlog();

for (my $i = 0; $i < 120; $i++) {
    ReplicationTestEnv::track_jobs($ctime);
    $ctime += 60;
}

ReplicationTestEnv::commit_log();

exit(0);
