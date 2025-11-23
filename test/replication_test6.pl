#!/usr/bin/perl

# Note: Try to delete replication job with target on same node

use strict;
use warnings;
use JSON;

use lib ('.', '../..');

use Test::MockModule;
use ReplicationTestEnv;

$ReplicationTestEnv::mocked_nodename = 'node1';

my $mocked_delete_job = sub {
    my ($jobid) = @_;

    delete $ReplicationTestEnv::mocked_replication_jobs->{$jobid};
};

my $pve_replication_config_module = Test::MockModule->new('PVE::ReplicationConfig');
$pve_replication_config_module->mock(delete_job => $mocked_delete_job);

my $testjob = {
    'type' => 'local',
    'target' => 'node1',
    'guest' => 900,
};

$ReplicationTestEnv::mocked_replication_jobs = {
    job_900_to_node1 => {
        remove_job => 'full',
        type => 'local',
        target => 'node1', # local node, job should be skipped
        guest => 900,
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

ReplicationTestEnv::openlog();

my $ctime = 1000;
for (my $i = 0; $i < 15; $i++) {
    ReplicationTestEnv::track_jobs($ctime);
    $ctime += 60;
}

ReplicationTestEnv::commit_log();

exit(0);
