#!/usr/bin/perl

# Note: Test if mockup from ReplicationTestEnv works

use strict;
use warnings;

use JSON;

use lib ('.', '../..');

use ReplicationTestEnv;
use Test::More tests => 3;

$ReplicationTestEnv::mocked_nodename = 'node1';

my $testjob = {
    'type' => 'local',
    'target' => 'node1',
    'guest' => 900,
};

$ReplicationTestEnv::mocked_replication_jobs = {
    job_900_to_node1 => $testjob,
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

ok(PVE::INotify::nodename() eq 'node1');

my $list = PVE::Cluster::get_vmlist();
is_deeply($list, { ids => { 900 => { node => 'node1', type => 'qemu', version => 1 } } });
my $cfg = PVE::ReplicationConfig->new();
is_deeply($cfg, { ids => { job_900_to_node1 => $testjob } });

exit(0);
