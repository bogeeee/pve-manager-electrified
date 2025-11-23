#!/usr/bin/perl -w

use strict;
use warnings;

use PVE::APLInfo;
use Data::Dumper;

my $pkglist = PVE::APLInfo::load_data();

my $err = 0;

foreach my $k (keys %{ $pkglist->{'all'} }) {
    next if $k eq 'pve-web-news';
    my $res = $pkglist->{all}->{$k};

    # heuristic only..
    my $template = "$res->{package}_$res->{version}_$res->{architecture}.tar";

    if ($k !~ m/^($res->{os}-)?\Q$template\E\.(gz|xz|zst)$/) {
        print "ERROR: $k != $template\n";
        #print Dumper($res) . "\n";
        $err = 1;
    }
}

$err ? exit(-11) : exit(0);

