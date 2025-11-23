package PVE::API2::Hardware::USB;

use strict;
use warnings;

use PVE::JSONSchema qw(get_standard_option);

use PVE::SysFSTools;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'usbscan',
    path => '',
    method => 'GET',
    description => "List local USB devices.",
    protected => 1,
    proxyto => "node",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
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
            properties => {
                busnum => { type => 'integer' },
                class => { type => 'integer' },
                devnum => { type => 'integer' },
                level => { type => 'integer' },
                manufacturer => { type => 'string', optional => 1 },
                port => { type => 'integer' },
                prodid => { type => 'string' },
                product => { type => 'string', optional => 1 },
                serial => { type => 'string', optional => 1 },
                speed => { type => 'string' },
                usbpath => { type => 'string', optional => 1 },
                vendid => { type => 'string' },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        return PVE::SysFSTools::scan_usb();
    },
});
