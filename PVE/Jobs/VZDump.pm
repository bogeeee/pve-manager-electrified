package PVE::Jobs::VZDump;

use strict;
use warnings;

use PVE::JSONSchema;

use PVE::VZDump::Common;

use PVE::API2::VZDump;

use base qw(PVE::VZDump::JobBase);

sub run {
    my ($class, $conf, $job_id) = @_;

    my $props = $class->properties();
    # remove all non vzdump related options
    foreach my $opt (keys %$conf) {
        delete $conf->{$opt} if !defined($props->{$opt});
    }

    $conf->{'job-id'} = $job_id;

    # Required as string parameters # FIXME why?! we could just check ref()
    for my $key (keys $PVE::VZDump::Common::PROPERTY_STRINGS->%*) {
        if ($conf->{$key} && ref($conf->{$key}) eq 'HASH') {
            my $format = $PVE::VZDump::Common::PROPERTY_STRINGS->{$key};
            $conf->{$key} = PVE::JSONSchema::print_property_string($conf->{$key}, $format);
        }
    }

    $conf->{quiet} = 1; # do not write to stdout/stderr

    return PVE::API2::VZDump->vzdump($conf);
}

1;
