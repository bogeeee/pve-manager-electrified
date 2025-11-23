#!/usr/bin/perl

# Note: Try to run replication job to same node (should fail)

use strict;
use warnings;

use JSON;

use lib ('.', '../..');

use Test::MockModule;
use Test::More;

use ReplicationTestEnv;
use PVE::API2::Replication;

$ReplicationTestEnv::mocked_nodename = 'node1';

my $testjob = {
    'type' => 'local',
    'target' => 'node1',
    'guest' => 900,
};

$ReplicationTestEnv::mocked_replication_jobs = {
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

eval { PVE::API2::Replication::run_single_job('job_900_to_node1', 1000); };
my $err = $@;

is($err, "unable to sync to local node\n", "test error message");

done_testing();
