#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use JSON;
use Test::More;
use PVE::Ceph::Services;

# Only the fields the classifier reads; 'muted' as the JSON boolean ceph actually sends, which
# is false but defined and so relies on the overloaded numification rather than on undef.
sub check {
    my ($severity, $message, $muted) = @_;

    return {
        severity => $severity,
        summary => { message => $message },
        muted => $muted ? JSON::true : JSON::false,
    };
}

# Stands in for PVE::RADOS. The classifier asks for the OSD flags, the entry gate and the
# between-steps check also ask for the health report itself.
{

    package FakeRados;

    sub new {
        my ($class, $flags, $health) = @_;
        return bless { flags => $flags // '', health => $health }, $class;
    }

    sub mon_command {
        my ($self, $cmd) = @_;
        return { flags => $self->{flags} } if $cmd->{prefix} eq 'osd dump';
        return $self->{health} if $cmd->{prefix} eq 'health';
        die "unexpected mon command '$cmd->{prefix}'\n";
    }
}

# The checks a cluster upgraded to ceph 19.2.6 or 20.2.4 raises until its keys are migrated.
# Two of them are HEALTH_ERR, which is what makes the severity handling worth pinning.
my $cephx = {
    AUTH_INSECURE_CLIENT_KEY_TYPE => check('HEALTH_WARN', '8 auth client entities'),
    AUTH_INSECURE_KEYS_ALLOWED => check('HEALTH_WARN', 'insecure key types allowed'),
    AUTH_INSECURE_KEYS_CREATABLE => check('HEALTH_WARN', 'insecure key types creatable'),
    AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE => check('HEALTH_WARN', '4 rotating keys'),
    AUTH_INSECURE_SERVICE_KEY_TYPE => check('HEALTH_ERR', '16 auth service entities'),
    AUTH_INSECURE_SERVICE_TICKETS => check('HEALTH_ERR', 'insecure service tickets'),
};

# 'expected' is the worst blocking severity, undef when nothing blocks. 'errors' is what the
# between-steps re-check aborts on. 'acceptable'/'sev' pin the entry gate, with and without force.
my $tests = [
    {
        name => 'healthy cluster does not block',
        checks => {},
        expected => undef,
        acceptable => 1,
        acceptable_forced => 1,
        sev => 'HEALTH_OK',
    },
    {
        name => 'cephx key posture alone does not block',
        checks => { $cephx->%* },
        expected => undef,
        ignored => [sort keys $cephx->%*],
        acceptable => 1,
        acceptable_forced => 1,
        sev => 'HEALTH_OK',
    },
    {
        # Umbrella OSDs raise this right after their upgrade, between the nodes of a rolling
        # restart, and it reports space usage, not whether stopping an OSD is safe.
        name => 'BlueFS usage beyond the warn ratio does not block',
        checks => {
            BLUESTORE_BLUEFS_OVERSIZED => check(
                'HEALTH_WARN',
                '2 OSD(s) have BlueFS usage exceeding configured ratio of main device size',
            ),
        },
        expected => undef,
        ignored => ['BLUESTORE_BLUEFS_OVERSIZED'],
        acceptable => 1,
        acceptable_forced => 1,
        sev => 'HEALTH_OK',
    },
    {
        name => 'a real error next to the cephx checks still blocks',
        checks => { $cephx->%*, PG_UNAVAILABLE => check('HEALTH_ERR', 'no data') },
        expected => 'HEALTH_ERR',
        blockers => ['PG_UNAVAILABLE: no data'],
        errors => ['PG_UNAVAILABLE: no data'],
        ignored => [sort keys $cephx->%*],
        acceptable => 0,
        acceptable_forced => 0,
        sev => 'HEALTH_ERR',
    },
    {
        name => 'AUTH_BAD_CAPS is not key posture and still blocks',
        checks => { $cephx->%*, AUTH_BAD_CAPS => check('HEALTH_ERR', 'invalid caps') },
        expected => 'HEALTH_ERR',
        blockers => ['AUTH_BAD_CAPS: invalid caps'],
        errors => ['AUTH_BAD_CAPS: invalid caps'],
        ignored => [sort keys $cephx->%*],
        acceptable => 0,
        acceptable_forced => 0,
        sev => 'HEALTH_ERR',
    },
    {
        name => 'AUTH_EMERGENCY_CIPHERS_SET is an override and still blocks',
        checks =>
            { $cephx->%*, AUTH_EMERGENCY_CIPHERS_SET => check('HEALTH_WARN', 'override') },
        expected => 'HEALTH_WARN',
        blockers => ['AUTH_EMERGENCY_CIPHERS_SET: override'],
        ignored => [sort keys $cephx->%*],
        acceptable => 0,
        acceptable_forced => 1,
        sev => 'HEALTH_WARN',
    },
    {
        name => 'a warning next to an error is not named as the abort reason',
        checks => {
            OSD_FULL => check('HEALTH_ERR', '1 full osd(s)'),
            PG_DEGRADED => check('HEALTH_WARN', 'degraded data redundancy'),
        },
        expected => 'HEALTH_ERR',
        blockers => ['OSD_FULL: 1 full osd(s)', 'PG_DEGRADED: degraded data redundancy'],
        errors => ['OSD_FULL: 1 full osd(s)'],
        acceptable => 0,
        acceptable_forced => 0,
        sev => 'HEALTH_ERR',
    },
    {
        name => 'a muted check is ignored even at HEALTH_ERR',
        checks => { OSD_FULL => check('HEALTH_ERR', '1 full osd(s)', 1) },
        expected => undef,
        ignored => ['OSD_FULL (muted in ceph)'],
        acceptable => 1,
        acceptable_forced => 1,
        sev => 'HEALTH_OK',
    },
    {
        name => 'an unknown severity fails closed',
        checks => { SOME_NEW_CHECK => { severity => 'HEALTH_BOGUS', summary => {} } },
        expected => 'HEALTH_ERR',
        blockers => ['SOME_NEW_CHECK: no message'],
        errors => ['SOME_NEW_CHECK: no message'],
        acceptable => 0,
        acceptable_forced => 0,
        sev => 'HEALTH_ERR',
    },
    {
        name => 'a check ceph itself reports as HEALTH_OK does not block',
        checks => { MODULE_WITHOUT_SEVERITY => check('HEALTH_OK', 'fyi') },
        expected => undef,
        ignored => ['MODULE_WITHOUT_SEVERITY'],
        acceptable => 1,
        acceptable_forced => 1,
        sev => 'HEALTH_OK',
    },
    {
        # What pveceph.adoc tells operators to set before a maintenance window, and what a
        # rolling OSD restart sets itself, so this must not read as blocking anywhere.
        name => 'the noout flag we recommend ourselves does not block',
        checks => { OSDMAP_FLAGS => check('HEALTH_WARN', 'noout flag(s) set') },
        flags => 'noout,sortbitwise',
        expected => undef,
        ignored => ['OSDMAP_FLAGS'],
        acceptable => 1,
        acceptable_forced => 1,
        sev => 'HEALTH_OK',
    },
    {
        name => 'a disruptive OSD flag blocks',
        checks => { OSDMAP_FLAGS => check('HEALTH_WARN', 'flags') },
        flags => 'noout,pauserd,pausewr',
        expected => 'HEALTH_WARN',
        blockers => [
            'OSDMAP_FLAGS: cluster-wide flag(s) interfering with rolling restart:'
                . ' pauserd, pausewr',
        ],
        acceptable => 0,
        acceptable_forced => 1,
        sev => 'HEALTH_WARN',
    },
    {
        # Operators mute this for a permanently set noscrub. The flags still decide, otherwise
        # a nodown would slip through, and with it every OSD looks up while it is restarting.
        name => 'a muted OSDMAP_FLAGS does not hide a disruptive flag',
        checks => { OSDMAP_FLAGS => check('HEALTH_WARN', 'flags', 1) },
        flags => 'noscrub,nodown',
        expected => 'HEALTH_WARN',
        blockers =>
            ['OSDMAP_FLAGS: cluster-wide flag(s) interfering with rolling restart: nodown'],
        acceptable => 0,
        acceptable_forced => 1,
        sev => 'HEALTH_WARN',
    },
];

for my $test ($tests->@*) {
    my $health = { checks => $test->{checks} };
    my $rados = FakeRados->new($test->{flags}, $health);

    my ($worst, $blockers, $ignored, $errors) =
        PVE::Ceph::Services::classify_health_checks($rados, $health, 'osd');

    is($worst, $test->{expected}, "$test->{name} - severity");
    is_deeply($blockers, $test->{blockers} // [], "$test->{name} - blockers");
    is_deeply($ignored, $test->{ignored} // [], "$test->{name} - ignored");
    is_deeply($errors, $test->{errors} // [], "$test->{name} - errors");

    is_deeply(
        PVE::Ceph::Services::get_blocking_health_errors($rados, 'osd'),
        $test->{errors} // [],
        "$test->{name} - between-steps abort list",
    );

    for my $force (0, 1) {
        my $key = $force ? 'acceptable_forced' : 'acceptable';
        my ($ok, $sev) = PVE::Ceph::Services::check_health_acceptable($rados, $force, 'osd');
        is($ok ? 1 : 0, $test->{$key}, "$test->{name} - entry gate, force=$force");
        is($sev, $test->{sev}, "$test->{name} - reported severity, force=$force");
    }

    # Use the fixture's expected blockers, not another call to the same classifier.
    my %blocking = map { (split(/:/, $_, 2))[0] => 1 } ($test->{blockers} // [])->@*;
    my $status = { health => { checks => $test->{checks} } };
    PVE::Ceph::Services::annotate_restart_blocking($status, FakeRados->new($test->{flags}));
    for my $name (sort keys $test->{checks}->%*) {
        is(
            $status->{health}->{checks}->{$name}->{'blocks-restart'}->{osd},
            $blocking{$name} // 0,
            "$test->{name} - annotation for $name",
        );
    }
}

# A failed 'osd dump' must block rather than let OSDMAP_FLAGS through the allowlist.
{
    my $health = { checks => { OSDMAP_FLAGS => check('HEALTH_WARN', 'flags') } };
    my $rados = FakeRados->new(undef, $health);

    no warnings 'redefine';
    local *FakeRados::mon_command = sub {
        my ($self, $cmd) = @_;
        return $self->{health} if $cmd->{prefix} eq 'health';
        die "mon command failed\n";
    };

    my ($worst, $blockers) = PVE::Ceph::Services::classify_health_checks($rados, $health, 'osd');
    is($worst, 'HEALTH_WARN', 'a failed osd dump blocks, at the check severity');
    like(
        $blockers->[0],
        qr/^OSDMAP_FLAGS: could not fetch cluster flags/,
        'a failed osd dump names the fetch failure',
    );
}

# A health reply that is not a hash must come back as a refusal, not as a raw die.
{
    my $rados = FakeRados->new(undef, 'not a hash');
    my ($ok, $sev) = PVE::Ceph::Services::check_health_acceptable($rados, 1, 'osd');
    is($ok, 0, 'a malformed health reply refuses');
    is($sev, 'HEALTH_FETCH_FAIL', 'a malformed health reply is reported as a fetch failure');
}

# The annotation must tolerate a status without any health data.
is_deeply(
    PVE::Ceph::Services::annotate_restart_blocking({}, FakeRados->new),
    {},
    'annotating a status without health data leaves it alone',
);

# The osdmap flags govern OSD behaviour only, so they must not refuse a mon, mgr or mds
# restart - nodown in particular is what an operator sets to stop OSDs flapping.
{
    my $health = { checks => { OSDMAP_FLAGS => check('HEALTH_WARN', 'nodown flag(s) set') } };
    my $rados = FakeRados->new('noout,nodown', $health);

    for my $type (qw(mon mgr mds)) {
        my ($worst, $blockers, $ignored) =
            PVE::Ceph::Services::classify_health_checks($rados, $health, $type);
        is($worst, undef, "a disruptive OSD flag does not block a $type restart");
        is_deeply($ignored, ['OSDMAP_FLAGS'], "OSDMAP_FLAGS is ignored for $type");
    }

    my ($worst) = PVE::Ceph::Services::classify_health_checks($rados, $health, 'osd');
    is($worst, 'HEALTH_WARN', 'the same flag does block an osd restart');

    my ($unknown) = PVE::Ceph::Services::classify_health_checks($rados, $health, undef);
    is($unknown, 'HEALTH_WARN', 'an unknown daemon type is judged strictly');

    my $status = { health => { checks => $health->{checks} } };
    PVE::Ceph::Services::annotate_restart_blocking($status, $rados);
    is_deeply(
        $status->{health}->{checks}->{OSDMAP_FLAGS}->{'blocks-restart'},
        { osd => 1, mon => 0, mgr => 0, mds => 0 },
        'the annotation reports the OSD flags per daemon type',
    );
}

# Only an OSD restart depends on an active manager, through 'osd ok-to-stop'. Ceph raises
# MGR_DOWN to HEALTH_ERR once no manager was active for a while, which must not refuse the
# restart of the managers that brings one back.
{
    my $health = { checks => { MGR_DOWN => check('HEALTH_ERR', 'no active mgr') } };
    my $rados = FakeRados->new('', $health);

    for my $type (qw(mon mgr mds)) {
        my ($worst, $blockers, $ignored) =
            PVE::Ceph::Services::classify_health_checks($rados, $health, $type);
        is($worst, undef, "a missing manager does not block a $type restart");
        is_deeply($ignored, ['MGR_DOWN'], "MGR_DOWN is ignored for $type");
    }

    my ($worst) = PVE::Ceph::Services::classify_health_checks($rados, $health, 'osd');
    is($worst, 'HEALTH_ERR', 'a missing manager does block an osd restart');

    my ($unknown) = PVE::Ceph::Services::classify_health_checks($rados, $health, undef);
    is($unknown, 'HEALTH_ERR', 'a missing manager is judged strictly for an unknown type');

    my $status = { health => { checks => $health->{checks} } };
    PVE::Ceph::Services::annotate_restart_blocking($status, $rados);
    is_deeply(
        $status->{health}->{checks}->{MGR_DOWN}->{'blocks-restart'},
        { osd => 1, mon => 0, mgr => 0, mds => 0 },
        'the annotation reports a missing manager as blocking only OSD restarts',
    );
}

# 'noout' ownership: a run must only clear what it set, or an operator's own per-OSD flag is
# lost. Both callers matter here and they disagree on id format: the API passes 'osd.N', the
# migration helper passes a bare N.
{

    package NooutRados;

    sub new {
        my ($class, @flagged) = @_;
        return bless { flagged => { map { $_ => 1 } @flagged }, events => [] }, $class;
    }

    sub mon_command {
        my ($self, $cmd) = @_;
        if ($cmd->{prefix} eq 'osd dump') {
            return {
                osds => [
                    map { {
                        osd => $_,
                        state => [$self->{flagged}->{$_} ? ('noout') : (), 'up'],
                    } } (0 .. 3)
                ],
            };
        }
        my $call = "$cmd->{prefix}:" . join(',', $cmd->{who}->@*);
        push $self->{events}->@*, $call;
        return {};
    }
}

my $unflagged = sub {
    my ($rados, $ids) = @_;
    return PVE::Ceph::Services::unflagged_noout_osds($rados, $ids);
};

is_deeply(
    $unflagged->(NooutRados->new(), [0, 1, 2]),
    [0, 1, 2],
    'with no flag set every OSD is ours to set',
);
is_deeply(
    $unflagged->(NooutRados->new(1), [0, 1, 2]),
    [0, 2],
    'an OSD that already has noout is left alone',
);
is_deeply(
    $unflagged->(NooutRados->new(1), ['osd.0', 'osd.1', 'osd.2']),
    [0, 2],
    'the same holds for the osd.N form the API caller passes',
);
is_deeply($unflagged->(NooutRados->new(0, 1, 2), [0, 1, 2]), [], 'nothing to own when all are set');

# and the wrapper must touch only the owned ids, in both directions
{
    my $rados = NooutRados->new(1);
    PVE::Ceph::Services::with_noout(
        $rados,
        ['osd.0', 'osd.1', 'osd.2'],
        sub { push $rados->{events}->@*, 'body' },
        sub { push $rados->{events}->@*, ['persist', [$_[0]->@*]] },
    );
    is_deeply(
        $rados->{events},
        [
            ['persist', [0, 2]], 'osd set-group:0,2', 'body', 'osd unset-group:0,2',
            ['persist', []],
        ],
        'only owned flags surround the body, with journal updates in recovery order',
    );
}

# an already fully flagged set must not issue either command
{
    my $rados = NooutRados->new(0, 1, 2);
    PVE::Ceph::Services::with_noout($rados, [0, 1, 2], sub { push $rados->{events}->@*, 'body' });
    is_deeply($rados->{events}, ['body'], 'the body runs without touching pre-existing flags');
}

done_testing();
