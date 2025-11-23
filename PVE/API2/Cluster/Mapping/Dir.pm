package PVE::API2::Cluster::Mapping::Dir;

use strict;
use warnings;

use Storable qw(dclone);

use PVE::INotify;
use PVE::JSONSchema qw(get_standard_option);
use PVE::Mapping::Dir ();
use PVE::RPCEnvironment;
use PVE::SectionConfig;
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
    description => "List directory mapping",
    permissions => {
        description => "Only lists entries where you have 'Mapping.Modify', 'Mapping.Use' or"
            . " 'Mapping.Audit' permissions on '/mapping/dir/<id>'.",
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            'check-node' => get_standard_option(
                'pve-node',
                {
                    description => "If given, checks the configurations on the given node for"
                        . " correctness, and adds relevant diagnostics for the directory to the response.",
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
                    description => "A list of checks, only present if 'check-node' is set.",
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

        my $cfg = PVE::Mapping::Dir::config();

        my $can_see_mapping_privs = ['Mapping.Modify', 'Mapping.Use', 'Mapping.Audit'];

        my $res = [];
        for my $id (keys $cfg->{ids}->%*) {
            next
                if !$rpcenv->check_any($authuser, "/mapping/dir/$id", $can_see_mapping_privs, 1);
            next if !$cfg->{ids}->{$id};

            my $entry = dclone($cfg->{ids}->{$id});
            $entry->{id} = $id;
            $entry->{digest} = $cfg->{digest};

            if (defined($check_node)) {
                $entry->{checks} = [];
                if (
                    my $mappings = PVE::Mapping::Dir::get_node_mapping($cfg, $id, $check_node)
                ) {
                    if (!scalar($mappings->@*)) {
                        push $entry->{checks}->@*,
                            {
                                severity => 'warning',
                                message => "No mapping for node $check_node.",
                            };
                    }
                    for my $mapping ($mappings->@*) {
                        eval { PVE::Mapping::Dir::assert_valid($mapping) };
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
    description => "Get directory mapping.",
    permissions => {
        check => [
            'or',
            ['perm', '/mapping/dir/{id}', ['Mapping.Use']],
            ['perm', '/mapping/dir/{id}', ['Mapping.Modify']],
            ['perm', '/mapping/dir/{id}', ['Mapping.Audit']],
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

        my $cfg = PVE::Mapping::Dir::config();
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
    description => "Create a new directory mapping.",
    permissions => {
        check => ['perm', '/mapping/dir', ['Mapping.Modify']],
    },
    parameters => PVE::Mapping::Dir->createSchema(1),
    returns => {
        type => 'null',
    },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');

        my $plugin = PVE::Mapping::Dir->lookup('dir');
        my $opts = $plugin->check_config($id, $param, 1, 1);

        my $map_list = $opts->{map};
        PVE::Mapping::Dir::assert_valid_map_list($map_list);

        PVE::Mapping::Dir::lock_dir_config(
            sub {
                my $cfg = PVE::Mapping::Dir::config();

                die "dir ID '$id' already defined\n" if defined($cfg->{ids}->{$id});

                $cfg->{ids}->{$id} = $opts;

                PVE::Mapping::Dir::write_dir_config($cfg);

            },
            "create directory mapping failed",
        );

        return;
    },
});

__PACKAGE__->register_method({
    name => 'update',
    protected => 1,
    path => '{id}',
    method => 'PUT',
    description => "Update a directory mapping.",
    permissions => {
        check => ['perm', '/mapping/dir/{id}', ['Mapping.Modify']],
    },
    parameters => PVE::Mapping::Dir->updateSchema(),
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

        PVE::Mapping::Dir::lock_dir_config(
            sub {
                my $cfg = PVE::Mapping::Dir::config();

                PVE::Tools::assert_if_modified($cfg->{digest}, $digest) if defined($digest);

                die "dir ID '$id' does not exist\n" if !defined($cfg->{ids}->{$id});

                my $plugin = PVE::Mapping::Dir->lookup('dir');
                my $opts = $plugin->check_config($id, $param, 1, 1);

                my $map_list = $opts->{map};
                PVE::Mapping::Dir::assert_valid_map_list($map_list);

                my $data = $cfg->{ids}->{$id};

                my $options = $plugin->private()->{options}->{dir};
                PVE::SectionConfig::delete_from_config($data, $options, $opts, $delete);

                $data->{$_} = $opts->{$_} for keys $opts->%*;

                PVE::Mapping::Dir::write_dir_config($cfg);

            },
            "update directory mapping failed",
        );

        return;
    },
});

__PACKAGE__->register_method({
    name => 'delete',
    protected => 1,
    path => '{id}',
    method => 'DELETE',
    description => "Remove directory mapping.",
    permissions => {
        check => ['perm', '/mapping/dir', ['Mapping.Modify']],
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

        PVE::Mapping::Dir::lock_dir_config(
            sub {
                my $cfg = PVE::Mapping::Dir::config();

                if ($cfg->{ids}->{$id}) {
                    delete $cfg->{ids}->{$id};
                }

                PVE::Mapping::Dir::write_dir_config($cfg);

            },
            "delete dir mapping failed",
        );

        return;
    },
});

1;
