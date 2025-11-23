package PVE::API2::Cluster::Mapping::PCI;

use strict;
use warnings;

use Storable qw(dclone);

use PVE::Mapping::PCI ();
use PVE::JSONSchema qw(get_standard_option);
use PVE::Tools qw(extract_param);

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    # only proxy if we give the 'check-node' parameter
    proxyto_callback => sub {
        my ($rpcenv, $proxyto, $param) = @_;
        return $param->{'check-node'} // 'localhost';
    },
    description => "List PCI Hardware Mapping",
    permissions => {
        description => "Only lists entries where you have 'Mapping.Modify', 'Mapping.Use' or"
            . " 'Mapping.Audit' permissions on '/mapping/pci/<id>'.",
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            'check-node' => get_standard_option(
                'pve-node',
                {
                    description => "If given, checks the configurations on the given node for "
                        . "correctness, and adds relevant diagnostics for the devices to the response.",
                    optional => 1,
                },
            ),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                id => {
                    type => 'string',
                    description => "The logical ID of the mapping.",
                },
                map => {
                    type => 'array',
                    description => "The entries of the mapping.",
                    items => {
                        type => 'string',
                        description => "A mapping for a node.",
                    },
                },
                description => {
                    type => 'string',
                    description => "A description of the logical mapping.",
                },
                checks => {
                    type => "array",
                    optional => 1,
                    description => "A list of checks, only present if 'check_node' is set.",
                    items => {
                        type => 'object',
                        properties => {
                            severity => {
                                type => "string",
                                enum => ['warning', 'error'],
                                description => "The severity of the error",
                            },
                            message => {
                                type => "string",
                                description => "The message of the error",
                            },
                        },
                    },
                },
            },
        },
        links => [{ rel => 'child', href => "{id}" }],
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $check_node = $param->{'check-node'};
        my $local_node = PVE::INotify::nodename();

        die "wrong node to check - $check_node != $local_node\n"
            if defined($check_node) && $check_node ne 'localhost' && $check_node ne $local_node;

        my $cfg = PVE::Mapping::PCI::config();

        my $can_see_mapping_privs = ['Mapping.Modify', 'Mapping.Use', 'Mapping.Audit'];

        my $res = [];
        for my $id (keys $cfg->{ids}->%*) {
            next
                if !$rpcenv->check_any($authuser, "/mapping/pci/$id", $can_see_mapping_privs, 1);
            next if !$cfg->{ids}->{$id};

            my $entry = dclone($cfg->{ids}->{$id});
            $entry->{id} = $id;
            $entry->{digest} = $cfg->{digest};

            if (defined($check_node)) {
                $entry->{checks} = [];
                if (
                    my $mappings = PVE::Mapping::PCI::get_node_mapping($cfg, $id, $check_node)
                ) {
                    if (!scalar($mappings->@*)) {
                        push $entry->{checks}->@*,
                            {
                                severity => 'warning',
                                message => "No mapping for node $check_node.",
                            };
                    }
                    for my $mapping ($mappings->@*) {
                        eval { PVE::Mapping::PCI::assert_valid($id, $mapping, $entry) };
                        if (my $err = $@) {
                            push $entry->{checks}->@*,
                                {
                                    severity => 'error',
                                    message => "Invalid configuration: $err",
                                };
                        }
                    }
                }
            }

            push @$res, $entry;
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'get',
    protected => 1,
    path => '{id}',
    method => 'GET',
    description => "Get PCI Mapping.",
    permissions => {
        check => [
            'or',
            ['perm', '/mapping/pci/{id}', ['Mapping.Use']],
            ['perm', '/mapping/pci/{id}', ['Mapping.Modify']],
            ['perm', '/mapping/pci/{id}', ['Mapping.Audit']],
        ],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            id => {
                type => 'string',
                format => 'pve-configid',
            },
        },
    },
    returns => { type => 'object' },
    code => sub {
        my ($param) = @_;

        my $cfg = PVE::Mapping::PCI::config();
        my $id = $param->{id};

        my $entry = $cfg->{ids}->{$id};
        die "mapping '$param->{id}' not found\n" if !defined($entry);

        my $data = dclone($entry);

        $data->{digest} = $cfg->{digest};

        return $data;
    },
});

__PACKAGE__->register_method({
    name => 'create',
    protected => 1,
    path => '',
    method => 'POST',
    description => "Create a new hardware mapping.",
    permissions => {
        check => ['perm', '/mapping/pci', ['Mapping.Modify']],
    },
    parameters => PVE::Mapping::PCI->createSchema(1),
    returns => {
        type => 'null',
    },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');

        my $plugin = PVE::Mapping::PCI->lookup('pci');
        my $opts = $plugin->check_config($id, $param, 1, 1);

        PVE::Mapping::PCI::lock_pci_config(
            sub {
                my $cfg = PVE::Mapping::PCI::config();

                die "pci ID '$id' already defined\n" if defined($cfg->{ids}->{$id});

                $cfg->{ids}->{$id} = $opts;

                PVE::Mapping::PCI::write_pci_config($cfg);

            },
            "create hardware mapping failed",
        );

        return;
    },
});

__PACKAGE__->register_method({
    name => 'update',
    protected => 1,
    path => '{id}',
    method => 'PUT',
    description => "Update a hardware mapping.",
    permissions => {
        check => ['perm', '/mapping/pci/{id}', ['Mapping.Modify']],
    },
    parameters => PVE::Mapping::PCI->updateSchema(),
    returns => {
        type => 'null',
    },
    code => sub {
        my ($param) = @_;

        my $digest = extract_param($param, 'digest');
        my $delete = extract_param($param, 'delete');
        my $id = extract_param($param, 'id');

        if ($delete) {
            $delete = [PVE::Tools::split_list($delete)];
        }

        PVE::Mapping::PCI::lock_pci_config(
            sub {
                my $cfg = PVE::Mapping::PCI::config();

                PVE::Tools::assert_if_modified($cfg->{digest}, $digest) if defined($digest);

                die "pci ID '$id' does not exist\n" if !defined($cfg->{ids}->{$id});

                my $plugin = PVE::Mapping::PCI->lookup('pci');
                my $opts = $plugin->check_config($id, $param, 1, 1);

                my $data = $cfg->{ids}->{$id};

                my $options = $plugin->private()->{options}->{pci};
                PVE::SectionConfig::delete_from_config($data, $options, $opts, $delete);

                $data->{$_} = $opts->{$_} for keys $opts->%*;

                PVE::Mapping::PCI::write_pci_config($cfg);

            },
            "update hardware mapping failed",
        );

        return;
    },
});

__PACKAGE__->register_method({
    name => 'delete',
    protected => 1,
    path => '{id}',
    method => 'DELETE',
    description => "Remove Hardware Mapping.",
    permissions => {
        check => ['perm', '/mapping/pci', ['Mapping.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            id => {
                type => 'string',
                format => 'pve-configid',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $id = $param->{id};

        PVE::Mapping::PCI::lock_pci_config(
            sub {
                my $cfg = PVE::Mapping::PCI::config();

                if ($cfg->{ids}->{$id}) {
                    delete $cfg->{ids}->{$id};
                }

                PVE::Mapping::PCI::write_pci_config($cfg);

            },
            "delete pci mapping failed",
        );

        return;
    },
});

1;
