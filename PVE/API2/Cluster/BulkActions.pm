package PVE::API2::Cluster::BulkActions;

use warnings;
use strict;

use Storable qw(dclone);
use JSON;

use PVE::Exception qw(raise_param_exc);
use PVE::Tools qw(extract_param);
use PVE::JSONSchema qw(get_standard_option);
use PVE::RESTHandler;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => 'Index for cluster-wide bulk-action API endpoints.',
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => 'object',
            properties => {},
        },
        links => [{ rel => 'child', href => '{name}' }],
    },
    code => sub {
        my $result = [
            { name => 'migrate' }, { name => 'start' }, { name => 'stop' },
        ];

        return $result;
    },
});

my $guest_format = {
    vmid => {defau},
};

__PACKAGE__->register_method({
    name => 'migrate',
    path => 'migrate',
    method => 'POST',
    description => 'Returns a list of all entities that can be used as notification targets'
        . ' (endpoints and groups).',
    permissions => {
        description =>
            "The 'VM.Migrate' permission is required on '/' or on '/vms/<ID>' for each "
            . "ID passed via the 'vms' parameter.",
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            'guests' => {
                type => 'array',
                description => '',
                items => {
                    type => 'string',
                    format => $guest_format,
                },
            },
        },
    },
    returns => {
        type => 'string',
        items => {
            type => 'object',
            properties => {
                name => {
                    description => 'Name of the endpoint/group.',
                    type => 'string',
                    format => 'pve-configid',
                },
                'type' => {
                    description => 'Type of the endpoint or group.',
                    type => 'string',
                    enum => [qw(sendmail gotify group)],
                },
                'comment' => {
                    description => 'Comment',
                    type => 'string',
                    optional => 1,
                },
            },
        },
        links => [{ rel => 'child', href => '{name}' }],
    },
    code => sub {
        my $config = PVE::Notify::read_config();
        my $rpcenv = PVE::RPCEnvironment::get();

        my $targets = eval {
            my $result = [];

            for my $target (@{ $config->get_sendmail_endpoints() }) {
                push @$result,
                    {
                        name => $target->{name},
                        comment => $target->{comment},
                        type => 'sendmail',
                    };
            }

            for my $target (@{ $config->get_gotify_endpoints() }) {
                push @$result,
                    {
                        name => $target->{name},
                        comment => $target->{comment},
                        type => 'gotify',
                    };
            }

            for my $target (@{ $config->get_groups() }) {
                push @$result,
                    {
                        name => $target->{name},
                        comment => $target->{comment},
                        type => 'group',
                    };
            }

            $result;
        };

        raise_api_error($@) if $@;

        return filter_entities_by_privs($rpcenv, $targets);
    },
});

1;
