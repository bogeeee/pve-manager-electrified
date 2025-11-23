package PVE::API2::Pool;

use strict;
use warnings;

use PVE::AccessControl;
use PVE::Cluster qw (cfs_read_file cfs_write_file);
use PVE::Exception qw(raise_param_exc);
use PVE::INotify;
use PVE::Storage;

use PVE::SafeSyslog;

use PVE::API2Tools;
use PVE::RESTHandler;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "List pools or get pool configuration.",
    permissions => {
        description =>
            "List all pools where you have Pool.Audit permissions on /pool/<pool>, or the pool specific with {poolid}",
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => {
                type => 'string',
                format => 'pve-poolid',
                optional => 1,
            },
            type => {
                type => 'string',
                enum => ['qemu', 'lxc', 'storage'],
                optional => 1,
                requires => 'poolid',
            },
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                poolid => { type => 'string' },
                comment => {
                    type => 'string',
                    optional => 1,
                },
                members => {
                    type => 'array',
                    optional => 1,
                    items => {
                        type => "object",
                        additionalProperties => 1,
                        properties => {
                            type => {
                                type => 'string',
                                enum => ['qemu', 'lxc', 'openvz', 'storage'],
                            },
                            id => {
                                type => 'string',
                            },
                            node => {
                                type => 'string',
                            },
                            vmid => {
                                type => 'integer',
                                optional => 1,
                            },
                            storage => {
                                type => 'string',
                                optional => 1,
                            },
                        },
                    },
                },
            },
        },
        links => [{ rel => 'child', href => "{poolid}" }],
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $usercfg = $rpcenv->{user_cfg};

        my $res = [];
        if (my $poolid = $param->{poolid}) {
            $rpcenv->check($authuser, "/pool/$poolid", ['Pool.Audit'], 1);

            my $vmlist = PVE::Cluster::get_vmlist() || {};
            my $idlist = $vmlist->{ids} || {};

            my $rrd = PVE::Cluster::rrd_dump();

            my $pool_config = $usercfg->{pools}->{$poolid};

            die "pool '$poolid' does not exist\n" if !$pool_config;

            my $members = [];
            for my $vmid (sort keys %{ $pool_config->{vms} }) {
                my $vmdata = $idlist->{$vmid};
                next
                    if !$vmdata || defined($param->{type}) && $param->{type} ne $vmdata->{type};
                my $entry = PVE::API2Tools::extract_vm_stats($vmid, $vmdata, $rrd);
                push @$members, $entry;
            }

            my $nodename = PVE::INotify::nodename();
            my $cfg = PVE::Storage::config();
            if (!defined($param->{type}) || $param->{type} eq 'storage') {
                for my $storeid (sort keys %{ $pool_config->{storage} }) {
                    my $scfg = PVE::Storage::storage_config($cfg, $storeid, 1);
                    next if !$scfg;

                    my $storage_node = $nodename; # prefer local node
                    if ($scfg->{nodes} && !$scfg->{nodes}->{$storage_node}) {
                        for my $node (sort keys(%{ $scfg->{nodes} })) {
                            $storage_node = $node;
                            last;
                        }
                    }

                    my $entry =
                        PVE::API2Tools::extract_storage_stats($storeid, $scfg, $storage_node, $rrd);
                    push @$members, $entry;
                }
            }

            my $pool_info = {
                members => $members,
            };
            $pool_info->{comment} = $pool_config->{comment} if defined($pool_config->{comment});
            $pool_info->{poolid} = $poolid;

            push @$res, $pool_info;
        } else {
            for my $pool (sort keys %{ $usercfg->{pools} }) {
                next if !$rpcenv->check($authuser, "/pool/$pool", ['Pool.Audit'], 1);

                my $entry = { poolid => $pool };
                my $pool_config = $usercfg->{pools}->{$pool};
                $entry->{comment} = $pool_config->{comment} if defined($pool_config->{comment});
                push @$res, $entry;
            }
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'create_pool',
    protected => 1,
    path => '',
    method => 'POST',
    permissions => {
        check => ['perm', '/pool/{poolid}', ['Pool.Allocate']],
    },
    description => "Create new pool.",
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => {
                type => 'string',
                format => 'pve-poolid',
            },
            comment => {
                type => 'string',
                optional => 1,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        PVE::AccessControl::lock_user_config(
            sub {
                my $usercfg = cfs_read_file("user.cfg");
                my $pool = $param->{poolid};

                die "pool '$pool' already exists\n" if $usercfg->{pools}->{$pool};
                if ($pool =~ m!^(.*)/([^/]+)$!) {
                    my ($parent, $leaf) = ($1, $2);
                    die "parent '$parent' of pool '$pool' does not exist\n"
                        if !defined($usercfg->{pools}->{$parent});
                    die "pool name must start with a letter\n" if $leaf !~ m!^[A-Za-z]!;
                } else {
                    die "pool name must start with a letter\n" if $pool !~ m!^[A-Za-z]!;
                }

                $usercfg->{pools}->{$pool} = {
                    vms => {},
                    storage => {},
                };

                $usercfg->{pools}->{$pool}->{comment} = $param->{comment} if $param->{comment};

                cfs_write_file("user.cfg", $usercfg);
            },
            "create pool failed",
        );

        return;
    },
});

