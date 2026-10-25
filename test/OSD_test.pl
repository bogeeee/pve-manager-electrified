#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use JSON;
use Test::More;
use PVE::API2::Ceph::OSD;

use Data::Dumper;

# NOTE: not exhaustive, reduced to actually required fields!
my $tree = {
    nodes => [
        {
            id => -3,
            name => 'pveA',
            children => [0, 1, 2, 3],
            type => 'host',
        },
        {
            id => -5,
            name => 'pveB',
            children => [4, 5, 6, 7],
            type => 'host',
        },
        {
            id => -7,
            name => 'pveC',
            children => [8, 9, 10, 11],
            type => 'host',
        },
    ],
};

# Check if all the grep and casts are correct
my @belong_to_B = (4, 5);
my @not_belong_to_B = (-1, 1, 10, 15);
foreach (@belong_to_B) {
    is(
        PVE::API2::Ceph::OSD::osd_belongs_to_node($tree, 'pveB', $_),
        1,
        "OSD $_ belongs to node pveB",
    );
}
foreach (@not_belong_to_B) {
    is(
        PVE::API2::Ceph::OSD::osd_belongs_to_node($tree, 'pveB', $_),
        0,
        "OSD $_ does not belong to node pveB",
    );
}

my $double_nodes_tree = {
    nodes => [
        {
            name => 'pveA',
            type => 'host',
        },
        {
            name => 'pveA',
            type => 'host',
        },
    ],
};
eval { PVE::API2::Ceph::OSD::osd_belongs_to_node($double_nodes_tree, 'pveA') };
like($@, qr/duplicate host name found/, "Die if node occurs too often");

is(
    PVE::API2::Ceph::OSD::osd_belongs_to_node(undef),
    0,
    "Early-return false if there's no/empty node tree",
);

# Destroying an OSD has to leave nothing of it behind on the monitors.

{

    package FakeRados;

    sub new {
        my ($class) = @_;
        return bless { commands => [] }, $class;
    }

    sub mon_command {
        my ($self, $cmd) = @_;
        push $self->{commands}->@*, $cmd;
        return {};
    }
}

my $rados = FakeRados->new();
{
    my $out = '';
    open(my $stdout, '>', \$out) or die $!;
    local *STDOUT = $stdout;
    # the API hands over the OSD ID as a string
    PVE::API2::Ceph::OSD::remove_osd_from_monitors($rados, '7');
}

my $commands = $rados->{commands};

# The monitors look up the OSD's UUID in the OSD map to find its lockbox entity and its
# dm-crypt key, so the destroy has to come before the 'osd rm'.
is_deeply(
    [map { $_->{prefix} } @$commands],
    ['osd crush remove', 'auth del', 'osd destroy-actual', 'osd rm', 'config rm', 'config rm'],
    'the monitors drop the CRUSH entry, the keys and the OSD itself, in that order',
);

my ($destroy) = grep { $_->{prefix} eq 'osd destroy-actual' } @$commands;
like(encode_json($destroy), qr/"id":7[,}]/, "'osd destroy-actual' names the OSD as an integer");
ok($destroy->{yes_i_really_mean_it}, 'and confirms, as the monitors refuse it otherwise');

done_testing();
