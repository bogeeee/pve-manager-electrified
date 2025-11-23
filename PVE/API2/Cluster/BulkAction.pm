package PVE::API2::Cluster::BulkAction;

use strict;
use warnings;

use PVE::API2::Cluster::BulkAction::Guest;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    subclass => "PVE::API2::Cluster::BulkAction::Guest",
    path => 'guest',
});

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "List resource types.",
    permissions => {
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        my $result = [
            { name => 'guest' },
        ];

        return $result;
    },
});

1;
