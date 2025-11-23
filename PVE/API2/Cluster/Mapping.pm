package PVE::API2::Cluster::Mapping;

use strict;
use warnings;

use PVE::API2::Cluster::Mapping::Dir;
use PVE::API2::Cluster::Mapping::PCI;
use PVE::API2::Cluster::Mapping::USB;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    subclass => "PVE::API2::Cluster::Mapping::Dir",
    path => 'dir',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Cluster::Mapping::PCI",
    path => 'pci',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Cluster::Mapping::USB",
    path => 'usb',
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
            { name => 'dir' }, { name => 'pci' }, { name => 'usb' },
        ];

        return $result;
    },
});

1;
