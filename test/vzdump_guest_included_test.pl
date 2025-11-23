#!/usr/bin/perl

use strict;
use warnings;

use lib '..';

use Test::More tests => 10;
use Test::MockModule;

use PVE::VZDump;

use Data::Dumper;

my $vmlist = {
    'ids' => {
        100 => {
            'type' => 'qemu',
            'node' => 'node1',
        },
        101 => {
            'type' => 'qemu',
            'node' => 'node1',
        },
        112 => {
            'type' => 'lxc',
            'node' => 'node1',
        },
        113 => {
            'type' => 'lxc',
            'node' => 'node1',
        },
        200 => {
            'type' => 'qemu',
            'node' => 'node2',
        },
        201 => {
            'type' => 'qemu',
            'node' => 'node2',
        },
        212 => {
            'type' => 'lxc',
            'node' => 'node2',
        },
        213 => {
            'type' => 'lxc',
            'node' => 'node2',
        },
    },
};

my $pools = {
    testpool => [100, 101, 200, 201],
};

my $pve_cluster_module = Test::MockModule->new('PVE::Cluster');
$pve_cluster_module->mock(
    get_vmlist => sub {
        return $vmlist;
    },
);

my $pve_inotify = Test::MockModule->new('PVE::INotify');
$pve_inotify->mock(
    nodename => sub {
        return 'node1';
    },
);

my $pve_api2tools = Test::MockModule->new('PVE::API2Tools');
$pve_api2tools->mock(
    get_resource_pool_guest_members => sub {
        return $pools->{testpool};
    },
);

my $tests = [];
my $addtest = sub {
    my ($name, $test) = @_;
    push @$tests,
        {
            name => $name,
            test => $test,
        };
};

$addtest->(
    'Test all guests',
    {
        expected => {
            node1 => [100, 101, 112, 113],
            node2 => [200, 201, 212, 213],
        },
        param => {
            all => 1,
        },
    },
);

$addtest->(
    'Test all guests with node limit',
    {
        expected => {
            node2 => [200, 201, 212, 213],
        },
        param => {
            all => 1,
            node => 'node2',
        },
    },
);

$addtest->(
    'Test exclude',
    {
        expected => {
            node1 => [101, 112, 113],
            node2 => [201, 212, 213],
        },
        param => {
            all => 1,
            exclude => '100, 102, 200, 202',
        },
    },
);

$addtest->(
    'Test exclude with node limit',
    {
        expected => {
            node1 => [101, 112, 113],
        },
        param => {
            all => 1,
            exclude => '100, 102, 200, 202',
            node => 'node1',
        },
    },
);

$addtest->(
    'Test pool members',
    {
        expected => {
            node1 => [100, 101],
            node2 => [200, 201],
        },
        param => {
            pool => 'testpool',
        },
    },
);

$addtest->(
    'Test pool members with node limit',
    {
        expected => {
            node2 => [200, 201],
        },
        param => {
            pool => 'testpool',
            node => 'node2',
        },
    },
);

$addtest->(
    'Test selected VMIDs',
    {
        expected => {
            node1 => [100],
            node2 => [201, 212],
        },
        param => {
            vmid => '100, 201, 212',
        },
    },
);

$addtest->(
    'Test selected VMIDs with node limit',
    {
        expected => {
            node1 => [100],
        },
        param => {
            vmid => '100, 201, 212',
            node => 'node1',
        },
    },
);

$addtest->(
    'Test selected VMIDs on other nodes',
    {
        expected => {},
        param => {
            vmid => '201, 212',
            node => 'node1',
        },
    },
);

$addtest->(
    'Test VMID not present in vmlist',
    {
        expected => {
            node1 => [100],
            node2 => [201, 212],
            '' => [7654],
        },
        param => {
            vmid => '100, 201, 212, 7654',
        },
    },
);

for my $test (@{$tests}) {
    my $testname = $test->{name};
    my $testdata = $test->{test};

    # note($testname);

    my $result = PVE::VZDump::get_included_guests($testdata->{param});

    is_deeply($result, $testdata->{expected}, $testname);
}

exit(0);
