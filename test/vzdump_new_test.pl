#!/usr/bin/perl

use strict;
use warnings;

use lib '..';

use Test::More;
use Test::MockModule;

use PVE::VZDump;

my $vzdump_config;
my $storage_config;

sub prepare_storage_config {
    my ($param) = @_;

    $storage_config = "dir: local\n";
    $storage_config .= "\tcontent backup\n";
    $storage_config .= "\tpath /var/lib/vz\n";

    foreach my $key (keys %{$param}) {
        my $value = $param->{$key};
        $storage_config .= "\t${key} ${value}\n";
    }
}

sub prepare_vzdump_config {
    my ($param) = @_;

    $vzdump_config = "";
    foreach my $key (keys %{$param}) {
        my $value = $param->{$key};
        $vzdump_config .= "${key}: ${value}\n";
    }
}

my $pve_vzdump_module = Test::MockModule->new('PVE::VZDump');
$pve_vzdump_module->mock(
    mkpath => sub {
        return;
    },
    check_bin => sub {
        return;
    },
);

my $pve_storage_module = Test::MockModule->new('PVE::Storage');
$pve_storage_module->mock(
    activate_storage => sub {
        return;
    },
    get_backup_provider => sub {
        return;
    },
);

my $pve_cluster_module = Test::MockModule->new('PVE::Cluster');
$pve_cluster_module->mock(
    get_config => sub {
        my ($filename) = @_;

        die "unexpected filename '$filename'\n" if $filename ne 'storage.cfg';
        return $storage_config;
    },
    # never update during the tests
    cfs_update => sub {
        return;
    },
);

my $pve_tools_module = Test::MockModule->new('PVE::Tools');
$pve_tools_module->mock(
    file_get_contents => sub {
        my ($filename) = @_;

        die "unexpected filename '$filename'\n" if $filename ne '/etc/vzdump.conf';
        return $vzdump_config;
    },
);

my $tested_options;

