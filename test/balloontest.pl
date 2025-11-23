#!/usr/bin/perl -w

use lib qw(../../);
use strict;
use Storable qw(dclone);
use Data::Dumper;
use PVE::AutoBalloon;

my $debug = 0;

my $test_status1 = {
    100 => {
        maxmem => GB(2),
        shares => 2000,
        balloon => GB(1),
        balloon_min => GB(1),
        freemem => MB(0),
    },
    101 => {
        maxmem => GB(2),
        shares => 1000,
        balloon => GB(1),
        balloon_min => GB(1),
        freemem => MB(0),
    },
};

abtest($test_status1, 0);
abtest($test_status1, MB(90), 100 => MB(1060), 101 => MB(1030));
abtest($test_status1, MB(150), 100 => MB(1100), 101 => MB(1050));
abtest($test_status1, MB(270), 100 => MB(1100), 101 => MB(1090));
absim($test_status1, MB(180), 100 => MB(1120), 101 => MB(1060));
absim($test_status1, MB(270), 100 => MB(1180), 101 => MB(1090));
absim($test_status1, MB(600), 100 => MB(1300), 101 => MB(1300));
absim($test_status1, MB(900), 100 => MB(1600), 101 => MB(1300));

my $test_status2 = {
    100 => {
        maxmem => GB(2),
        shares => 2000,
        balloon => GB(2),
        balloon_min => GB(2),
        freemem => MB(0),
    },
    101 => {
        maxmem => GB(2),
        shares => 1000,
        balloon => GB(1),
        balloon_min => GB(1),
        freemem => MB(0),
    },
};

abtest($test_status2, 0);
abtest($test_status2, MB(18), 101 => MB(1018));
abtest($test_status2, MB(500), 101 => MB(1100));

my $test_status3 = {
    100 => {
        maxmem => GB(2),
        shares => 2000,
        balloon => GB(2),
        balloon_min => GB(2),
        freemem => MB(0),
    },
    101 => {
        maxmem => GB(2),
        shares => 1000,
        balloon => GB(1) + MB(7),
        balloon_min => GB(1),
        freemem => MB(0),
    },
    102 => {
        maxmem => GB(2),
        shares => 1000,
        balloon => GB(1),
        balloon_min => GB(1),
        freemem => MB(512),
    },
};

abtest($test_status3, 0);
abtest($test_status3, MB(11), 101 => MB(1018));
abtest($test_status3, MB(80), 101 => MB(1087));
abtest($test_status3, MB(200), 101 => MB(1107));

my $status = absim($test_status3, MB(593), 101 => MB(1300), 102 => MB(1300));
absim($status, -MB(200), 101 => MB(1200), 102 => MB(1200));
absim($status, -MB(400), 101 => MB(1200), 102 => GB(1));
absim($status, -MB(593), 101 => MB(1007), 102 => GB(1));
exit(0);

sub abapply {
    my ($vmstatus, $res, $sum) = @_;

    my $changes = 0;
    my $abschanges = 0;
    foreach my $vmid (keys %$res) {
        my $diff = $res->{$vmid} - $vmstatus->{$vmid}->{balloon};
        if ($diff != 0) {
            # fixme: adjust freemem ?
            $vmstatus->{$vmid}->{freemem} += $diff;
            $vmstatus->{$vmid}->{freemem} = 0 if $vmstatus->{$vmid}->{freemem} < 0;
            $vmstatus->{$vmid}->{balloon} = $res->{$vmid};
            $sum->{$vmid} = $res->{$vmid};
            $changes += $diff;
            $abschanges += $diff > 0 ? $diff : -$diff;
        }
    }

    return ($changes, $abschanges);
}

my $tcount = 0;

sub absim {
    my ($vmstatus, $goal, %expect) = @_;

    $tcount++;

    print "BALLOON SIM $tcount\n" if $debug;

    $vmstatus = dclone($vmstatus); # do not change original

    my $changes = 0;
    my $abschanges = 0;
    my $sum = {};
    do {
        my $res = PVE::AutoBalloon::compute_alg1($vmstatus, $goal, MB(100), $debug);
        print Dumper($res) if $debug;
        ($changes, $abschanges) = abapply($vmstatus, $res, $sum);
        $goal -= $changes;
    } while ($abschanges);

    abcheck($sum, %expect);

    print "BALLOON SIM END\n" if $debug;
    print Dumper($vmstatus) if $debug;

    return $vmstatus;
}

sub abcheck {
    my ($res, %expect) = @_;

    foreach my $vmid (keys %expect) {
        my $ev = $expect{$vmid};
        if (defined($res->{$vmid})) {
            die "T$tcount: wrong value for VM $vmid ($ev != $res->{$vmid})\n"
                if $ev != $res->{$vmid};
        } else {
            die "T$tcount: missing value for VM $vmid (extected $ev)\n";
        }
    }

    foreach my $vmid (keys %$res) {
        die "T$tcount: got unexpected result for $vmid\n"
            if (defined($res->{$vmid})
                && !defined($expect{$vmid}));
    }
}

sub abtest {
    my ($vmstatus, $goal, %expect) = @_;

    $tcount++;

    print "BALLOON TEST $tcount\n" if $debug;
    my $res = PVE::AutoBalloon::compute_alg1($vmstatus, $goal, MB(100), $debug);
    print Dumper($res) if $debug;

    abcheck($res, %expect);

    print "\n\n" if $debug;

    return $res;
}

sub MB {
    my $mb = shift;
    return $mb * 1000 * 1000;
}

sub GB {
    my $gb = shift;
    return $gb * 1000 * 1000 * 1000;
}
