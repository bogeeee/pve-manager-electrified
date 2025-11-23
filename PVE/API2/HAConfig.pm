package PVE::API2::HAConfig;

use strict;
use warnings;

use PVE::SafeSyslog;
use PVE::Tools;
use PVE::Cluster qw(cfs_lock_file cfs_read_file cfs_write_file);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::JSONSchema qw(get_standard_option);
use PVE::Exception qw(raise_param_exc);
use PVE::API2::HA::Resources;
use PVE::API2::HA::Groups;
use PVE::API2::HA::Rules;
use PVE::API2::HA::Status;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    subclass => "PVE::API2::HA::Resources",
    path => 'resources',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::HA::Groups",
    path => 'groups',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::HA::Rules",
    path => 'rules',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::HA::Status",
    path => 'status',
});

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Directory index.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                id => { type => 'string' },
            },
        },
        links => [{ rel => 'child', href => "{id}" }],
    },
    code => sub {
        my ($param) = @_;

        my $res = [
            { id => 'status' }, { id => 'resources' }, { id => 'groups' }, { id => 'rules' },
        ];

        return $res;
    },
});

1;