__PACKAGE__->register_method({
    name => 'update_pool_deprecated',
    protected => 1,
    path => '{poolid}',
    method => 'PUT',
    permissions => {
        description =>
            "You also need the right to modify permissions on any object you add/delete.",
        check => ['perm', '/pool/{poolid}', ['Pool.Allocate']],
    },
    description =>
        "Update pool data (deprecated, no support for nested pools - use 'PUT /pools/?poolid={poolid}' instead).",
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => { type => 'string', format => 'pve-poolid' },
            comment => { type => 'string', optional => 1 },
            vms => {
                description => 'List of guest VMIDs to add or remove from this pool.',
                type => 'string',
                format => 'pve-vmid-list',
                optional => 1,
            },
            storage => {
                description => 'List of storage IDs to add or remove from this pool.',
                type => 'string',
                format => 'pve-storage-id-list',
                optional => 1,
            },
            'allow-move' => {
                description => 'Allow adding a guest even if already in another pool.'
                    . ' The guest will be removed from its current pool and added to this one.',
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            delete => {
                description =>
                    'Remove the passed VMIDs and/or storage IDs instead of adding them.',
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        return __PACKAGE__->update_pool($param);
    },
});

__PACKAGE__->register_method({
    name => 'update_pool',
    protected => 1,
    path => '',
    method => 'PUT',
    permissions => {
        description =>
            "You also need the right to modify permissions on any object you add/delete.",
        check => ['perm', '/pool/{poolid}', ['Pool.Allocate']],
    },
    description => "Update pool.",
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => { type => 'string', format => 'pve-poolid' },
            comment => { type => 'string', optional => 1 },
            vms => {
                description => 'List of guest VMIDs to add or remove from this pool.',
                type => 'string',
                format => 'pve-vmid-list',
                optional => 1,
            },
            storage => {
                description => 'List of storage IDs to add or remove from this pool.',
                type => 'string',
                format => 'pve-storage-id-list',
                optional => 1,
            },
            'allow-move' => {
                description => 'Allow adding a guest even if already in another pool.'
                    . ' The guest will be removed from its current pool and added to this one.',
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            delete => {
                description =>
                    'Remove the passed VMIDs and/or storage IDs instead of adding them.',
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        PVE::AccessControl::lock_user_config(
            sub {
                my $usercfg = cfs_read_file("user.cfg");
                my $pool = $param->{poolid};
                my $pool_config = $usercfg->{pools}->{$pool};

                die "pool '$pool' does not exist\n" if !$pool_config;

                $pool_config->{comment} = $param->{comment} if defined($param->{comment});

                if (defined($param->{vms})) {
                    for my $vmid (PVE::Tools::split_list($param->{vms})) {
                        $rpcenv->check_perm_modify($authuser, "/vms/$vmid");

                        if ($param->{delete}) {
                            die "VM $vmid is not a pool member\n"
                                if !$pool_config->{vms}->{$vmid};
                            delete $pool_config->{vms}->{$vmid};
                            delete $usercfg->{vms}->{$vmid};
                        } else {
                            die "VM $vmid is already a pool member\n"
                                if $pool_config->{vms}->{$vmid};
                            if (defined(my $existing_pool = $usercfg->{vms}->{$vmid})) {
                                die
                                    "VM $vmid belongs already to pool '$existing_pool' and 'allow-move' is not set\n"
                                    if !$param->{'allow-move'};

                                $rpcenv->check(
                                    $authuser, "/pool/$existing_pool", ['Pool.Allocate'],
                                );
                                delete $usercfg->{pools}->{$existing_pool}->{vms}->{$vmid};
                            }
                            $pool_config->{vms}->{$vmid} = 1;
                            $usercfg->{vms}->{$vmid} = $pool;
                        }
                    }
                }

                if (defined($param->{storage})) {
                    for my $storeid (PVE::Tools::split_list($param->{storage})) {
                        $rpcenv->check_perm_modify($authuser, "/storage/$storeid");

                        if ($param->{delete}) {
                            die "Storage '$storeid' is not a pool member\n"
                                if !$pool_config->{storage}->{$storeid};
                            delete $pool_config->{storage}->{$storeid};
                        } else {
                            die "Storage '$storeid' is already a pool member\n"
                                if $pool_config->{storage}->{$storeid};

                            $pool_config->{storage}->{$storeid} = 1;
                        }
                    }
                }

                cfs_write_file("user.cfg", $usercfg);
            },
            "update pools failed",
        );

        return;
    },
});

__PACKAGE__->register_method({
    name => 'read_pool',
    path => '{poolid}',
    method => 'GET',
    permissions => {
        check => ['perm', '/pool/{poolid}', ['Pool.Audit']],
    },
    description =>
        "Get pool configuration (deprecated, no support for nested pools, use 'GET /pools/?poolid={poolid}').",
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => {
                type => 'string',
                format => 'pve-poolid',
            },
            type => {
                type => 'string',
                enum => ['qemu', 'lxc', 'storage'],
                optional => 1,
            },
        },
    },
    returns => {
        type => "object",
        additionalProperties => 0,
        properties => {
            comment => {
                type => 'string',
                optional => 1,
            },
            members => {
                type => 'array',
                items => {
                    type => "object",
                    additionalProperties => 1,
                    properties => {
                        type => {
                            type => 'string',
                            enum => ['qemu', 'lxc', 'openvz', 'storage'],
                        },
                        id => {
                            type => 'string',
                        },
                        node => {
                            type => 'string',
                        },
                        vmid => {
                            type => 'integer',
                            optional => 1,
                        },
                        storage => {
                            type => 'string',
                            optional => 1,
                        },
                    },
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $pool_info = __PACKAGE__->index($param);
        return $pool_info->[0];
    },
});

__PACKAGE__->register_method({
    name => 'delete_pool_deprecated',
    protected => 1,
    path => '{poolid}',
    method => 'DELETE',
    permissions => {
        description => "You can only delete empty pools (no members).",
        check => ['perm', '/pool/{poolid}', ['Pool.Allocate']],
    },
    description =>
        "Delete pool (deprecated, no support for nested pools, use 'DELETE /pools/?poolid={poolid}').",
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => { type => 'string', format => 'pve-poolid' },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        return __PACKAGE__->delete_pool($param);
    },
});

__PACKAGE__->register_method({
    name => 'delete_pool',
    protected => 1,
    path => '',
    method => 'DELETE',
    permissions => {
        description => "You can only delete empty pools (no members).",
        check => ['perm', '/pool/{poolid}', ['Pool.Allocate']],
    },
    description => "Delete pool.",
    parameters => {
        additionalProperties => 0,
        properties => {
            poolid => { type => 'string', format => 'pve-poolid' },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        PVE::AccessControl::lock_user_config(
            sub {
                my $vmlist = PVE::Cluster::get_vmlist() || {};
                my $idlist = $vmlist->{ids} || {};

                my $storecfg = PVE::Storage::config();
                my $usercfg = cfs_read_file("user.cfg");

                my $pool = $param->{poolid};

                my $pool_config = $usercfg->{pools}->{$pool};
                die "pool '$pool' does not exist\n" if !$pool_config;
                for my $subpool (sort keys %{ $pool_config->{pools} }) {
                    die "pool '$pool' is not empty (contains pool '$subpool')\n";
                }

                for my $vmid (sort keys %{ $pool_config->{vms} }) {
                    next if !$idlist->{$vmid}; # ignore destroyed guests
                    die "pool '$pool' is not empty (contains VM $vmid)\n";
                }

                for my $storeid (sort keys %{ $pool_config->{storage} }) {
                    next if !PVE::Storage::storage_config($storecfg, $storeid, 1);
                    die "pool '$pool' is not empty (contains storage '$storeid')\n";
                }

                delete($usercfg->{pools}->{$pool});
                PVE::AccessControl::delete_pool_acl($pool, $usercfg);

                cfs_write_file("user.cfg", $usercfg);
            },
            "delete pool failed",
        );

        return;
    },
});

1;
