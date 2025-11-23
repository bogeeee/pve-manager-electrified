#!/usr/bin/perl

use lib '../../';
use strict;
use warnings;
use Time::HiRes qw( usleep ualarm gettimeofday tv_interval );
use PVE::INotify;
use PVE::AccessControl;
use Net::SSLeay qw(get_https post_https sslcat make_headers make_form);

use Data::Dumper;

my $hostname = PVE::INotify::read_file("hostname");

# normally you use username/password,
# but we can simply create a ticket if we are root
my $ticket = PVE::AccessControl::assemble_ticket('root@pam');

my $wcount = 10;
my $qcount = 100;

sub test_rpc {
    my ($host) = @_;

    for (my $i = 0; $i < $qcount; $i++) {
        eval {
            my ($page, $response, %reply_headers) = get_https(
                $host,
                8006,
                '/api2/json',
                make_headers(Cookie => "PVEAuthCookie=$ticket"),
            );
            die "$response\n" if $response !~ m/200 OK/;
        };

        my $err = $@;

        if ($err) {

            print "ERROR: $err\n";
            last;
        }
    }
}

sub run_tests {
    my ($host) = @_;

    my $workers;

    my $starttime = [gettimeofday];

    for (my $i = 0; $i < $wcount; $i++) {
        if (my $pid = fork()) {
            $workers->{$pid} = 1;
        } else {
            test_rpc($host);
            exit(0);
        }
    }

    # wait for children
    1 while (wait > 0);

    my $elapsed = int(tv_interval($starttime) * 1000);

    my $tpq = $elapsed / ($wcount * $qcount);

    print "$host: $tpq ms per query\n";
}

run_tests($hostname); # test 'pveproxy'
