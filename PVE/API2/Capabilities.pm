package PVE::API2::Capabilities;

use strict;
use warnings;

use PVE::JSONSchema qw(get_standard_option);
use PVE::RESTHandler;

use PVE::API2::Qemu::CPU;
use PVE::API2::Qemu::CPUFlags;
use PVE::API2::Qemu::Machine;
use PVE::API2::NodeCapabilities::Qemu::Migration;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    subclass => "PVE::API2::Qemu::CPU",
    path => 'qemu/cpu',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Qemu::CPUFlags",
    path => 'qemu/cpu-flags',
});

__PACKAGE__->register_method({
    subclass => "PVE::API2::Qemu::Machine",
    path => 'qemu/machines',
});

__PACKAGE__->register_method({
    subclass => 'PVE::API2::NodeCapabilities::Qemu::Migration',
    path => 'qemu/migration',
});

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    permissions => { user => 'all' },
    proxyto => 'node',
    description => "Node capabilities index.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {},
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        my $result = [
            { name => 'qemu' },
        ];

        return $result;
    },
});

__PACKAGE__->register_method({
    name => 'qemu_caps_index',
    path => 'qemu',
    method => 'GET',
    permissions => { user => 'all' },
    proxyto => 'node',
    description => "QEMU capabilities index.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {},
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        my $result = [
            { name => 'cpu' }, { name => 'machines' }, { name => 'migration' },
        ];

        return $result;
    },
});

1;
