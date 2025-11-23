package PVE::AutoBalloon;

use warnings;
use strict;

sub compute_alg1 {
    my ($vmstatus, $goal, $maxchange, $debug) = @_;

    my $log = sub { print @_ if $debug; };

    my $change_func = sub {
        my ($res, $idlist, $bytes) = @_;

        my $rest = $bytes;
        my $repeat = 1;
        my $done_hash = {};
        my $progress = 1;

        while ($rest && $repeat && $progress) {
            $repeat = 0;
            $progress = 0;

            my $shares_total = 0;
            my $alloc_old = 0;

            foreach my $vmid (@$idlist) {
                next if defined($done_hash->{$vmid});
                my $d = $vmstatus->{$vmid};
                my $balloon = defined($res->{$vmid}) ? $res->{$vmid} : $d->{balloon};
                $alloc_old += $balloon - $d->{balloon_min};
                $shares_total += $d->{shares} || 1000;
            }

            my $changes = 0;

            my $alloc_new = $alloc_old + $rest;

            &$log("shares_total: $shares_total $alloc_new\n");

            foreach my $vmid (@$idlist) {
                next if defined($done_hash->{$vmid});
                my $d = $vmstatus->{$vmid};
                my $shares = $d->{shares} || 1000;
                my $desired = $d->{balloon_min} + int(($alloc_new / $shares_total) * $shares);

                if ($desired > $d->{maxmem}) {
                    $desired = $d->{maxmem};
                    $repeat = 1;
                } elsif ($desired < $d->{balloon_min}) {
                    $desired = $d->{balloon_min};
                    $repeat = 1;
                }

                my ($new, $balloon);
                if (($bytes > 0) && ($desired - $d->{balloon}) > 0) { # grow
                    $new = $d->{balloon} + $maxchange;
                    $balloon = $new > $desired ? $desired : $new;
                } elsif (($desired - $d->{balloon}) < 0) { # shrink
                    $new = $d->{balloon} - $maxchange;
                    $balloon = $new > $desired ? $new : $desired;
                } else {
                    $done_hash->{$vmid} = 1;
                    next;
                }

                my $diff = $balloon - $d->{balloon};
                if ($diff != 0) {
                    my $oldballoon = defined($res->{$vmid}) ? $res->{$vmid} : $d->{balloon};
                    $res->{$vmid} = $balloon;
                    my $change = $balloon - $oldballoon;
                    if ($change != 0) {
                        $changes += $change;
                        my $absdiff = $diff > 0 ? $diff : -$diff;
                        $progress += $absdiff;
                        $repeat = 1;
                    }
                    &$log(
                        "change request for $vmid ($balloon, $diff, $desired, $new, $changes, $progress)\n"
                    );
                }
            }

            $rest -= $changes;
        }

        return $rest;
    };

    my $idlist = []; # list of VMs with working balloon river
    my $idlist1 = []; # list of VMs with memory pressure
    my $idlist2 = []; # list of VMs with enough free memory

    foreach my $vmid (keys %$vmstatus) {
        my $d = $vmstatus->{$vmid};
        next if !$d->{balloon}; # skip if balloon driver not running
        next if !$d->{balloon_min}; # skip if balloon value not set in config
        next if $d->{lock} && $d->{lock} eq 'migrate';
        next
            if defined($d->{shares})
            && ($d->{shares} == 0); # skip if shares set to zero

        push @$idlist, $vmid;

        if (
            $d->{freemem}
            && ($d->{freemem} > $d->{balloon_min} * 0.25)
            && ($d->{balloon} >= $d->{balloon_min})
        ) {
            push @$idlist2, $vmid;
            &$log("idlist2 $vmid $d->{balloon}, $d->{balloon_min}, $d->{freemem}\n");
        } else {
            push @$idlist1, $vmid;
            &$log("idlist1 $vmid $d->{balloon}, $d->{balloon_min}\n");
        }
    }

    my $res = {};

    if ($goal > 10 * 1024 * 1024) {
        &$log("grow request start $goal\n");
        # prioritize VMs with memory pressure
        my $rest = &$change_func($res, $idlist1, $goal);
        if ($rest >= $goal) { # no progress ==> consider all VMs
            &$log("grow request loop $rest\n");
            $rest = &$change_func($res, $idlist, $rest);
        }
        &$log("grow request end $rest\n");

    } elsif ($goal < -10 * 1024 * 1024) {
        &$log("shrink request $goal\n");
        # prioritize VMs with enough free memory
        my $rest = &$change_func($res, $idlist2, $goal);
        if ($rest <= $goal) { # no progress ==> consider all VMs
            &$log("shrink request loop $rest\n");
            $rest = &$change_func($res, $idlist, $rest);
        }
        &$log("shrink request end $rest\n");
    } else {
        &$log("do nothing\n");
        # do nothing - requested change to small
    }

    foreach my $vmid (@$idlist) {
        next if !$res->{$vmid};
        my $d = $vmstatus->{$vmid};
        my $diff = int($res->{$vmid} - $d->{balloon});
        my $absdiff = $diff < 0 ? -$diff : $diff;
        &$log("BALLOON $vmid to $res->{$vmid} ($diff)\n");
    }
    return $res;
}

1;
