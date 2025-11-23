package PVE::API2::Cluster::Mapping::USB;

use strict;
use warnings;

use Storable qw(dclone);

use PVE::Mapping::USB ();
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
    description => "List USB Hardware Mappings",
    permissions => {
        description => "Only lists entries where you have 'Mapping.Modify', 'Mapping.Use' or"
            . " 'Mapping.Audit' permissions on '/mapping/usb/<id>'.",
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            'check-node' => get_standard_option(
                'pve-node',
                {
                    description => "If given, checks the configurations on the given node for "
                        . "correctness, and adds relevant errors to the devices.",
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
                error => {
                    description => "A list of errors when 'check_node' is given.",
                    items => {
                        type => 'object',
                        properties => {
                            severity => {
                                type => "string",
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
        my $node = $param->{'check-node'};

        die "Wrong node to check\n"
            if defined($node) && $node ne 'localhost' && $node ne PVE::INotify::nodename();

        my $cfg = PVE::Mapping::USB::config();

        my $res = [];

        my $privs = ['Mapping.Modify', 'Mapping.Use', 'Mapping.Audit'];

        for my $id (keys $cfg->{ids}->%*) {
            next if !$rpcenv->check_full($authuser, "/mapping/usb/$id", $privs, 1, 1);
            next if !$cfg->{ids}->{$id};

            my $entry = dclone($cfg->{ids}->{$id});
            $entry->{id} = $id;
            $entry->{digest} = $cfg->{digest};

            if (defined($node)) {
                $entry->{errors} = [];
                if (my $mappings = PVE::Mapping::USB::get_node_mapping($cfg, $id, $node)) {
                    if (!scalar($mappings->@*)) {
                        push $entry->{errors}->@*,
                            {
                                severity => 'warning',
                                message => "No mapping for node $node.",
                            };
                    }
                    for my $mapping ($mappings->@*) {
                        eval { PVE::Mapping::USB::assert_valid($id, $mapping); };
                        if (my $err = $@) {
                            push $entry->{errors}->@*,
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
    description => "Get USB Mapping.",
    permissions => {
        check => [
            'or',
            ['perm', '/mapping/usb/{id}', ['Mapping.Audit']],
            ['perm', '/mapping/usb/{id}', ['Mapping.Use']],
            ['perm', '/mapping/usb/{id}', ['Mapping.Modify']],
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

        my $cfg = PVE::Mapping::USB::config();
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
        check => ['perm', '/mapping/usb', ['Mapping.Modify']],
    },
    parameters => PVE::Mapping::USB->createSchema(1),
    returns => {
        type => 'null',
    },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');

        my $plugin = PVE::Mapping::USB->lookup('usb');
        my $opts = $plugin->check_config($id, $param, 1, 1);

        PVE::Mapping::USB::lock_usb_config(
            sub {
                my $cfg = PVE::Mapping::USB::config();

                die "usb ID '$id' already defined\n" if defined($cfg->{ids}->{$id});

                $cfg->{ids}->{$id} = $opts;

                PVE::Mapping::USB::write_usb_config($cfg);

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
        check => ['perm', '/mapping/usb/{id}', ['Mapping.Modify']],
    },
    parameters => PVE::Mapping::USB->updateSchema(),
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

        PVE::Mapping::USB::lock_usb_config(
            sub {
                my $cfg = PVE::Mapping::USB::config();

                PVE::Tools::assert_if_modified($cfg->{digest}, $digest) if defined($digest);

                die "usb ID '$id' does not exist\n" if !defined($cfg->{ids}->{$id});

                my $plugin = PVE::Mapping::USB->lookup('usb');
                my $opts = $plugin->check_config($id, $param, 1, 1);

                my $data = $cfg->{ids}->{$id};

                my $options = $plugin->private()->{options}->{usb};
                PVE::SectionConfig::delete_from_config($data, $options, $opts, $delete);

                $data->{$_} = $opts->{$_} for keys $opts->%*;

                PVE::Mapping::USB::write_usb_config($cfg);

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
        check => ['perm', '/mapping/usb', ['Mapping.Modify']],
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

        PVE::Mapping::USB::lock_usb_config(
            sub {
                my $cfg = PVE::Mapping::USB::config();

                if ($cfg->{ids}->{$id}) {
                    delete $cfg->{ids}->{$id};
                }

                PVE::Mapping::USB::write_usb_config($cfg);

            },
            "delete usb mapping failed",
        );

        return;
    },
});

1;
