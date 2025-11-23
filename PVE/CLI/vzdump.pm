package PVE::CLI::vzdump;

use strict;
use warnings;

use PVE::RPCEnvironment;
use PVE::CLIHandler;
use PVE::API2::VZDump;

use base qw(PVE::CLIHandler);

sub setup_environment {
    PVE::RPCEnvironment->setup_default_cli_env();
}

# Note: use string 'vmid' as $arg_param option, to allow vmid lists
our $cmddef = [
    'PVE::API2::VZDump',
    'vzdump',
    'vmid',
    undef,
    sub {
        my $upid = shift;
        exit(0) if $upid eq 'OK';
        my $status = PVE::Tools::upid_read_status($upid);
        exit(PVE::Tools::upid_status_is_error($status) ? -1 : 0);
    },
];

1;