# each test consists of the following:
# name          - unique name for the test
# cli_param     - CLI parameters to be passed to new(); vmid and storage are hardcoded
# storage_param - parameters for the mocked storage configuration
# vzdump_param  - parameters for the mocked /etc/vzdump.conf
# expected      - expected options
#
# To begin testing for different options, use a fake test like the first one
my @tests = (
    {
        description => 'BEGIN RETENTION TESTS',
        tested_options => ['prune-backups', 'remove'],
    },
    {
        description => 'no params',
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    # TODO make parse error critical?
    {
        description => 'prune-backups vzdump 1',
        vzdump_param => {
            'prune-backups' => 'keep-last=1,keep-hourly=2,keep-daily=3,'
                . 'keep-weekly=4,keep-monthly=5,keep-yearly=6',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 1,
                'keep-hourly' => 2,
                'keep-daily' => 3,
                'keep-weekly' => 4,
                'keep-monthly' => 5,
                'keep-yearly' => 6,
            },
            remove => 1,
        },
    },
    {
        description => 'prune-backups vzdump 2',
        vzdump_param => {
            'prune-backups' => 'keep-all=1',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'prune-backups vzdump 3',
        vzdump_param => {
            'prune-backups' => 'keep-hourly=0,keep-monthly=0,keep-yearly=0',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'prune-backups storage 1',
        storage_param => {
            'prune-backups' => 'keep-last=1,keep-hourly=2,keep-daily=3,'
                . 'keep-weekly=4,keep-monthly=5,keep-yearly=6',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 1,
                'keep-hourly' => 2,
                'keep-daily' => 3,
                'keep-weekly' => 4,
                'keep-monthly' => 5,
                'keep-yearly' => 6,
            },
            remove => 1,
        },
    },
    {
        description => 'prune-backups storage 2',
        storage_param => {
            'prune-backups' => 'keep-last=0,keep-hourly=0,keep-daily=0,'
                . 'keep-weekly=0,keep-monthly=0,keep-yearly=0',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'prune-backups storage 3',
        storage_param => {
            'prune-backups' => 'keep-hourly=0,keep-monthly=0,keep-yearly=0',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'prune-backups CLI 1',
        cli_param => {
            'prune-backups' => 'keep-last=1,keep-hourly=2,keep-daily=3,'
                . 'keep-weekly=4,keep-monthly=5,keep-yearly=6',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 1,
                'keep-hourly' => 2,
                'keep-daily' => 3,
                'keep-weekly' => 4,
                'keep-monthly' => 5,
                'keep-yearly' => 6,
            },
            remove => 1,
        },
    },
    {
        description => 'prune-backups CLI 2',
        cli_param => {
            'prune-backups' => 'keep-last=0,keep-hourly=0,keep-daily=0,'
                . 'keep-weekly=0,keep-monthly=0,keep-yearly=0',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'prune-backups CLI 3',
        cli_param => {
            'prune-backups' => 'foo=bar',
        },
        expected => "format error\n"
            . "foo: property is not defined in schema and the schema does not allow additional properties\n",
    },
    {
        description => 'mixed 1',
        vzdump_param => {
            'prune-backups' => 'keep-last=7',
        },
        storage_param => {
            'prune-backups' => 'keep-hourly=24',
        },
        expected => {
            'prune-backups' => {
                'keep-hourly' => 24,
            },
            remove => 1,
        },
    },
    # TODO make parse error critical?
    {
        description => 'mixed 2',
        vzdump_param => {
            'prune-backups' => 'keep-last=7',
        },
        storage_param => {
            'prune-backups' => 'keephourly=24',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 7,
            },
            remove => 1,
        },
    },
    {
        description => 'mixed 3',
        vzdump_param => {
            'prune-backups' => 'keep-last=7',
        },
        cli_param => {
            'prune-backups' => 'keep-all=1',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'mixed 4',
        vzdump_param => {
            'prune-backups' => 'keep-last=7',
        },
        storage_param => {
            'prune-backups' => 'keep-all=0,keep-last=10',
        },
        cli_param => {
            'prune-backups' => 'keep-all=1',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'mixed 5',
        vzdump_param => {
            'prune-backups' => 'keep-last=7',
        },
        storage_param => {
            'prune-backups' => 'keep-all=0,keep-last=10',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 10,
            },
            remove => 1,
        },
    },
    {
        description => 'mixed 6',
        storage_param => {
            'prune-backups' => 'keep-last=10',
        },
        cli_param => {
            'prune-backups' => 'keep-all=1',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'mixed 7',
        storage_param => {
            'prune-backups' => 'keep-all=1',
        },
        cli_param => {
            'prune-backups' => 'keep-last=10',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 10,
            },
            remove => 1,
        },
    },
    {
        description => 'mixed 8',
        storage_param => {
            'prune-backups' => 'keep-last=10',
        },
        vzdump_param => {
            'prune-backups' => 'keep-all=1',
        },
        expected => {
            'prune-backups' => {
                'keep-last' => 10,
            },
            remove => 1,
        },
    },
    {
        description => 'mixed 9',
        vzdump_param => {
            'prune-backups' => 'keep-last=10',
        },
        cli_param => {
            'prune-backups' => 'keep-all=1',
        },
        expected => {
            'prune-backups' => {
                'keep-all' => 1,
            },
            remove => 0,
        },
    },
    {
        description => 'BEGIN MAILTO TESTS',
        tested_options => ['mailto'],
    },
    {
        description => 'mailto vzdump 1',
        vzdump_param => {
            'mailto' => 'developer@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto vzdump 2',
        vzdump_param => {
            'mailto' => 'developer@proxmox.com admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto vzdump 3',
        vzdump_param => {
            'mailto' => 'developer@proxmox.com,admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto vzdump 4',
        vzdump_param => {
            'mailto' => 'developer@proxmox.com, admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto vzdump 5',
        vzdump_param => {
            'mailto' => ' ,,; developer@proxmox.com, ; admin@proxmox.com ',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto vzdump 6',
        vzdump_param => {
            'mailto' => '',
        },
        expected => {
            'mailto' => [],
        },
    },
    {
        description => 'mailto CLI 1',
        cli_param => {
            'mailto' => 'developer@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto CLI 2',
        cli_param => {
            'mailto' => 'developer@proxmox.com admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto CLI 3',
        cli_param => {
            'mailto' => 'developer@proxmox.com,admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto CLI 4',
        cli_param => {
            'mailto' => 'developer@proxmox.com, admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto CLI 5',
        cli_param => {
            'mailto' => ' ,,; developer@proxmox.com, ; admin@proxmox.com ',
        },
        expected => {
            'mailto' => [
                'developer@proxmox.com', 'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto both 1',
        vzdump_param => {
            'mailto' => 'developer@proxmox.com',
        },
        cli_param => {
            'mailto' => 'admin@proxmox.com',
        },
        expected => {
            'mailto' => [
                'admin@proxmox.com',
            ],
        },
    },
    {
        description => 'mailto both 2',
        vzdump_param => {
            'mailto' => 'developer@proxmox.com',
        },
        cli_param => {
            'mailto' => '',
        },
        expected => {
            'mailto' => [],
        },
    },
);

plan tests => scalar @tests;

foreach my $test (@tests) {
    if (defined($test->{tested_options})) {
        $tested_options = $test->{tested_options};
        ok(1, $test->{description});
        next;
    }

    prepare_storage_config($test->{storage_param});
    prepare_vzdump_config($test->{vzdump_param});

    $test->{cli_param}->{vmid} = 100;
    $test->{cli_param}->{storage} = 'local';

    my $got = eval {
        PVE::VZDump::verify_vzdump_parameters($test->{cli_param}, 1);
        PVE::VZDump::parse_mailto_exclude_path($test->{cli_param});

        my $vzdump = PVE::VZDump->new('fake cmdline', $test->{cli_param}, undef);

        my $opts = $vzdump->{opts} or die "did not get options\n";

        my $res = {};
        foreach my $opt (@{$tested_options}) {
            next if !defined($opts->{$opt});
            $res->{$opt} = $opts->{$opt};
        }
        return $res;
    };
    $got = $@ if $@;

    is_deeply($got, $test->{expected}, $test->{description}) || diag(explain($got));
}

done_testing();
