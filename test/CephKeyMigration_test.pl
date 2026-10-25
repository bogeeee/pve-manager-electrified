#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use Test::More;
use Storable qw(dclone);

use FindBin;
use PVE::Ceph::KeyMigration qw(
    manual_promotion_support client_key_stageable staged_records
    parse_storage_key storage_config_problem storage_key_copy_problems storage_key_copy_warnings
    parse_auth_methods summarize_monitor_authentication
    $CIPHER $LEGACY_CIPHER
    key_cipher key_fingerprint parse_probe_output osd_label_identity needs_rotation mon_keyring_stale
    mon_key_rotation_wanted migration_unfinished unfinished_entities touched_daemons
    plan_client_keys build_plan bulk_storage_staging_needed client_staging_needed
    client_keys_requested
    configured_daemon_locations resolve_configured_locations merge_configured_daemons
    resume_verdict classify_insecure_clients
    open_options open_actions
    summarize_sessions session_hosts describe_sessions summarize_monitor_connections
    possible_consumer_hints
    stale_consumers session_key_targets sessions_judged_by_key reverse_session_status
    restrict_blockers
    cephfs_mount_storages
    ack_decision finish_after_acks
    plan_lockbox_keys parse_lockbox_output
);

# Real keys from a Ceph 19.2.6 cluster, not keys built the way key_cipher() reads them: the point
# is to check this against what Ceph actually writes.
my $NEW = 'AgCk941qku/sDSAAIjO5RhRv/ogXhuxccNS4DZxlXS1LUgzEGFIiY/U7IlI=';
my $OLD = 'AQCP/Y5qflfDFxAAPII6O9qSA7p65js5CEJYDA==';
my $NONE = 'AACP/Y5qnzxSGAAA';

{
    my $ring = "[client.vm]\n key = $OLD\n caps mon = \"allow r\"\n";
    for my $case (
        ['exact section', $ring, 'keyring', 'client.vm', $OLD],
        [
            'multiple sections',
            "[client.admin]\n key = $NEW\n$ring",
            'keyring',
            'client.vm',
            $OLD,
        ],
        ['bare CephFS secret', " $NEW\n", 'secret', 'client.vm', $NEW],
        ['quoted key', "[client.vm]\n key = \"$OLD\"\n", 'keyring', 'client.vm', $OLD],
        ['wrong user', $ring, 'keyring', 'client.admin', undef],
        ['duplicate section', "$ring$ring", 'keyring', 'client.vm', undef],
        ['duplicate key', "$ring key = $OLD\n", 'keyring', 'client.vm', undef],
        ['two secrets', "$OLD\n$NEW\n", 'secret', 'client.vm', undef],
        ['keyring as secret', $ring, 'secret', 'client.vm', undef],
        ['empty secret', '', 'secret', 'client.vm', undef],
        ['malformed key', "[client.vm]\n key = garbage\n", 'keyring', 'client.vm', undef],
        ['truncated blob', substr($OLD, 0, -4), 'secret', 'client.vm', undef],
        ['ignored caps', "$ring caps osd = \"allow *\n", 'keyring', 'client.vm', $OLD],
        ['other section without key', "${ring}[client.other]\n", 'keyring', 'client.vm', $OLD],
        [
            'auid and comments',
            "${ring} auid = 18446744073709551615 # owner\n; comment\n",
            'keyring',
            'client.vm',
            $OLD,
        ],
        [
            'quoted key and inline comment',
            "[client.vm]\n key = '$OLD' # comment\n",
            'keyring',
            'client.vm',
            $OLD,
        ],
        [
            'other invalid key',
            "${ring}[client.other]\n key = invalid\n",
            'keyring',
            'client.vm',
            $OLD,
        ],
    ) {
        my ($name, $content, $format, $entity, $expected) = @$case;
        my $result = parse_storage_key($content, $format, $entity);
        is($result->{key}, $expected, "$name selects only a verified key");
        ok(
            $expected ? !$result->{error} : $result->{error},
            "$name has explicit verification status",
        );
        unlike($result->{error} // '', qr/\Q$OLD\E|\Q$NEW\E/, "$name does not disclose secrets");
    }

    my $path = '/etc/pve/priv/ceph/vm.keyring';
    is(
        storage_config_problem("[global]\n keyring = $path\n", $path),
        undef,
        'generated external configuration names the inspected file',
    );
    for my $value (
        '"/etc/pve/priv/$cluster/$id.keyring" # generated',
        "'/etc/pve/priv/ceph/vm.keyring' ; comment",
        '/etc/pve/priv/${cluster}/${id}.keyring',
    ) {
        is(
            storage_config_problem("[global]\n keyring = $value\n", $path, 'client.vm'),
            undef,
            'quoted custom paths expand storage identity and cluster variables',
        );
    }
    for my $value (
        '/etc/$cluster/$cluster.$name.keyring', '/etc/$cluster/$cluster.$type.$id.keyring',
    ) {
        is(
            storage_config_problem(
                "[global]\n keyring = $value\n",
                '/etc/ceph/ceph.client.vm.keyring',
                'client.vm',
            ),
            undef,
            'name and type metavariables resolve to the configured user',
        );
    }
    for my $content (
        "[global]\n keyring = /other/path\n",
        "[global]\n key = $OLD\n",
        "include /other/config\n",
        "[global]\n",
        "[global]\n[global]\n",
    ) {
        my $error = storage_config_problem($content, $path);
        ok($error, 'custom credential indirection is unverified');
        unlike($error, qr/\Q$OLD\E/, 'configuration errors do not disclose inline keys');
    }

    my $copy = { store => 'vm', path => $path, entity => 'client.vm', key => $OLD };
    for my $error (
        'could not read file',
        'malformed or ambiguous key file',
        'alternate credentials',
        'no verified keyring path',
    ) {
        my $unverified = { %$copy, managed => 1, key => undef, error => $error };
        for my $entity (qw(osd.7 mgr.a mds.a client.osd-lockbox.uuid client.admin client.vm)) {
            my $problems = storage_key_copy_problems([$unverified], $entity, $OLD, $NEW);
            is(
                scalar(@$problems),
                $entity eq 'client.vm' ? 1 : 0,
                "$error gates only the configured user, not $entity",
            );
        }
        my $external = { %$unverified, managed => 0, entity => 'client.admin' };
        is_deeply(
            storage_key_copy_problems([$external], 'client.admin', $OLD, $NEW),
            [],
            'unverified external admin copy does not veto the local admin key',
        );
        like(
            join(' ', storage_key_copy_warnings([$external])->@*),
            qr/could not be checked:\n  vm: .*If one points at this cluster.*staged key of the same Ceph user/s,
            'unverified external copy warns without claiming ownership',
        );
        $unverified->{entity} = 'client.osd-lockbox.uuid';
        is_deeply(
            storage_key_copy_problems([$unverified], 'client.osd-lockbox.uuid', $OLD, $NEW),
            [],
            'a storage username matching a lockbox identity does not claim its key',
        );
    }
    my $problems = storage_key_copy_problems([$copy], 'client.admin', $OLD, $NEW);
    like(
        join(' ', @$problems),
        qr/still hold it:\n  vm: /,
        'matching bytes veto across configured users',
    );
    unlike(join(' ', @$problems), qr/\Q$OLD\E|\Q$NEW\E/, 'comparison errors do not disclose keys');
    is_deeply(
        storage_key_copy_problems([{ %$copy, key => $NEW }], 'client.vm', $OLD, $NEW),
        [],
        'a copy holding the target pending key passes',
    );
    is_deeply(
        storage_key_copy_problems([$copy], 'client.vm', $OLD, $OLD),
        [],
        'identical pending and active keys retire no distinct credential',
    );
    is_deeply(
        storage_key_copy_problems([{ %$copy, key => $NONE }], 'client.vm', $OLD, $NEW),
        [],
        'an external copy with a different key is not claimed',
    );
    ok(
        @{
            storage_key_copy_problems(
                [{ %$copy, key => $NONE, managed => 1 }],
                'client.vm',
                $OLD,
                $NEW,
            ),
        },
        'a third key is not a repaired managed copy',
    );
    like(
        join(' ', @{ storage_key_copy_problems([$copy], 'client.vm', $OLD, $NEW, 1) }),
        qr/the restored key of the same Ceph user/,
        'reverse advice names the restored key',
    );
}

{
    for my $case (
        ['', { cephx => 1 }],
        [' ;,=\t', undef],
        [" ;,=\t", { cephx => 1 }],
        ['none', { none => 1 }],
        ['cephx;gss,none=cephx', { cephx => 1, gss => 1, none => 1 }],
        ['CEPHX', undef],
        ['unknown', undef],
        [undef, undef],
        [{}, undef],
    ) {
        is_deeply(
            parse_auth_methods($case->[0]),
            $case->[1],
            'authentication methods follow Ceph token rules',
        );
    }
    my $report = sub {
        my ($cluster, $service, $client) = @_;
        return {
            auth_cluster_required => $cluster,
            auth_service_required => $service,
            auth_client_required => $client // 'cephx',
        };
    };
    for my $case (
        ['all none', $report->('none', 'none', 'none'), 0],
        ['ordinary cephx', $report->('cephx', 'cephx'), 1],
        ['gss', $report->('gss', 'gss'), 0],
        ['empty defaults', $report->('', ''), 1],
        ['service none, cluster cephx', $report->('cephx', 'none'), 0],
        ['client none, service cephx', $report->('none', 'cephx', 'none'), 1],
        ['mixed service methods', $report->('none', 'cephx,none'), 1],
        ['unknown service', $report->('cephx', 'other'), undef],
        ['missing settings', {}, undef],
        ['service-only client check', { auth_service_required => 'cephx' }, 1],
        ['service-only none', { auth_service_required => 'none' }, 0],
        ['unused client setting', $report->('none', 'cephx', 'other'), 1],
    ) {
        my ($name, $entry, $clients) = @$case;
        my $result = summarize_monitor_authentication(['a', 'b'], { a => $entry, b => $entry });
        is($result->{client_cephx_available}, $clients, "$name: client acceptance is independent");
    }
    my $mixed = summarize_monitor_authentication(
        ['a', 'b'],
        {
            a => $report->('none', 'none'),
            b => $report->('cephx', 'cephx'),
        },
    );
    is($mixed->{client_cephx_available}, 0, 'one disabled monitor vetoes client changes');
    my $unknown =
        summarize_monitor_authentication(['a', 'b'], { a => $report->('cephx', 'cephx') });
    is_deeply($unknown->{unknown}, ['b'], 'an unavailable monitor is named');
    ok(!defined($unknown->{client_cephx_available}), 'missing settings never authorize clients');
    ok(
        !defined(summarize_monitor_authentication([], {})->{client_cephx_available}),
        'empty monmap is unknown',
    );

    for my $key (undef, $OLD) {
        my $info = {
            pve_mon_key => $key,
            sessions => { complete => 1, clients => {} },
            exported => {},
            service_cipher => 'aes256k',
        };
        my $blockers = join(' ', @{ restrict_blockers($info, {}) });
        like(
            $blockers,
            qr/, see '--rotate-mon-key'/,
            'monitor-key blockers retain the base wording',
        );
    }
}

# 'ceph-bluestore-tool show-label' pretty-prints, and the probe only strips the newlines, so what
# the parser really sees is one line full of runs of spaces.
my $LABEL = <<'LABEL_EOF';
{
    "/var/lib/ceph/osd/ceph-2/block": {
        "osd_uuid": "9d4ef7d6-6ce8-4192-938a-cfe0ced279a5",
        "size": 16106127360,
        "btime": "2019-07-12T14:45:04.029467+0200",
        "ceph_fsid": "e3bcf831-39e8-4db3-a458-bbfa643a139d",
        "whoami": "2",
        "osd_key": "AgCk941qku/sDSAAIjO5RhRv/ogXhuxccNS4DZxlXS1LUgzEGFIiY/U7IlI=",
        "ready": "ready",
        "require_osd_release": "19"
    }
}
LABEL_EOF

# the probe strips the newlines and nothing else, which is what the parser has to cope with
$LABEL =~ s/\n//g;

# --- the cipher a key carries -------------------------------------------------------------
is(key_cipher($NEW), 2, 'an aes256k key from the cluster reads as aes256k');
is(key_cipher($OLD), 1, 'a legacy key from ceph-authtool reads as legacy');
is(key_cipher($NONE), 0, 'a 12 byte "none" key is the shortest real key and still readable');
is(
    key_cipher('not base64 at all !!'),
    undef,
    'garbage is unknown: decode_base64 drops junk silently, and a short decode that happened to'
        . ' start with 2 would otherwise read as already migrated',
);
is(key_cipher(''), undef, 'an empty key is unknown');
is(key_cipher(undef), undef, 'an undefined key is unknown');

# the state file records progress, so a marker must not become somewhere a key is kept
unlike(key_fingerprint($NEW), qr/\Q$NEW\E/, 'a fingerprint does not carry the key it names');
isnt(key_fingerprint($NEW), key_fingerprint($OLD), 'different keys get different fingerprints');

# --- reading what a node reported ----------------------------------------------------------
{
    my $probes = parse_probe_output(
        "label osd:2 $LABEL\n"
            . "keyring mgr:one [mgr.one]\n"
            . "keyring mds:two [mds.two][client.admin]\n"
            . "store mds:three missing\n"
            . "error osd:9 'ceph-bluestore-tool' failed: exit status 1"
            . " (bluestore(...) not a block device)\n"
            . "something else entirely\n",
    );
    is($probes->{'osd:2'}->{store}, 'block', 'a real label parses as a usable bluestore');
    is($probes->{'osd:2'}->{'label-whoami'}, '2', 'whoami comes out of it');
    is($probes->{'osd:2'}->{'label-key'}, $NEW, 'and the key, which is what verifies a write');
    like($probes->{'osd:2'}->{'label-fsid'}, qr/^[0-9a-f-]{36}$/, 'the cluster fsid comes out too');
    is(
        $probes->{'osd:2'}->{'label-osd-uuid'},
        '9d4ef7d6-6ce8-4192-938a-cfe0ced279a5',
        'and the per-OSD UUID distinguishes a reused ID from its old device',
    );

    my $identity = {
        id => '2',
        down => 1,
        'osd-uuid' => '9d4ef7d6-6ce8-4192-938a-cfe0ced279a5',
        $probes->{'osd:2'}->%*,
    };
    is(
        osd_label_identity($identity, 'e3bcf831-39e8-4db3-a458-bbfa643a139d'),
        'ok',
        'the current OSD incarnation accepts its own device',
    );
    is(
        osd_label_identity(
            { %$identity, 'label-whoami' => '7' },
            'e3bcf831-39e8-4db3-a458-bbfa643a139d',
        ),
        'wrong-id',
        'a label for another OSD ID is still refused',
    );
    is(
        osd_label_identity(
            { %$identity, 'label-fsid' => 'c452afbd-c4bd-4219-994c-cd93a144dbb7' },
            'e3bcf831-39e8-4db3-a458-bbfa643a139d',
        ),
        'wrong-cluster',
        'a label from another cluster is still refused',
    );
    is(
        osd_label_identity(
            { %$identity, 'osd-uuid' => '11c76ab5-9237-478e-9860-88c8215bb2fe' },
            'e3bcf831-39e8-4db3-a458-bbfa643a139d',
        ),
        'wrong-uuid',
        'an old device with the same ID and cluster FSID is refused after ID reuse',
    );
    is(
        osd_label_identity(
            { %$identity, 'label-osd-uuid' => undef },
            'e3bcf831-39e8-4db3-a458-bbfa643a139d',
        ),
        'incomplete',
        'a label without its per-OSD UUID proves too little',
    );
    is(
        osd_label_identity(
            { %$identity, 'osd-uuid' => undef },
            'e3bcf831-39e8-4db3-a458-bbfa643a139d',
        ),
        'missing-map-uuid',
        'a stopped OSD also needs an expected UUID from the current map',
    );
    is(
        osd_label_identity(
            { %$identity, down => 0, 'osd-uuid' => undef },
            'e3bcf831-39e8-4db3-a458-bbfa643a139d',
        ),
        'ok',
        'a running OSD first seen after the map snapshot still carries its own identity',
    );
    is_deeply(
        $probes->{'mds:two'}->{sections},
        ['mds.two', 'client.admin'],
        'a keyring holding more than its own entity lists every section',
    );
    is($probes->{'mds:three'}->{store}, 'missing', 'a directory with neither is missing');
    is($probes->{'osd:9'}->{store}, 'probe-error', 'a command that failed is its own state');
    like(
        $probes->{'osd:9'}->{error},
        qr/not a block device/,
        'and carries what the command said, which is the difference between a broken device and a'
            . ' label that has no key',
    );
    is(scalar(keys %$probes), 5, 'a line in no known shape is ignored rather than guessed at');
}
{
    my $keyless = parse_probe_output('label osd:4 {"/dev/sdc":{"whoami":"4"}}' . "\n");
    is(
        $keyless->{'osd:4'}->{store},
        'block-without-key',
        'a label that decodes but has no key is distinct from a failed command',
    );
    my $broken = parse_probe_output("label osd:5 {not json\n");
    is($broken->{'osd:5'}->{store}, 'block-without-key', 'so is one that does not decode');
}

# --- which keys still need work -------------------------------------------------------------
{
    my $info = { exported => { 'osd.1' => { key => $OLD }, 'osd.2' => { key => $NEW } } };
    is(needs_rotation($info, 'osd.1'), 1, 'a legacy key needs rotating');
    is(needs_rotation($info, 'osd.2'), 0, 'an aes256k key does not');
    is(
        needs_rotation($info, 'osd.9'),
        0,
        'an entity with no auth entry is not this step\'s business',
    );
}
{
    # 'ceph-mon --mkfs' moves 'mon.' out of the auth database and 'ceph-authtool --gen-key' has
    # defaulted to aes256k since 19.2.6, so on a cluster built since then 'mon.' is absent and
    # already migrated. Reading absence as "still on the old cipher" told every such cluster to
    # rotate a key that was fine.
    is(
        needs_rotation({ exported => {}, pve_mon_key => $NEW }, 'mon.'),
        0,
        'an absent mon. whose stored copy is aes256k needs nothing',
    );
    is(
        needs_rotation({ exported => {}, pve_mon_key => $OLD }, 'mon.'),
        1,
        'an absent mon. whose stored copy is legacy does need rotating',
    );
    is(
        needs_rotation({ exported => {} }, 'mon.'),
        1,
        'with no copy to judge it is treated as due rather than assumed fine',
    );
    is(
        needs_rotation({ exported => { 'mon.' => { key => $NEW } } }, 'mon.'),
        0,
        'once rotated into the auth database that entry decides',
    );
}

is(
    mon_keyring_stale({ mon_entry => { key => $NEW }, pve_mon_key => $OLD }),
    1,
    'a stored copy that differs from the auth database is stale',
);
is(
    mon_keyring_stale({ mon_entry => { key => $NEW }, pve_mon_key => $NEW }),
    0,
    'a matching copy is not',
);
is(
    mon_keyring_stale({ mon_entry => {}, pve_mon_key => $OLD }),
    0,
    'with nothing in the auth database there is nothing to be stale against',
);

{
    my $due = { exported => {}, pve_mon_key => $OLD };
    is(mon_key_rotation_wanted($due, {}), 0, 'the monitor key is never touched unasked');
    is(mon_key_rotation_wanted($due, { 'rotate-mon-key' => 1 }), 1, 'asked for, and due');
    is(
        mon_key_rotation_wanted($due, { 'rotate-mon-key' => 1, only => { mgr => 1 } }),
        0,
        'a scope that leaves the monitors out wins over the option',
    );
    is(
        mon_key_rotation_wanted($due, { 'rotate-mon-key' => 1, only => { mon => 1 } }),
        1,
        'a scope that names them does not',
    );
    is(
        mon_key_rotation_wanted({ exported => {}, pve_mon_key => $NEW }, { 'rotate-mon-key' => 1 }),
        0,
        'asked for, but nothing to do',
    );
}

# --- what an earlier run left behind ---------------------------------------------------------
{
    my $state = {
        rotated => { 'osd.1' => 1, 'osd.2' => 1, 'mon.' => 1 },
        done => { 'osd.1' => 1 },
        previous_keys => { 'client.admin' => {} },
        live_swap => { 'mgr.a' => { phase => 'staged' } },
    };
    is_deeply(
        [unfinished_entities($state)],
        ['client.admin', 'mgr.a', 'mon.', 'osd.2'],
        'a rotated key, saved old key, or live-swap journal without completion is unfinished',
    );
    $state->{mon_key_complete} = 'fingerprint';
    is_deeply(
        [unfinished_entities($state)],
        ['client.admin', 'mgr.a', 'osd.2'],
        'the monitor step carries its own completion marker',
    );
    is_deeply([unfinished_entities({})], [], 'a fresh state has nothing outstanding');

    $state->{previous_keys}->{'client.osd-lockbox.abc'} = { saved => 1 };
    $state->{lockbox}->{'client.osd-lockbox.abc'} = { phase => 'staged' };
    is_deeply(
        [unfinished_entities($state)],
        ['client.admin', 'mgr.a', 'osd.2'],
        'a journalled lockbox key is finished from its journal, not listed for the plan',
    );

    my $repeated = {
        done => { 'client.admin' => 100 },
        rotated => { 'client.admin' => 200 },
        previous_keys => { 'client.admin' => { saved => 200 } },
    };
    ok(
        migration_unfinished($repeated, 'client.admin'),
        'an older done marker does not hide a newer interrupted rotation',
    );
    $repeated->{done}->{'client.admin'} = 200;
    ok(
        !migration_unfinished($repeated, 'client.admin'),
        'the matching completion marker finishes the newer rotation',
    );
}

# --- which daemons a run writes to -------------------------------------------------------------
{
    my $info = { daemons => { mon => [{ entity => 'mon.a' }, { entity => 'mon.b' }] } };
    my $osd = { entity => 'osd.1' };
    is(
        scalar(touched_daemons($info, { daemons => [$osd], mon_key => 0 })),
        1,
        'only the planned daemons without the monitor step',
    );
    is(
        scalar(touched_daemons($info, { daemons => [$osd], mon_key => 1 })),
        3,
        'rotating the monitor key writes to every monitor',
    );
    is(
        scalar(touched_daemons($info, { daemons => [$osd], mon_key => 1, mon_repair_only => 1 })),
        1,
        'repairing only the stored copy writes to none of them, so none is validated either',
    );

    # its key is rotated too, so its version is checked. Only the work on its node is skipped.
    my $stretch = {
        daemons => {
            mon => [
                { entity => 'mon.', id => 'a', managed => 1 },
                { entity => 'mon.', id => 'b', managed => 1 },
                { entity => 'mon.', id => 'tiebreaker', managed => 0 },
            ],
        },
    };
    is(
        scalar(touched_daemons($stretch, { daemons => [$osd], mon_key => 1 })),
        4,
        'a monitor outside the cluster counts as changed as well',
    );
}

# --- daemons ceph cannot see ------------------------------------------------------------------
{
    # a stopped mgr or mds drops out of 'ceph <type> metadata' entirely, and its key would then
    # never be migrated, which the service ticket switch at the end refuses over
    my $running = [{ type => 'mds', id => 'a', entity => 'mds.a', node => 'n1' }];
    my $merged = merge_configured_daemons($running, 'mds', { a => 'n1', b => 'n2' });
    is(scalar(@$merged), 2, 'a configured daemon ceph does not report is picked up');
    my ($added) = grep { $_->{id} eq 'b' } @$merged;
    is($added->{entity}, 'mds.b', 'and gets the entity its key is under');
    is($added->{node}, 'n2', 'on the node that reported it');
    ok($added->{down}, 'marked down, which is what leaves it stopped rather than starting it');
    ok(
        !(grep { $_->{id} eq 'a' } @$merged)[0]->{down},
        'one ceph already reported is left exactly as it was',
    );

    my $mons = merge_configured_daemons([], 'mon', { x => 'n1' });
    is($mons->[0]->{entity}, 'mon.', 'every monitor shares the one mon. entity');

    my $locations = configured_daemon_locations({
        n1 => { 3 => { direxists => 1 }, 4 => { service => 1 } },
        n2 => { 3 => { direxists => 1 } },
    });
    is_deeply(
        $locations,
        { 3 => ['n1', 'n2'] },
        'every data directory remains visible when an ID is reported on several nodes',
    );
    my ($configured, $remnants, $conflicts) =
        resolve_configured_locations('osd', $locations, {}, { 3 => 'current-uuid' });
    is_deeply($configured, {}, 'an ambiguous stopped OSD gets no arbitrary node');
    is_deeply($remnants, [], 'a current OSD is not called a remnant');
    is_deeply(
        $conflicts,
        [{ type => 'osd', id => '3', nodes => ['n1', 'n2'] }],
        'both locations block a stopped OSD key write',
    );

    ($configured, $remnants, $conflicts) =
        resolve_configured_locations('osd', $locations, { 3 => 1 }, { 3 => 'current-uuid' });
    is_deeply($conflicts, [], 'running metadata makes its current node authoritative');

    ($configured, $remnants, $conflicts) =
        resolve_configured_locations('osd', $locations, {}, {});
    is_deeply(
        $remnants,
        [
            { type => 'osd', id => '3', node => 'n1' }, { type => 'osd', id => '3', node => 'n2' },
        ],
        'every location of an OSD absent from the map is reported as a remnant',
    );
    is_deeply($conflicts, [], 'absent OSD remnants cannot receive a key write');

    # a decommissioned OSD can leave its data directory behind
    my ($kept, $ghosts) = merge_configured_daemons(
        [],
        'osd',
        { 3 => 'n1', 6 => 'n2' },
        { 3 => '9d4ef7d6-6ce8-4192-938a-cfe0ced279a5' },
    );
    is(scalar(@$kept), 1, 'an OSD the OSD map does not hold is not picked up');
    is($kept->[0]->{entity}, 'osd.3', 'while one it holds still is');
    is(
        $kept->[0]->{'osd-uuid'},
        '9d4ef7d6-6ce8-4192-938a-cfe0ced279a5',
        'and it carries the current map UUID to the device check',
    );
    is_deeply(
        $ghosts,
        [{ type => 'osd', id => '6', node => 'n2' }],
        'and the leftover is reported for the run log instead',
    );
    my $every = merge_configured_daemons([], 'osd', { 6 => 'n2' });
    is(
        $every->[0]->{entity},
        'osd.6',
        'without an inventory of existing IDs every directory counts',
    );
}

# --- lexical subs must be defined before their first call ------------------------------------
{
    # a call site above a 'my sub' definition compiles clean and dies only at runtime
    open(my $fh, '<', "$FindBin::Bin/../bin/pve-cephx-rotate-service-keys") or die $!;
    my @lines = <$fh>;
    close($fh);
    my %defined_at;
    for my $i (0 .. $#lines) {
        $defined_at{$1} = $i if $lines[$i] =~ m/^my sub (\w+)/;
    }
    my @early;
    for my $i (0 .. $#lines) {
        next if $lines[$i] =~ m/^\s*#/;
        for my $name (keys %defined_at) {
            next if $i >= $defined_at{$name};
            push @early, "$name called on line " . ($i + 1) . " before its definition"
                if $lines[$i] =~ m/\b\Q$name\E\s*\(/ && $lines[$i] !~ m/^my sub/;
        }
    }
    is_deeply(\@early, [], 'no lexical sub is called above its definition');

    # a module function that is called but not imported compiles clean and dies at runtime
    my $module = "$FindBin::Bin/../PVE/Ceph/KeyMigration.pm";
    open(my $mfh, '<', $module) or die $!;
    my @module_lines = <$mfh>;
    close($mfh);
    my %module_subs;
    for my $line (@module_lines) {
        $module_subs{$1} = 1 if $line =~ m/^sub (\w+)/;
    }
    my $source = join('', @lines);
    my ($import_list) = $source =~ m/use PVE::Ceph::KeyMigration qw\(\s*(.*?)\);/s;
    my %imported = map { $_ => 1 } grep { length } split(/\s+/, $import_list // '');
    my @missing;
    for my $name (sort keys %module_subs) {
        next if $imported{$name} || $defined_at{$name};
        next if !grep { m/(?<![\w:>])\Q$name\E\s*\(/ && !m/^\s*#/ } @lines;
        push @missing, $name;
    }
    is_deeply(\@missing, [], 'every module function the script calls is imported');
}

# --- live client sessions -------------------------------------------------------------------
{
    my $mons = [
        {
            mon => 'a',
            sessions => [
                {
                    con_type => 'client',
                    entity_name => 'client.admin',
                    global_id => 100,
                    socket_addr => { addr => '10.0.0.1:0' },
                },
                {
                    con_type => 'client',
                    entity_name => 'client.admin',
                    global_id => 120,
                    socket_addr => { addr => '10.0.0.2:0' },
                },
                { con_type => 'osd', entity_name => 'osd.1', global_id => 90 },
            ],
        },
        {
            mon => 'b',
            sessions => [{
                con_type => 'client',
                entity_name => 'client.backup',
                global_id => 130,
                socket_addr => { addr => '10.0.0.1:0' },
            }],
        },
    ];
    my $summary = summarize_sessions($mons);
    ok($summary->{complete}, 'every monitor answered, so the picture is complete');
    is(scalar($summary->{clients}->{'client.admin'}->@*), 2, 'sessions are grouped by entity');
    ok(!exists $summary->{clients}->{'osd.1'}, 'daemon connections are not client sessions');
    is(
        session_hosts($summary->{clients}->{'client.admin'}),
        '10.0.0.1: 1, 10.0.0.2: 1',
        'the hosts of an entity read as host: count',
    );

    my $expected = summarize_sessions($mons, [qw(a b)]);
    ok($expected->{complete}, 'every expected monitor returned one result');
    my $missing = summarize_sessions([$mons->[0]], [qw(a b)]);
    ok(!$missing->{complete}, 'an omitted monitor result marks the picture incomplete');
    is_deeply($missing->{unanswered}, ['b'], 'the missing monitor remains available to output');
    ok(
        !summarize_sessions([], [])->{complete},
        'an empty expected monitor inventory cannot prove completeness',
    );
    ok(
        !summarize_sessions($mons, [qw(a a)])->{complete},
        'duplicate expected monitor IDs cannot prove completeness',
    );

    my $partial = summarize_sessions([$mons->[0], { mon => 'b', sessions => undef }]);
    ok(!$partial->{complete}, 'a monitor that did not answer marks the picture incomplete');
    is(
        scalar($partial->{clients}->{'client.admin'}->@*),
        2,
        'while the sessions that were read still count',
    );

    my $malformed_result = summarize_sessions(['not a monitor result']);
    ok(!$malformed_result->{complete}, 'a malformed monitor result marks the picture incomplete');

    my $malformed = summarize_sessions([{ mon => 'a', sessions => ['not a session'] }]);
    ok(!$malformed->{complete}, 'a malformed session entry marks the picture incomplete');

    my $bad_client = summarize_sessions([{
        mon => 'a',
        sessions => [{ con_type => 'client', entity_name => '', global_id => [] }],
    }]);
    ok(!$bad_client->{complete}, 'a client without a usable entity or ID is incomplete');
    is_deeply($bad_client->{clients}, {}, 'a malformed client contributes no consumer evidence');

    my $non_client = summarize_sessions([{
        mon => 'a',
        sessions => [{ con_type => 'osd', entity_name => '', global_id => [] }],
    }]);
    ok($non_client->{complete}, 'a valid non-client session remains irrelevant');

    my $own_tell = summarize_sessions([{
        mon => 'a',
        sessions => [{
            con_type => 'client',
            entity_name => 'mon.',
            global_id => 140,
            socket_addr => { addr => '10.0.0.3:0' },
        }],
    }]);
    ok($own_tell->{complete}, "a 'mon.' session leaves the picture complete");
    is_deeply($own_tell->{clients}, {}, "a 'mon.' session is no client of a key to refresh");
}

# --- the final step is offered once nothing else is open ---------------------------------------
{
    my $checks = { AUTH_INSECURE_KEYS_ALLOWED => {} };
    my $info = {
        sessions => { complete => 1, clients => {} },
        exported => {},
        pve_mon_key => $NEW,
        service_cipher => $CIPHER,
        health_checks => {},
    };
    my $options = open_actions('/helper', $checks, {}, {}, $CIPHER, {}, $info);
    is(scalar($options->{next}->@*), 1, 'an otherwise finished cluster gets one suggestion');
    like($options->{next}->[0], qr/--restrict-ciphers/, 'the cipher restriction');

    $checks->{AUTH_INSECURE_CLIENT_KEY_TYPE} =
        { detail => [{ message => "entity client.admin using insecure key type: aes" }] };
    $options = open_actions(
        '/helper',
        $checks,
        {},
        {},
        $CIPHER,
        {},
        { %$info, exported => { 'client.admin' => { key => $OLD } } },
    );
    ok(
        !(grep { m/restrict-ciphers/ } $options->{next}->@*),
        'not while a client key still needs its rotation',
    );
}

# --- consumers a rotation left behind ---------------------------------------------------------
{
    my $sessions = {
        complete => 1,
        clients => {
            'client.admin' => [
                { global_id => 100, host => 'a' },
                { global_id => 120, host => 'a' },
                { global_id => 121, host => 'b' },
            ],
            'client.backup' => [{ global_id => 90, host => 'c' }],
        },
    };
    # only an id recorded at the rotation proves an instance predates it; monitors allocate ids
    # in independent sequences, so a fresh instance may sit below any older id and must never
    # be flagged, or a record could neither clear nor be confirmed
    my $stale =
        stale_consumers($sessions, { 'client.admin' => { session_ids => [100, 120] } });
    is_deeply(
        [sort map { $_->{global_id} } $stale->{'client.admin'}->@*],
        [100, 120],
        'exactly the recorded instances count as stale',
    );
    ok(!exists $stale->{'client.backup'}, 'an entity nobody rotated is not reported');

    # Without a measurement or key targets, connected sessions prove nothing about a rotation.
    # Confirmation must measure them before accepting.
    $stale = stale_consumers($sessions, { 'client.admin' => { rotated => 1000 } });
    is_deeply($stale, {}, 'a record without a measurement proves nothing by itself');

    $stale = stale_consumers(
        $sessions, { 'client.admin' => { session_ids => [120], cleared => 5000 } },
    );
    is_deeply(
        [map { $_->{global_id} } $stale->{'client.admin'}->@*],
        [120],
        'a recorded instance that returns re-raises a cleared record, fresh ones never do',
    );

    $stale = stale_consumers($sessions, { 'client.crash' => { session_ids => [50] } });
    is_deeply($stale, {}, 'a rotated entity with no live session left has nothing to report');
}

# --- the mounts a rotated key reaches ----------------------------------------------------------
{
    my $item = {
        files => [
            {
                path => '/etc/pve/priv/ceph/cephfs.secret',
                format => 'secret',
                store => 'cephfs',
            },
            { path => '/etc/pve/priv/ceph/fs2.secret', format => 'secret', store => 'fs2' },
            { path => '/etc/pve/priv/ceph/rbd.keyring', format => 'keyring', store => 'rbd' },
            { path => '/etc/pve/priv/ceph.client.admin.keyring', format => 'keyring' },
        ],
    };
    is_deeply(
        cephfs_mount_storages($item),
        ['cephfs', 'fs2'],
        'every CephFS storage of the key is redone, an RBD storage has no mount to redo',
    );
    is_deeply(cephfs_mount_storages({ files => [] }), [], 'a key without storages redoes nothing');
}

# --- what a requested confirmation may do ------------------------------------------------------
{
    my $complete = {
        complete => 1,
        clients => { 'client.admin' => [{ global_id => 7, host => 'a' }] },
    };
    my $measured = { client_refresh => { 'client.admin' => { session_ids => [7] } } };
    my $unmeasured = { client_refresh => { 'client.admin' => { rotated => 1 } } };

    is(
        ack_decision('client.crash', $measured, $complete, {})->{verdict},
        'unknown',
        'a key without a rotation record has nothing to confirm',
    );

    my $stale = stale_consumers($complete, $measured->{client_refresh});
    my $connected = ack_decision('client.admin', $measured, $complete, $stale);
    is($connected->{verdict}, 'connected', 'a recorded consumer that is connected refuses it');
    is(scalar(@{ $connected->{held} }), 1, 'and is named, so the operator knows what to refresh');

    is(
        ack_decision('client.admin', $measured, { complete => 0, clients => {} }, {})->{verdict},
        'incomplete',
        'an unanswered monitor refuses it, a consumer could be connected unseen',
    );

    my $measure = ack_decision('client.admin', $unmeasured, $complete, {});
    is($measure->{verdict}, 'measure', 'an unmeasured rotation records what is connected first');
    is_deeply(
        [map { $_->{global_id} } @{ $measure->{live} }],
        [7],
        'namely every client connected as that key right now',
    );

    my $empty_measurement =
        ack_decision('client.admin', $unmeasured, { complete => 1, clients => {} }, {});
    is(
        $empty_measurement->{verdict},
        'measure',
        'an unmeasured rotation needs a complete measurement even when no client is connected',
    );
    is_deeply($empty_measurement->{live}, [], 'the empty live-client measurement is explicit');

    my $incomplete_measurement = {
        client_refresh => {
            'client.admin' => { session_ids => [], measurement_incomplete => 1 },
        },
    };
    is(
        ack_decision(
            'client.admin', $incomplete_measurement, { complete => 1, clients => {} }, {},
        )->{verdict},
        'measure',
        'an explicitly incomplete record also needs the complete empty measurement',
    );
    is(
        ack_decision('client.admin', $measured, { complete => 1, clients => {} }, {})->{verdict},
        'accept',
        'a measured record whose recorded consumers are gone can be confirmed',
    );
}

# --- the option list is the whole next step ----------------------------------------------------
{
    my $checks = { AUTH_INSECURE_KEYS_ALLOWED => {} };
    my $sessions = {
        complete => 1,
        clients => { 'client.admin' => [{ global_id => 7, host => 'a' }] },
    };
    my $info = {
        sessions => $sessions,
        exported => { 'client.admin' => { key => $NEW } },
        pve_mon_key => $NEW,
        service_cipher => $CIPHER,
        health_checks => {},
    };

    my $waiting = { client_refresh => { 'client.admin' => { session_ids => [7] } } };
    my $open = open_options($checks, {}, {}, $CIPHER, $waiting, $sessions);
    is_deeply($open->{waiting}, ['client.admin'], 'a record with a connected consumer waits');
    ok(
        !(grep { m/restrict-ciphers|confirm-clients-refreshed/ } $open->{next}->@*),
        'neither the confirmation nor the restriction is offered while it does',
    );

    my $unmeasured = {
        client_refresh => { 'client.admin' => { rotated => 1, measurement_incomplete => 1 } },
    };
    $open = open_actions('/helper', $checks, {}, {}, $CIPHER, $unmeasured, $info);
    is_deeply(
        $open->{waiting},
        ['client.admin'],
        'a record that would first measure its live consumer remains an explicit waiter',
    );
    is_deeply($open->{ready}, [], 'a measure verdict is never presented as ready');
    ok(!defined($open->{command}), 'no acknowledgment command is generated for a measurement');

    $open = open_actions(
        '/helper',
        $checks,
        {},
        {},
        $CIPHER,
        $unmeasured,
        { %$info, sessions => { complete => 1, clients => {} } },
    );
    is_deeply(
        $open->{waiting},
        ['client.admin'],
        'a complete empty snapshot is still the first measurement of an unmeasured record',
    );
    ok(!defined($open->{command}), 'that first empty measurement is not offered as confirmation');

    my $ready = { client_refresh => { 'client.admin' => { session_ids => [99] } } };
    $open = open_options($checks, {}, {}, $CIPHER, $ready, $sessions);
    is_deeply(
        $open->{ready},
        ['client.admin'],
        'once they are gone the confirmation is the next step, in one command for every key',
    );
    ok(
        !(grep { m/restrict-ciphers/ } $open->{next}->@*),
        'and the restriction waits for that confirmation',
    );

    $open = open_actions('/helper', $checks, {}, {}, $CIPHER, {}, $info);
    like(
        $open->{next}->[0],
        qr/^--restrict-ciphers:/,
        'with no record left, the restriction is what remains',
    );

    my $confirmed = {
        client_refresh => { 'client.admin' => { session_ids => [99], cleared => 5 } },
    };
    $open = open_actions('/helper', $checks, {}, {}, $CIPHER, $confirmed, $info);
    is_deeply($open->{ready}, [], 'a record already confirmed is not offered again');
    like(
        $open->{next}->[0],
        qr/^--restrict-ciphers:/,
        'and it no longer holds the restriction back',
    );

    my $returned = {
        client_refresh => { 'client.admin' => { session_ids => [7], cleared => 5 } },
    };
    $open = open_options($checks, {}, {}, $CIPHER, $returned, $sessions);
    is_deeply($open->{waiting}, ['client.admin'], 'a recorded consumer that returns waits again');
    ok(
        !(grep { m/restrict-ciphers/ } $open->{next}->@*),
        'and the restriction is off the table until it is gone',
    );

    my $partial = { complete => 0, clients => {} };
    $open = open_options($checks, {}, {}, $CIPHER, $ready, $partial);
    is_deeply($open->{ready}, [], 'an unanswered monitor offers no confirmation');
    is_deeply(
        $open->{waiting},
        ['client.admin'],
        'the incomplete verdict keeps every open record visible as a waiter',
    );
    ok(
        !(grep { m/restrict-ciphers/ } $open->{next}->@*),
        'nor the restriction, as a consumer could be connected unseen',
    );
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/client verification is incomplete\. Not every monitor answered\./,
        'an incomplete session picture explains the waiter',
    );
    ok(
        !(
            grep { m/restrict-ciphers/ } open_actions(
                '/helper', $checks, {}, {}, $CIPHER, {}, { %$info, sessions => $partial },
            )->{next}->@*
        ),
        'which holds with no record at all, the sweep is what is missing',
    );

    my $staged = {
        client_refresh => {
            'client.admin' => { session_ids => [], measurement_incomplete => 1 },
        },
        staged => { 'client.admin' => { key => key_fingerprint($NEW), written => 1 } },
    };
    my $exported = { 'client.admin' => { key => $OLD, pending_key => $NEW } };
    $open = open_options(
        $checks,
        {},
        {},
        $CIPHER,
        $staged,
        { complete => 0, clients => {}, unanswered => ['mon-b'] },
        $exported,
    );
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/Monitors that did not answer: mon-b\. Both keys remain valid\./,
        'a staged waiter names unanswered monitors and retained access',
    );

    $staged->{staged}->{'client.admin'}->{written} = 0;
    $open = open_options(
        $checks, {}, {}, $CIPHER, $staged, { complete => 1, clients => {} }, $exported,
    );
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/not written to every managed copy.*Both keys remain valid/s,
        'an unwritten staged key reports its distribution reason',
    );

    $staged->{staged}->{'client.admin'} = {
        key => key_fingerprint($NEW),
        written => 1,
        aborting => 1,
        abort_written => 1,
        abort_key => key_fingerprint($OLD),
    };
    $open = open_options(
        $checks, {}, {}, $CIPHER, $staged, { complete => 1, clients => {} }, $exported,
    );
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/rollback is prepared.*Both keys remain valid.*--confirm-abort-clients-refreshed/s,
        'a prepared rollback reports its reverse-refresh state',
    );
    $staged->{staged}->{'client.admin'}->{abort_retired} = 2;
    delete $exported->{'client.admin'}->{pending_key};
    $open = open_options(
        $checks, {}, {}, $CIPHER, $staged, { complete => 1, clients => {} }, $exported,
    );
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/no longer pending.*reconcile the rollback/,
        'an interrupted retirement needs reconciliation, not another retirement',
    );
    unlike(
        $open->{waiting_details}->{'client.admin'},
        qr/Both keys remain valid|confirm-abort-clients-refreshed/,
        'retirement is not described as retaining both credentials',
    );
    $staged->{staged}->{'client.admin'} = { key => key_fingerprint($NEW), written => 1 };
    delete $staged->{client_refresh}->{'client.admin'}->{measurement_incomplete};
    $open = open_options(
        $checks, {}, {}, $CIPHER, $staged, { complete => 1, clients => {} }, $exported,
    );
    is_deeply($open->{ready}, [], 'a lost staged key cannot be offered for confirmation');
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/neither pending nor active/,
        'the lost key is named',
    );
    $exported->{'client.admin'}->{key} = $NEW;
    $staged->{staged}->{'client.admin'}->{written} = 0;
    $open = open_options(
        $checks, {}, {}, $CIPHER, $staged, { complete => 1, clients => {} }, $exported,
    );
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/already active; the previous key no longer authenticates.*finish managed copies/,
        'promoted-key copy recovery does not claim that the previous key still works',
    );
    $open = open_options($checks, {}, {}, $CIPHER, $staged, { complete => 1, clients => {} });
    like(
        $open->{waiting_details}->{'client.admin'},
        qr/cannot be matched to the current auth database/,
        'missing auth state stays unknown',
    );
}

# --- when the offered command may promise the finish ---------------------------------------
{
    # the offer must ask the predicate that decides the restriction, not an empty option list
    my $sessions = {
        complete => 1,
        clients => { 'client.admin' => [{ global_id => 7, host => 'a' }] },
    };
    my $state = { client_refresh => { 'client.admin' => { session_ids => [99] } } };
    my $clean = {
        sessions => $sessions,
        exported => { 'client.admin' => { key => $NEW } },
        pve_mon_key => $NEW,
        service_cipher => $CIPHER,
        health_checks => {},
    };
    ok(
        finish_after_acks($clean, $state, ['client.admin']),
        'with the confirmation given, nothing is left and the finish may be offered',
    );

    my $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        $state,
        $clean,
    );
    is(
        $actions->{command},
        '/helper --apply --confirm-all-clients-refreshed --restrict-ciphers',
        'an all-ready command uses the aggregate and carries the guarded final step',
    );

    my $staged_state = {
        client_refresh => { 'client.admin' => { session_ids => [99] } },
        staged => {
            'client.admin' => { key => key_fingerprint($NEW), written => 1 },
        },
    };
    my $staged_info = {
        %$clean,
        exported => { 'client.admin' => { key => $OLD, pending_key => $NEW } },
        sessions => {
            complete => 1,
            clients => {
                'client.admin' => [{
                    global_id => 99,
                    key_fingerprint => key_fingerprint($NEW),
                }],
            },
        },
    };
    ok(
        finish_after_acks($staged_info, $staged_state, ['client.admin']),
        'a ready staged promotion is simulated before testing restriction readiness',
    );
    is(
        $staged_info->{exported}->{'client.admin'}->{key},
        $OLD,
        'the simulation does not mutate the collected auth export',
    );
    ok(
        exists($staged_state->{staged}->{'client.admin'}),
        'the simulation does not close the real staged record',
    );
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        $staged_state,
        $staged_info,
    );
    like(
        $actions->{command},
        qr/--confirm-all-clients-refreshed --restrict-ciphers$/,
        'the offered staged completion includes the now-valid restriction step',
    );

    my $mixed = {
        client_refresh => {
            'client.admin' => { session_ids => [7] },
            'client.crash' => { session_ids => [99] },
        },
    };
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        $mixed,
        {
            %$clean,
            exported => {
                %{ $clean->{exported} }, 'client.crash' => { key => $NEW },
            },
        },
    );
    is_deeply($actions->{waiting}, ['client.admin'], 'the paste-command input retains waiters');
    is_deeply($actions->{ready}, ['client.crash'], 'and carries every ready confirmation');
    is(
        $actions->{command},
        '/helper --apply --confirm-clients-refreshed client.crash',
        'a waiter keeps the final step out of that command',
    );

    my $unsafe_entity = q{client.bad;$(touch /root/pwned) 'quoted'};
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        {
            client_refresh => {
                'client.admin' => { session_ids => [7] },
                $unsafe_entity => { session_ids => [99] },
            },
        },
        {
            %$clean, exported => { %{ $clean->{exported} }, $unsafe_entity => { key => $NEW } },
        },
    );
    is(
        $actions->{command},
        '/helper --apply --confirm-clients-refreshed ' . PVE::Tools::shellquote($unsafe_entity),
        'a ready subset remains explicit and shell-quotes its cephx entity',
    );

    my $both_ready = {
        client_refresh => {
            'client.admin' => { session_ids => [98] },
            'client.crash' => { session_ids => [99] },
        },
    };
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        $both_ready,
        {
            %$clean,
            exported => {
                %{ $clean->{exported} }, 'client.crash' => { key => $NEW },
            },
        },
    );
    is(
        $actions->{command},
        '/helper --apply --confirm-all-clients-refreshed --restrict-ciphers',
        'the command aggregates every ready record before the permitted final step',
    );

    my $unmanaged = {
        %$clean, exported => { %{ $clean->{exported} }, 'client.rgw.foo' => { key => $OLD } },
    };
    ok(
        !finish_after_acks($unmanaged, $state, ['client.admin']),
        'a key nothing here manages still blocks it, though no option covers that key',
    );
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        $state,
        $unmanaged,
    );
    unlike(
        $actions->{command},
        qr/restrict-ciphers/,
        'an unmanaged key also keeps the final step out of the actual paste command',
    );
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        {},
        $unmanaged,
    );
    ok(
        !(grep { m/restrict-ciphers/ } $actions->{next}->@*),
        'nor is the final step offered on its own while an unmanaged key blocks it',
    );

    my $service = {
        %$clean, exported => { %{ $clean->{exported} }, 'osd.3' => { key => $OLD } },
    };
    ok(
        !finish_after_acks($service, $state, ['client.admin']),
        'and so does a service key on the old cipher',
    );
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        {},
        {},
        $CIPHER,
        {},
        $service,
    );
    ok(
        !(grep { m/restrict-ciphers/ } $actions->{next}->@*),
        'an old service key also withholds the standalone final step',
    );

    my $current_run = {
        %$clean, exported => {
            %{ $clean->{exported} }, 'client.crash' => { key => $OLD },
        },
    };
    $actions = open_actions(
        '/helper',
        { AUTH_INSECURE_KEYS_ALLOWED => {} },
        { 'rotate-client-keys' => 1 },
        {},
        $CIPHER,
        $state,
        $current_run,
    );
    unlike(
        $actions->{command},
        qr/restrict-ciphers/,
        'a requested rotation cannot promise the finish before its new record exists',
    );

    ok(
        !finish_after_acks({ %$clean, service_cipher => $LEGACY_CIPHER }, $state, ['client.admin']),
        'the service tickets must have moved as well',
    );

    ok(
        !finish_after_acks({ %$clean, pve_mon_key => $OLD }, $state, ['client.admin']),
        'a stored monitor key on the old cipher blocks it too',
    );

    my $another = {
        client_refresh => {
            'client.admin' => { session_ids => [99] },
            'client.crash' => { session_ids => [7] },
        },
    };
    ok(
        !finish_after_acks($clean, $another, ['client.admin']),
        'a record the run does not confirm keeps the finish out of the command',
    );
}

# --- what blocks the cipher restriction --------------------------------------------------------
{
    my $clean = {
        sessions => {
            complete => 1,
            clients => { 'client.admin' => [{ global_id => 200, host => 'a' }] },
        },
        exported => { 'client.admin' => { key => $NEW } },
        pve_mon_key => $NEW,
        service_cipher => $CIPHER,
    };
    is_deeply(restrict_blockers($clean, {}), [], 'nothing blocks a fully migrated cluster');

    my $blockers = restrict_blockers(
        $clean,
        { client_refresh => { 'client.admin' => { session_ids => [200] } } },
    );
    like(
        $blockers->[0],
        qr/recorded live client\(s\) may still hold the previous key of 'client.admin' \(a: 1\)/,
        'a recorded consumer that may predate the rotation blocks it',
    );

    my $old_key = { %$clean, exported => { 'client.admin' => { key => $OLD } } };
    $blockers = restrict_blockers($old_key, {});
    like(
        $blockers->[0],
        qr/1 active or pending keys still use another cipher: client.admin \(active\)/,
        'an entity key on the old cipher blocks it',
    );
    like(
        $blockers->[1],
        qr/1 live client\(s\) authenticate as 'client.admin'/,
        'and so does its live consumer, named separately',
    );

    my $old_pending = {
        %$clean, exported => { 'client.admin' => { key => $NEW, pending_key => $OLD } },
    };
    like(
        restrict_blockers($old_pending, {})->[0],
        qr/client.admin \(pending\)/,
        'a staged old-cipher key blocks the restriction before it can become active',
    );

    like(
        restrict_blockers({ %$clean, service_cipher => $LEGACY_CIPHER }, {})->[0],
        qr/service tickets still use the 'aes' cipher/,
        'the current service-ticket cipher is part of the authoritative predicate',
    );

    $blockers = restrict_blockers({ %$clean, pve_mon_key => $OLD }, {});
    like($blockers->[0], qr/stored 'mon.' key/, 'the stored monitor key counts too');

    my $partial = { %$clean, sessions => { complete => 0, clients => {} } };
    like(
        restrict_blockers($partial, {})->[0],
        qr/not every monitor answered/,
        'an incomplete session picture is never waved through',
    );

    $blockers = restrict_blockers(
        $clean, { client_refresh => { 'client.crash' => { rotated => 1000 } } },
    );
    like(
        $blockers->[0],
        qr/awaits '--confirm-clients-refreshed client.crash'/,
        'a rotation record asks for the acknowledgment, a consumer may be invisible',
    );

    $blockers = restrict_blockers(
        $clean,
        {
            client_refresh => { 'client.crash' => { rotated => 1000, session_ids => [50] } },
        },
    );
    like(
        $blockers->[0],
        qr/awaits '--confirm-clients-refreshed client.crash'/,
        'a measured record is no different, session absence proves nothing',
    );

    like(
        restrict_blockers(
            { %$clean, health_checks => { AUTH_EMERGENCY_CIPHERS_SET => {} } }, {},
        )->[0],
        qr/mon_auth_emergency_allowed_ciphers.*overrides the restriction/,
        'the emergency cipher override blocks, the restriction would not hold',
    );

    is_deeply(
        restrict_blockers(
            $clean,
            {
                client_refresh => {
                    'client.crash' => { rotated => 1000, session_ids => [50], cleared => 2000 },
                },
            },
        ),
        [],
        'a record considered refreshed no longer blocks while its instances stay away',
    );

    like(
        restrict_blockers({ %$clean, pve_mon_key => undef }, {})->[0],
        qr/stored 'mon.' key could not be read/,
        'an unreadable stored monitor key is a blocker, not a pass',
    );
}

# --- the plan -----------------------------------------------------------------------------------
my sub daemon {
    my ($type, $id) = @_;
    return { type => $type, id => $id, entity => "$type.$id", node => 'n1' };
}
my sub cluster {
    return {
        exported => { 'osd.1' => { key => $OLD }, 'mgr.a' => { key => $NEW } },
        daemons => {
            mon => [],
            mds => [],
            osd => [daemon('osd', 1)],
            mgr => [daemon('mgr', 'a')],
        },
        service_cipher => $LEGACY_CIPHER,
        pve_mon_key => $NEW,
    };
}
{
    my $plan = build_plan(cluster(), {}, {}, {});
    is_deeply(
        [map { $_->{entity} } $plan->{daemons}->@*],
        ['osd.1'],
        'only the daemon whose key is still legacy is planned',
    );
    is($plan->{service_cipher}, 1, 'a run over everything switches the service tickets at the end');
    is($plan->{mon_key}, 0, 'the monitor key stays out of it');

    my $scoped = build_plan(cluster(), {}, { only => { mgr => 1 } }, {});
    is(
        $scoped->{service_cipher},
        0,
        'a scoped run must not switch: it cannot know the keys it skipped are migrated',
    );
    is(scalar($scoped->{daemons}->@*), 0, 'and plans nothing outside its scope');

    my $one = build_plan(cluster(), {}, { only => { 'osd.1' => 1 } }, {});
    is_deeply(
        [map { $_->{entity} } $one->{daemons}->@*],
        ['osd.1'],
        'a scope can name a single daemon, which is how one left behind is repaired',
    );

    my $switched = cluster();
    $switched->{service_cipher} = $CIPHER;
    is(
        build_plan($switched, {}, {}, {})->{service_cipher},
        0,
        'an already switched cluster does not switch again',
    );
}
{
    # rotated in the auth database but the copies never written: the key is new, so needs_rotation()
    # says no, yet the daemon still has to be finished
    my $info = cluster();
    $info->{exported}->{'mgr.a'} = { key => $NEW };
    my $state = { rotated => { 'mgr.a' => 1 } };
    my $plan = build_plan($info, $state, {}, {});
    is_deeply(
        [sort map { $_->{entity} } $plan->{daemons}->@*],
        ['mgr.a', 'osd.1'],
        'a daemon an earlier run rotated but did not finish is planned again',
    );

    $state = {
        done => { 'mgr.a' => 1 },
        live_swap => { 'mgr.a' => { phase => 'written', key => key_fingerprint($NEW) } },
    };
    $plan = build_plan($info, $state, {}, {});
    is_deeply(
        [sort map { $_->{entity} } $plan->{daemons}->@*],
        ['mgr.a', 'osd.1'],
        'a live-swap journal is resumed even when stale completion state says the key is done',
    );

    $state = {
        done => { 'mgr.a' => 100 },
        rotated => { 'mgr.a' => 200 },
        previous_keys => { 'mgr.a' => { saved => 200 } },
    };
    $plan = build_plan($info, $state, {}, {});
    is_deeply(
        [sort map { $_->{entity} } $plan->{daemons}->@*],
        ['mgr.a', 'osd.1'],
        'a newer interrupted rotation is planned despite an older completion marker',
    );
}
{
    my $info = {
        exported => { 'mon.' => { key => $NEW } },
        daemons => { mon => [daemon('mon', 'a')], mgr => [], mds => [], osd => [] },
        service_cipher => $CIPHER,
        mon_entry => { key => $NEW },
        pve_mon_key => $OLD,
    };
    my $plan = build_plan($info, {}, {}, {});
    is($plan->{mon_key}, 1, 'a stale stored copy puts the monitor step in the plan unasked');
    is(
        $plan->{mon_repair_only},
        1,
        'but only as a repair, so it rotates nothing and restarts no monitor',
    );

    $info->{pve_mon_key} = $NEW;
    my $state = {
        rotated => { 'mon.' => 200 },
        mon_key_complete => key_fingerprint($OLD),
    };
    $plan = build_plan($info, $state, {}, {});
    is($plan->{mon_key}, 1, 'a completion marker for an older monitor key resumes the rotation');
    ok(!$plan->{mon_repair_only}, 'the resumed monitor rotation updates and restarts monitors');

    # killed between saving the old key and recording the rotation: the auth database may already
    # hold the new key while every monitor still runs on the old one
    $state = { previous_keys => { 'mon.' => { saved => 200 } } };
    $plan = build_plan($info, $state, {}, {});
    is($plan->{mon_key}, 1, 'a saved old key without the rotated marker resumes the rotation too');
    ok(!$plan->{mon_repair_only}, 'and carries it through to the monitors rather than repairing');
}

# --- client keys ---------------------------------------------------------------------------------
{
    my $info = {
        exported =>
            { 'client.admin' => { key => $OLD }, 'client.bootstrap-rbd' => { key => $OLD } },
    };
    my $files = {
        'client.admin' => [{
            path => '/etc/pve/priv/ceph/cp.keyring',
            scope => 'cluster',
            store => 'cp',
            kernel => 1,
        }],
        'client.bootstrap-rbd' => [{
            path => '/var/lib/ceph/bootstrap-rbd/ceph.keyring',
            scope => 'nodes',
        }],
    };
    my ($plan) = plan_client_keys($info, {}, { 'rotate-admin-key' => 1 }, $files);
    is(scalar(@$plan), 1, 'only the key that was asked for');
    is(
        $plan->[0]->{kernel},
        1,
        'a key an in-kernel client reads is marked, which is what gates it on the node kernels',
    );

    my $ordered_info = {
        exported => {
            'client.admin' => { key => $OLD },
            'client.alpha' => { key => $OLD },
            'client.zeta' => { key => $OLD },
        },
    };
    my $ordered_files = {
        'client.admin' => $files->{'client.admin'},
        'client.alpha' => [{ store => 'alpha' }],
        'client.zeta' => [{ store => 'zeta' }],
    };
    ($plan) = plan_client_keys(
        $ordered_info,
        {},
        {
            'rotate-admin-key' => 1,
            'rotate-storage-key' => [qw(zeta alpha)],
        },
        $ordered_files,
    );
    is_deeply(
        [map { $_->{entity} } @$plan],
        [qw(client.alpha client.zeta client.admin)],
        'client.admin is planned after other selected users in deterministic order',
    );

    my $repeated = {
        done => { 'client.admin' => 100 },
        rotated => { 'client.admin' => 200 },
        previous_keys => { 'client.admin' => { saved => 200 } },
    };
    my ($resume) = plan_client_keys(
        { exported => { 'client.admin' => { key => $NEW } } },
        $repeated,
        { 'rotate-admin-key' => 1 },
        $files,
    );
    is(scalar(@$resume), 1, 'a newer unfinished client rotation is planned despite an older done');

    my ($none, $warnings) =
        plan_client_keys({ exported => {} }, {}, { 'rotate-admin-key' => 1 }, $files);
    is(scalar(@$none), 0, 'a key with no auth entry is not planned');
    like(
        $warnings->[0],
        qr/no entry in the authentication database/,
        'and says so as a warning the caller prints, rather than dying or staying silent',
    );

    my $err = eval {
        plan_client_keys($info, {}, { 'rotate-storage-key' => ['cp'] }, $files);
        1;
    };
    ok(
        !$err && $@ =~ m/--rotate-admin-key/,
        'a storage on client.admin refuses and names the option that covers it, since that key is'
            . ' shared with every other storage and the command line',
    );
}

# --- interrupted live swaps -----------------------------------------------------------------
# The live swap stages a key with the monitors, writes it to disk, hands it to the daemon and then
# has the monitors promote it. A run can die between any two of those, so every point is walked
# here: what the journal says, what is staged now, and what a later run must do about it.
{
    my $ours = key_fingerprint($NEW);
    my $theirs = key_fingerprint($OLD);

    my $case = sub {
        my ($swap, $staged, $want_verdict, $want_restart, $name) = @_;
        my $got = resume_verdict($swap, $staged);
        is("$got->{verdict}/$got->{restart}", "$want_verdict/$want_restart", $name);
    };

    $case->(undef, undef, 'none', 0, 'no journal entry: there is nothing to recover');
    $case->(
        undef,
        $ours,
        'none',
        0,
        'a staged key with no journal entry is not this run\'s to touch here; the preflight'
            . ' refuses over it instead',
    );

    # died between writing the journal and asking for a key
    $case->(
        { phase => 'staging' },
        undef,
        'none',
        0,
        'killed before staging: nothing was staged and nothing written',
    );

    # died after the monitors staged a key, before any file was touched
    $case->(
        { phase => 'staged', key => $ours },
        $ours,
        'clear',
        0,
        'killed after staging: drop the key, the daemon still authenticates with the old one',
    );

    # died after the bluestore label or the keyring was written
    $case->(
        { phase => 'written', key => $ours },
        $ours,
        'commit',
        1,
        'killed after a copy on disk took the key: promote it, or that copy authenticates nowhere',
    );

    # died after the monitors promoted it, or Ceph promoted it on first successful use
    $case->(
        { phase => 'written', key => $ours },
        undef,
        'none',
        1,
        'killed after the promotion: nothing left to commit, but the daemon still has to restart',
    );

    # somebody else staged a key for the same entity in the meantime
    $case->(
        { phase => 'staged', key => $ours },
        $theirs,
        'foreign',
        0,
        'a key this run did not stage is never dropped or promoted behind its owner\'s back',
    );
    $case->(
        { phase => 'written', key => $ours },
        $theirs,
        'foreign',
        0,
        'not even when a copy on disk holds one of ours: the staged key is not that one',
    );

    # a journal entry written before fingerprints were recorded proves no ownership
    $case->(
        { phase => 'written' },
        $ours,
        'foreign',
        0,
        'an entry from an older version preserves a pending key despite its durable phase',
    );
    $case->(
        { phase => 'staged' },
        $ours,
        'foreign',
        0,
        'and a non-durable phase cannot authorize dropping it either',
    );
}

# --- manager order -------------------------------------------------------------------------
# Standbys go first: restarting one costs nothing, and the active manager's fallback restart
# then fails over onto a migrated one.
{
    my $mgr = sub {
        my ($id, $active) = @_;
        return {
            type => 'mgr',
            id => $id,
            entity => "mgr.$id",
            node => $id,
            active => $active,
        };
    };
    my $info = {
        exported => { map { ("mgr.$_" => { key => $OLD }) } qw(a b c) },
        daemons => {
            mon => [],
            mds => [],
            osd => [],
            mgr => [$mgr->('a', 0), $mgr->('b', 1), $mgr->('c', 0)],
        },
        service_cipher => $CIPHER,
        pve_mon_key => $NEW,
    };
    my $plan = build_plan($info, {}, {}, {});
    is_deeply(
        [map { $_->{entity} } $plan->{daemons}->@*],
        ['mgr.a', 'mgr.c', 'mgr.b'],
        'the active manager is planned last, behind both standbys',
    );

    $info->{daemons}->{mgr} = [$mgr->('a', 1), $mgr->('b', 0)];
    is_deeply(
        [map { $_->{entity} } build_plan($info, {}, {}, {})->{daemons}->@*],
        ['mgr.b', 'mgr.a'],
        'wherever it sits in the list to begin with',
    );

    # nothing else is reordered: an OSD walk stays in the order discovery produced
    $info->{daemons}->{mgr} = [];
    $info->{daemons}->{osd} = [
        { type => 'osd', id => '1', entity => 'osd.1', node => 'n' },
        { type => 'osd', id => '2', entity => 'osd.2', node => 'n' },
    ];
    $info->{exported} = { 'osd.1' => { key => $OLD }, 'osd.2' => { key => $OLD } };
    is_deeply(
        [map { $_->{entity} } build_plan($info, {}, {}, {})->{daemons}->@*],
        ['osd.1', 'osd.2'],
        'and only managers are ordered this way',
    );
}

# Each bucket routes to a different option or to operator-managed work, so the count Ceph reports
# says nothing about what to do next.
{
    my $check = sub {
        return {
            AUTH_INSECURE_CLIENT_KEY_TYPE => {
                detail => [map { { message => "entity $_ using insecure key type: aes" } } @_],
            },
        };
    };

    my $res = classify_insecure_clients(
        $check->(
            'client.osd-lockbox.6f0d1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b',
            'client.bootstrap-osd',
            'client.admin',
            'client.rbd-store',
            'client.rgw.node1',
        ),
        { 'client.rbd-store' => ['ceph-vm'] },
    );

    is_deeply(
        $res->{lockbox},
        ['client.osd-lockbox.6f0d1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b'],
        'a lockbox key is kept apart for the option that also updates its LVM tag',
    );
    is_deeply(
        $res->{tool},
        ['client.bootstrap-osd'],
        'a bootstrap key maps to --rotate-client-keys',
    );
    is_deeply($res->{admin}, ['client.admin'], 'the admin key maps to --rotate-admin-key');
    is_deeply($res->{storage}, ['client.rbd-store'], 'a storage user maps to --rotate-storage-key');
    is_deeply(
        $res->{other},
        ['client.rgw.node1'],
        'a key nothing here owns is reported, not offered',
    );

    my $none = classify_insecure_clients({});
    is_deeply([map { $none->{$_}->@* } sort keys %$none], [], 'no check at all yields nothing');

    my $storage_unknown = classify_insecure_clients($check->('client.rbd-store'));
    is_deeply(
        $storage_unknown->{other},
        ['client.rbd-store'],
        'a storage user is only offered when a storage still references it',
    );

    my $garbage = classify_insecure_clients({
        AUTH_INSECURE_CLIENT_KEY_TYPE =>
            { detail => [{ message => 'entity client.admin has bad caps' }, {}] },
    });
    is_deeply($garbage->{admin}, [], 'a detail line of another shape is not mistaken for a key');
}

# Suppressing every option because one of them was passed would hide the keys still to do.
{
    my $checks = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [
                map { { message => "entity $_ using insecure key type: aes" } }
                    ('client.admin', 'client.bootstrap-osd', 'client.store-a', 'client.store-b'),
            ],
        },
    };
    my $stores = { 'client.store-a' => ['rbd-vm'], 'client.store-b' => ['cephfs-iso', 'rbd-ct'] };

    my $all = open_options($checks, {}, $stores);
    is(scalar($all->{next}->@*), 3, 'every key that an option covers is offered');
    ok(
        (
            grep {
                m/^--rotate-all-storage-keys: stage keys for 2 dedicated storage users/
            } $all->{next}->@*
        ),
        'the dedicated storage users are offered together by the bulk option, each with its'
            . ' storages',
    );
    is_deeply(
        $all->{storage_scope},
        ["'client.store-a' (storage rbd-vm)", "'client.store-b' (storages cephfs-iso, rbd-ct)"],
        'the separate scope retains both users and every storage alias',
    );
    is(
        $all->{storage_bulk}, 2, 'the bulk summary carries the number of selected users',
    );

    my @many = map { sprintf('client.storage%02d', $_) } 1 .. 50;
    my $scale_checks = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [map { { message => "entity $_ using insecure key type: aes" } } @many],
        },
    };
    my $scale = open_options(
        $scale_checks, {}, { map { $_ => ["rbd-$_"] } @many },
    );
    my ($bulk_line) = grep { m/^--rotate-all-storage-keys:/ } $scale->{next}->@*;
    cmp_ok(length($bulk_line), '<=', 100, 'the 50-user bulk option summary stays bounded');
    is(scalar($scale->{storage_scope}->@*), 50, 'the structured scope retains every selected user');
    is_deeply(
        [map { /^'(client\.[^']+)'/ ? $1 : () } $scale->{storage_scope}->@*],
        \@many,
        'the structured scope keeps the exact selected identities',
    );

    my $one = open_options($checks, { 'rotate-storage-key' => ['rbd-vm'] }, $stores);
    is_deeply(
        [grep { m/rotate-client-keys|rotate-admin-key/ } $one->{next}->@*],
        [
            "--rotate-client-keys: the bootstrap keys and 'client.crash'",
            "--rotate-admin-key: 'client.admin' and the copies of it that Proxmox VE keeps",
        ],
        'rotating one storage key does not hide the other options',
    );
    ok(
        !grep({ m/rotate-storage-key rbd-vm/ } $one->{next}->@*),
        'but the storage this run rotated is not offered again',
    );
    is($one->{storage_bulk}, 1, 'one remaining dedicated user leaves no subset to name');
    is_deeply(
        $one->{storage_scope},
        ["'client.store-b' (storages cephfs-iso, rbd-ct)"],
        'the user behind the other storages is still offered, with every storage it serves',
    );
    ok(
        !(grep { m/^--rotate-storage-key / } $one->{next}->@*),
        'no per-storage option is suggested, the bulk option stages and the subset note covers it',
    );
    my $bulk_run = open_options($checks, { 'rotate-all-storage-keys' => 1 }, $stores);
    ok(
        !(grep { m/rotate-all-storage-keys|rotate-storage-key/ } $bulk_run->{next}->@*)
        && !$bulk_run->{storage_bulk},
        'a run that passed the bulk option is not offered it again',
    );
    ok(
        !(grep { m/rotate-all-storage-keys/ } $all->{together}->@*),
        'the bulk option never joins the command for work needing no decision',
    );

    is_deeply(
        $all->{together},
        ['--rotate-cluster-keys'],
        'the bundle uses one option for cluster-owned keys, never the admin or a storage key',
    );

    my $wipe = { AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE => {} };
    my $offered = open_options($wipe, {}, {}, $CIPHER);
    ok(
        !(grep { m/^--wipe-rotating-keys:/ } $offered->{next}->@*),
        'the wipe is not offered as a next step, the rotating keys expire on their own',
    );
    my $verbose_offer = open_options(
        { AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE => {} }, { verbose => 1 }, {},
    );
    like(
        $verbose_offer->{next}->[0],
        qr/^--wipe-rotating-keys:/,
        'and is named only when asked for details',
    );
    is_deeply(
        $offered->{together},
        [],
        'but never bundled: waiting a few hours instead is a decision of the operator',
    );

    my $refresh = {
        client_refresh => { 'client.crash' => { session_ids => [45], rotated => 1 } },
    };
    my $connected = {
        complete => 1,
        clients => { 'client.crash' => [{ global_id => 45, host => 'node1' }] },
    };
    # Enable the display prerequisite so each refusal exercises its safety condition.
    for my $case (
        ['a recorded consumer', $refresh, $connected],
        ['an unconfirmed refresh', $refresh, { complete => 1, clients => {} }],
        ['an incomplete session query', {}, { complete => 0, clients => {} }],
    ) {
        my ($reason, $state, $sessions) = @$case;
        ok(
            !grep({ m/^--wipe-rotating-keys:/ }
                open_options($wipe, { verbose => 1 }, {}, $CIPHER, $state, $sessions)->{next}
                    ->@*),
            "the wipe is not offered with $reason",
        );
    }

    ok(
        scalar(
            open_options($wipe, { verbose => 1, only => { 'osd.3' => 1 } }, {}, $CIPHER)
                ->{next}->@*
        ),
        "'--only' allows --wipe-rotating-keys once the service cipher is switched",
    );
    ok(
        !scalar(
            open_options($wipe, { verbose => 1, only => { 'osd.3' => 1 } }, {}, $LEGACY_CIPHER)
                ->{next}->@*
        ),
        'and it is not offered while the switch is still pending, as that run refuses it',
    );
}

# A lockbox key needs its LVM tag written as well, so it is only offered through the option that
# writes both. A key nothing here covers is reported instead.
{
    my $checks = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [
                map { { message => "entity $_ using insecure key type: aes" } }
                    ('client.osd-lockbox.6f0d1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b', 'client.rgw.node1'),
            ],
        },
    };
    my $res = open_options($checks, {}, {});
    is_deeply(
        $res->{next},
        [
            "--rotate-lockbox-keys: the lockbox key of every encrypted OSD, in the auth database"
                . " and in the LVM tag it is rebuilt from",
        ],
        'a legacy lockbox key is offered through the option that writes both copies',
    );
    is_deeply(
        $res->{stuck},
        ['client.rgw.node1'],
        'only the key no option covers is reported as stuck',
    );
    is($res->{lockbox}, 1, 'and the lockbox warning is triggered');

    my $asked = open_options($checks, { 'rotate-lockbox-keys' => 1 }, {});
    is_deeply($asked->{next}, [], 'the option is not re-offered to a run that already passed it');
    is_deeply(
        $asked->{stuck},
        ['client.rgw.node1'],
        'and only the key no option covers is left reported',
    );
    is($asked->{lockbox}, 0, 'nor is that run warned off doing by hand what it just did');
    is(open_options({}, {}, {})->{lockbox}, 0, 'a cluster without one does not get that warning');
}

# Reading an absent check must not add it to the caller's health map
{
    my $checks = { AUTH_INSECURE_KEYS_ALLOWED => { severity => 'HEALTH_WARN' } };
    open_options($checks, {}, {});
    is_deeply(
        [sort keys %$checks],
        ['AUTH_INSECURE_KEYS_ALLOWED'],
        'classifying does not autovivify the check it looks for',
    );
}

# The hedge belongs to the client key options, not to whatever else is left in the list.
{
    my $rotating = {
        AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE => {},
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [{ message => 'entity client.admin using insecure key type: aes' }],
        },
    };
    is(open_options($rotating, {}, {})->{hedge}, 1, 'the hedge comes with the admin key option');
    is(
        open_options($rotating, { 'rotate-admin-key' => 1 }, {})->{hedge},
        0,
        'and goes away with it, so it cannot land on --wipe-rotating-keys alone',
    );
    my $lockbox = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail =>
                [{ message => 'entity client.osd-lockbox.abc using insecure key type: aes' }],
        },
    };
    is(open_options($lockbox, {}, {})->{hedge}, 0, 'a lockbox key does not raise it');
}

# 'client.admin' backs any storage that names no user, and --rotate-storage-key refuses it.
{
    my $checks = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [{ message => 'entity client.admin using insecure key type: aes' }],
        },
    };
    my $res = classify_insecure_clients($checks, { 'client.admin' => ['cephfs', 'cp'] });
    is_deeply($res->{admin}, ['client.admin'], 'the admin entity stays out of the storage bucket');
    is_deeply($res->{storage}, [], 'even when storages reference it');
    is_deeply(
        open_options($checks, {}, { 'client.admin' => ['cephfs', 'cp'] })->{next},
        ["--rotate-admin-key: 'client.admin' and the copies of it that Proxmox VE keeps"],
        'so the option offered is the one that accepts it',
    );
}

# The detail line is matched whole; one that merely starts the same way is not a key
{
    my $loose = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [
                { message => 'entity client.a using insecure key type: aes and more text' },
                { message => 'prefixed entity client.b using insecure key type: aes' },
            ],
        },
    };
    my $res = classify_insecure_clients($loose);
    is_deeply([map { $res->{$_}->@* } sort keys %$res], [],
        'a message of another shape is ignored');
}

# A durable copy can exist from the moment the first write starts: an OSD's bluestore label is
# written before the data-directory keyring, and the label is what the data directory is rebuilt
# from at boot. Dropping the staged key then would leave that OSD unable to start.
{
    my $fp = key_fingerprint($NEW);
    is(
        resume_verdict({ phase => 'writing', key => $fp }, $fp)->{verdict},
        'commit',
        'a run killed while writing durable copies commits rather than drops the key',
    );
    is(
        resume_verdict({ phase => 'writing', key => $fp }, $fp)->{restart},
        1,
        'and restarts the daemon, which may still hold the old key in memory',
    );
    is(
        resume_verdict({ phase => 'staging' }, $fp)->{verdict},
        'foreign',
        'a pending key without a journal fingerprint remains unowned',
    );
    is(
        resume_verdict({ phase => 'writing' }, $fp)->{verdict},
        'foreign',
        'even a durable phase cannot claim a pending key without its fingerprint',
    );
    is(
        resume_verdict({ phase => 'writing', key => $fp }, undef)->{restart},
        1,
        'a committed key with no pending entry left still needs the restart',
    );
    is(
        resume_verdict({ phase => 'committed', key => $fp }, undef)->{restart},
        1,
        'the journal keeps requiring repair after promotion until the slow path finishes',
    );
}

# An encrypted OSD's lockbox key is only migrated once the auth entry and the LVM tag its keyring
# is rebuilt from at activation both hold the new one.
{
    my $info = {
        lockbox => {
            'client.osd-lockbox.aaa' => {
                fsid => 'aaa',
                cipher => 'aes',
                tag_cipher => 'aes',
                tag_matches => 1,
                node => 'due',
                id => 0,
                device => '/dev/vg/osd-block-aaa',
            },
            'client.osd-lockbox.bbb' => {
                fsid => 'bbb',
                cipher => $CIPHER,
                tag_cipher => $CIPHER,
                tag_matches => 1,
                node => 'tre',
                id => 1,
                device => '/dev/vg/osd-block-bbb',
            },
            'client.osd-lockbox.ccc' => {
                fsid => 'ccc',
                cipher => $CIPHER,
                tag_cipher => 'aes',
                tag_matches => 0,
                node => 'uno',
                id => 2,
                device => '/dev/vg/osd-block-ccc',
            },
            # both copies decode as the new cipher but hold different keys, which is what a run
            # interrupted between the tag write and the commit leaves behind
            'client.osd-lockbox.ddd' => {
                fsid => 'ddd',
                cipher => $CIPHER,
                tag_cipher => $CIPHER,
                tag_matches => 0,
                node => 'due',
                id => 3,
                device => '/dev/vg/osd-block-ddd',
            },
            'client.osd-lockbox.eee' => {
                fsid => 'eee',
                cipher => 'aes',
                tag_cipher => undef,
                tag_matches => 0,
                node => 'tre',
                id => 4,
                missing => 'no block device carries that fsid',
            },
            # left behind by a destroyed OSD: no device anywhere to write a tag to
            'client.osd-lockbox.fff' => { fsid => 'fff', cipher => 'aes', orphaned => 1 },
        },
    };

    is_deeply(plan_lockbox_keys($info, {}), [], 'nothing is planned without the option');

    my $planned = plan_lockbox_keys($info, { 'rotate-lockbox-keys' => 1 });
    is_deeply(
        [sort map { $_->{fsid} } @$planned],
        ['aaa', 'ccc', 'ddd', 'eee'],
        'legacy, mismatched, and unlocated keys are planned; matching and orphaned entries are not',
    );
    is(
        (grep { $_->{fsid} eq 'eee' } @$planned)[0]->{missing},
        'no block device carries that fsid',
        'an entry that could not be located carries its error, so preflight can refuse it',
    );
    is(
        (grep { $_->{fsid} eq 'aaa' } @$planned)[0]->{node},
        'due',
        'each entry carries the node its tag lives on',
    );
    is_deeply(
        plan_lockbox_keys({ lockbox => {} }, { 'rotate-lockbox-keys' => 1 }),
        [],
        'a cluster with no encrypted OSD plans nothing',
    );
}

# One probe per node answers for every encrypted OSD there, each line naming its fsid.
{
    my $facts = parse_lockbox_output(
        "aaa path=/dev/vg/osd-block-aaa\naaa count=1\naaa secret=$OLD\n"
            . "bbb path=/dev/vg/osd-block-bbb\nbbb count=0\nbbb secret=\n"
            . "ccc error=no block device carries 'ceph.osd_fsid=ccc' with 'ceph.type=block'\n"
            . "garbage line\n",
    );
    is_deeply(
        $facts,
        {
            aaa => { path => '/dev/vg/osd-block-aaa', count => '1', secret => $OLD },
            bbb => { path => '/dev/vg/osd-block-bbb', count => '0', secret => '' },
            ccc =>
                { error => "no block device carries 'ceph.osd_fsid=ccc' with 'ceph.type=block'" },
        },
        'each fact lands with the OSD it is about, an error stands in for the facts',
    );
    is_deeply(parse_lockbox_output(''), {}, 'no output, no facts');
}

# --- staged client keys ------------------------------------------------------------------------
{
    my $ok = { reached => 1, value => 'false' };
    my $on = { reached => 1, value => 'true' };
    my $old = { reached => 1, value => undef };
    my $gone = { reached => 0, error => 'ssh: connect to host mon-c failed' };

    my $all = manual_promotion_support({ a => $ok, b => $ok, c => $ok }, [qw(a b c)]);
    is_deeply(
        $all,
        { supported => 1, disabled => 1, unsupported => [], unanswered => [] },
        'every monitor knows the option and has it disabled',
    );

    my $enabled = manual_promotion_support({ a => $ok, b => $on, c => $ok }, [qw(a b c)]);
    ok(
        $enabled->{supported} && !$enabled->{disabled},
        'one monitor still promoting is supported but not disabled',
    );

    my $mixed = manual_promotion_support({ a => $ok, b => $old, c => $gone }, [qw(a b c)]);
    ok(!$mixed->{supported}, 'an old or silent monitor rules staging out');
    is_deeply($mixed->{unsupported}, ['b'], 'the monitor without the option is named');
    is_deeply($mixed->{unanswered}, ['c'], 'and so is the one that did not answer');

    my $partial = manual_promotion_support({ a => $ok, b => $ok }, [qw(a b c)]);
    is_deeply(
        $partial->{unanswered},
        ['c'],
        'a monitor of the map that was never asked counts as unanswered, quorum alone is not enough',
    );
    ok(!manual_promotion_support({}, [])->{supported}, 'no monitor map, no support');

    ok(!client_key_stageable('client.crash'), 'a tool key is replaced at once');
    ok(!client_key_stageable('client.bootstrap-osd'), 'so is a bootstrap key');
    ok(client_key_stageable('client.admin'), 'client.admin can be staged');
    ok(client_key_stageable('client.cp'), 'and so can a storage key');
}

{
    my $fp = key_fingerprint($NEW);
    my $state = {
        staged =>
            { 'client.admin' => { key => $fp, staged => 100 }, 'client.cp' => { key => $fp } },
    };
    my $info = {
        exported => {
            'client.admin' => { key => $OLD, pending_key => $NEW },
            'client.cp' => { key => $NEW },
        },
    };
    is_deeply(
        staged_records($info, $state),
        { 'client.admin' => 'waiting', 'client.cp' => 'committed' },
        'a matching pending key waits for its confirmation, a matching active key was committed',
    );
    is_deeply(
        staged_records({ exported => { 'client.admin' => { key => $OLD } } }, $state),
        { 'client.admin' => 'lost', 'client.cp' => 'lost' },
        'a staged key that is neither pending nor active is lost, as is one of a removed entity',
    );
    is_deeply(
        staged_records($info, { staged => { 'client.admin' => { staged => 100 } } }),
        {},
        'a record without a fingerprint cannot be judged and is skipped',
    );

    is_deeply(
        [
            unfinished_entities({
                previous_keys => { 'client.admin' => { saved => 5 } },
                staged => { 'client.admin' => { key => $fp } },
            })
        ],
        [],
        'a staged key is open on purpose and not an unfinished rotation',
    );
}

{
    my $files = {
        'client.admin' =>
            [{ path => '/etc/pve/priv/ceph.client.admin.keyring', scope => 'cluster' }],
        'client.crash' =>
            [{ path => '/etc/pve/ceph/ceph.client.crash.keyring', scope => 'cluster' }],
    };
    my $opts = { 'rotate-admin-key' => 1, 'rotate-client-keys' => 1 };
    my $exported = { 'client.admin' => { key => $OLD }, 'client.crash' => { key => $OLD } };

    my ($plan) = plan_client_keys(
        { exported => $exported, manual_promotion => { supported => 1 } },
        {},
        $opts,
        $files,
    );
    is_deeply(
        { map { $_->{entity} => $_->{staged} } @$plan },
        { 'client.admin' => 1, 'client.crash' => 0 },
        'with every monitor able to hold two keys, client.admin is staged and the tool key replaced',
    );

    ($plan) = plan_client_keys(
        { exported => $exported, manual_promotion => { supported => 0 } },
        {},
        $opts,
        $files,
    );
    is_deeply(
        { map { $_->{entity} => $_->{staged} } @$plan },
        { 'client.admin' => 1, 'client.crash' => 0 },
        'without that support the long-lived admin key still takes only the staged path',
    );
    ok(client_staging_needed($plan), 'the caller can refuse that unsupported admin staging');

    my $fp = key_fingerprint($NEW);
    my $waiting = {
        exported => {
            'client.admin' => { key => $OLD, pending_key => $NEW },
            'client.crash' => { key => $NEW },
        },
        manual_promotion => { supported => 1 },
    };
    my $state = {
        staged => { 'client.admin' => { key => $fp, written => 101 } },
        previous_keys => { 'client.admin' => { saved => 5 } },
        done => { 'client.crash' => 6 },
    };
    ($plan) = plan_client_keys($waiting, $state, $opts, $files);
    is(scalar(@$plan), 0, 'a key waiting for its confirmation is not staged again');

    $state->{mount_refresh}->{'client.admin'} = {
        target => $fp,
        pending => { cp => { due => 1 } },
    };
    ($plan) = plan_client_keys($waiting, $state, $opts, $files);
    ok(
        scalar(@$plan) == 1 && $plan->[0]->{refresh_only},
        'an unresolved mount is planned again without staging another key',
    );
    delete $state->{mount_refresh};

    delete $state->{staged}->{'client.admin'}->{written};
    ($plan) = plan_client_keys($waiting, $state, $opts, $files);
    is_deeply(
        [map { $_->{entity} } @$plan],
        ['client.admin'],
        'a staged key whose copies were not all written is planned again to finish them',
    );
    ($plan) = plan_client_keys(
        { %$waiting, manual_promotion => { supported => 0 } },
        $state,
        $opts,
        $files,
    );
    is(
        $plan->[0]->{staged},
        1,
        'and stays on the staged path even when the monitors no longer support it',
    );
    $state->{staged}->{'client.admin'}->{written} = 101;

    my $lost = {
        %$waiting,
        exported => { 'client.admin' => { key => $OLD }, 'client.crash' => { key => $NEW } },
    };
    ($plan) = plan_client_keys($lost, $state, $opts, $files);
    is_deeply([map { $_->{entity} } @$plan], ['client.admin'],
        'a lost staged key is planned again');

    my $records = { 'client.admin' => { rotated => 1, session_ids => [] } };
    my $picture = { complete => 1, clients => {} };
    my $open = open_options(
        {},
        {},
        {},
        $CIPHER,
        { client_refresh => $records, staged => { 'client.admin' => { key => $fp } } },
        $picture,
        $waiting->{exported},
    );
    is_deeply(
        [$open->{ready}, $open->{waiting}],
        [[], ['client.admin']],
        'a staged key whose copies are not all written is not offered for confirmation',
    );
    $open = open_options(
        {},
        {},
        {},
        $CIPHER,
        {
            client_refresh => $records,
            staged => { 'client.admin' => { key => $fp, written => 1 } },
        },
        $picture,
        $waiting->{exported},
    );
    is_deeply([$open->{ready}], [['client.admin']], 'once every copy is written it is offered');
    my $mount_wait = {
        client_refresh => $records,
        staged => { 'client.admin' => { key => $fp, written => 1 } },
        mount_refresh => {
            'client.admin' => { target => $fp, pending => { cp => { due => 1 } } },
        },
    };
    $open = open_options({}, {}, {}, $CIPHER, $mount_wait, $picture, $waiting->{exported});
    is_deeply(
        [$open->{ready}, $open->{waiting}],
        [[], ['client.admin']],
        'pending managed mount refreshes withhold confirmation independently of file writes',
    );

    my $insecure = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [{ message => 'entity client.admin using insecure key type: aes' }],
        },
    };
    $open = open_options(
        $insecure,
        {},
        {},
        $CIPHER,
        {
            client_refresh => $records,
            staged => { 'client.admin' => { key => $fp, written => 1 } },
        },
        $picture,
    );
    ok(
        !grep({ m/--rotate-admin-key/ } $open->{next}->@*),
        'a staged key still on the old cipher is not offered its rotation option again',
    );
    $open = open_options($insecure, {}, {}, $CIPHER, {}, $picture);
    ok(grep({ m/--rotate-admin-key/ } $open->{next}->@*), 'without a staged key it is');

    my $built = build_plan(
        {
            exported => $exported,
            manual_promotion => { supported => 1 },
            daemons => { mgr => [], mds => [], osd => [] },
            mon_entry => {},
            service_cipher => 'aes256k',
            lockbox => {},
        },
        {},
        { 'rotate-admin-key' => 1, 'restart-daemons' => 1 },
        $files,
    );
    is(
        $built->{stages_pending_keys},
        1,
        'a staged client key needs the preferred cipher claimed like any pending key',
    );
}

# --- bulk rotation of dedicated storage users --------------------------------------------------
{
    my $files = {
        'client.admin' =>
            [{ path => '/etc/pve/priv/ceph/cp.keyring', scope => 'cluster', store => 'cp' }],
        'client.vm' => [{
            path => '/etc/pve/priv/ceph/rbd-vm.keyring',
            scope => 'cluster',
            store => 'rbd-vm',
            kernel => 1,
        }],
        'client.shared' => [
            {
                path => '/etc/pve/priv/ceph/rbd-a.keyring',
                scope => 'cluster',
                store => 'rbd-a',
            },
            {
                path => '/etc/pve/priv/ceph/rbd-b.keyring',
                scope => 'cluster',
                store => 'rbd-b',
            },
        ],
        'client.done' =>
            [{ path => '/etc/pve/priv/ceph/old.keyring', scope => 'cluster', store => 'old' }],
        'client.bootstrap-osd' =>
            [{ path => '/var/lib/ceph/bootstrap-osd/ceph.keyring', scope => 'nodes' }],
    };
    my $info = {
        exported => {
            'client.admin' => { key => $OLD },
            'client.vm' => { key => $OLD },
            'client.shared' => { key => $OLD },
            'client.done' => { key => $NEW },
            'client.bootstrap-osd' => { key => $OLD },
        },
        manual_promotion => { supported => 1 },
    };
    my $bulk = { 'rotate-all-storage-keys' => 1 };

    my ($plan, $warnings) = plan_client_keys($info, {}, $bulk, $files);
    is_deeply(
        [map { $_->{entity} } @$plan],
        [qw(client.shared client.vm)],
        'every dedicated storage user still on the old cipher is selected once; client.admin,'
            . ' the tool keys and a migrated user are not',
    );
    my ($shared) = grep { $_->{entity} eq 'client.shared' } @$plan;
    like(
        $shared->{reason},
        qr/storages rbd-a, rbd-b/,
        'a user shared by several storages is planned once and names all of them',
    );
    is(scalar($shared->{files}->@*), 2, 'and every managed copy of it is rewritten');
    ok(!(grep { !$_->{staged} } @$plan), 'every new bulk rotation is staged');
    ok(bulk_storage_staging_needed($plan), 'a new bulk rotation needs monitors keeping two keys');
    is(scalar(@$warnings), 0, 'a clean selection warns about nothing');

    ($plan) =
        plan_client_keys({ %$info, manual_promotion => { supported => 0 } }, {}, $bulk, $files);
    ok(
        !(grep { !$_->{staged} } @$plan) && bulk_storage_staging_needed($plan),
        'without monitor support the bulk selection still plans staging, never replacement; the'
            . ' caller refuses it before any change',
    );

    ($plan) = plan_client_keys($info, {}, $bulk, { 'client.admin' => $files->{'client.admin'} });
    is_deeply($plan, [], 'storages on client.admin select nothing');
    ($plan) = plan_client_keys($info, {}, $bulk, {});
    is_deeply($plan, [], 'no dedicated user selects nothing');

    my $migrated = {
        %$info,
        exported => {
            %{ $info->{exported} },
            'client.vm' => { key => $NEW },
            'client.shared' => { key => $NEW },
        },
    };
    ($plan) = plan_client_keys($migrated, {}, $bulk, $files);
    is_deeply($plan, [], 'migrated users are left alone');
    ok(!bulk_storage_staging_needed($plan), 'and need no monitor support');

    my $state = { staged => { 'client.vm' => { key => key_fingerprint($NEW), staged => 1 } } };
    my $lost = {
        %$info,
        exported =>
            { %{ $info->{exported} }, 'client.vm' => { key => $OLD, pending_key => $NEW } },
        manual_promotion => { supported => 0 },
    };
    ($plan) = plan_client_keys($lost, $state, $bulk, $files);
    my ($vm) = grep { $_->{entity} eq 'client.vm' } @$plan;
    ok(
        $vm && $vm->{staged} && !$vm->{bulk_new_staging},
        'a key this script staged resumes its staged path after monitor support was lost and does'
            . ' not count as a new staging',
    );
    ok(bulk_storage_staging_needed($plan), 'while the other user still needs a new staging');
    my $owned_only = {%$files};
    delete $owned_only->{'client.shared'};
    ($plan) = plan_client_keys($lost, $state, $bulk, $owned_only);
    ok(!bulk_storage_staging_needed($plan), 'an owned staged key alone needs no monitor check');

    my $unfinished = {
        rotated => { 'client.vm' => 200 },
        previous_keys => { 'client.vm' => { saved => 200 } },
    };
    ($plan) = plan_client_keys($migrated, $unfinished, $bulk, $files);
    ($vm) = grep { $_->{entity} eq 'client.vm' } @$plan;
    ok(
        $vm && $vm->{resume_only} && !$vm->{staged} && !$vm->{bulk_new_staging},
        'an unfinished replacement only repairs its managed copies without changing the key',
    );
    ok(!client_staging_needed($plan), 'the repair creates no fresh pending key');
    ($plan) = plan_client_keys(
        { %$migrated, manual_promotion => { supported => 0 } },
        $unfinished, $bulk, $files,
    );
    ($vm) = grep { $_->{entity} eq 'client.vm' } @$plan;
    ok(
        $vm && $vm->{resume_only} && !$vm->{staged} && !$vm->{bulk_new_staging},
        'without monitor support it only finishes writing its copies, never a replacement',
    );
    ok(!bulk_storage_staging_needed($plan), 'which needs no monitor support either');

    ok(
        client_keys_requested($bulk) && !client_keys_requested({}),
        'the bulk option counts as a client key request, so the run does not end early',
    );
    my ($missing, $missing_warnings) = plan_client_keys(
        { %$info, exported => { 'client.shared' => { key => $OLD } } },
        {},
        $bulk,
        $files,
    );
    is_deeply(
        [map { $_->{entity} } @$missing],
        ['client.shared'],
        'a user without an auth entry is skipped',
    );
    ok(
        (
            grep {
                m/'client\.vm' \(used by managed local Ceph storage 'rbd-vm'\) has no entry/
            } @$missing_warnings
        ),
        'and reported with the storage that references it',
    );

    ($plan) = plan_client_keys($info, {}, { %$bulk, 'rotate-admin-key' => 1 }, $files);
    is_deeply(
        [map { $_->{entity} } @$plan],
        [qw(client.shared client.vm client.admin)],
        'client.admin joins only when asked for, and last',
    );
}

# --- naming what holds a monitor connection on a host --------------------------------------------
{
    my $hint = summarize_monitor_connections([
        { port => 3300, process => 'kvm', pid => 11, vmid => '102' },
        { port => 3300, process => 'kvm', pid => 11, vmid => '102' },
        { port => 3300, process => 'kvm', pid => 12, vmid => '9001' },
        { port => 6789 },
        { port => 6789 },
        { port => 3300, process => 'ceph-osd', pid => 5 },
        { port => 3300, process => 'ceph-mon', pid => 6 },
        { port => 3300, process => 'pvestatd', pid => 9 },
        { port => 3300, process => 'pvestatd', pid => 10 },
        { port => 3300, process => 'rbd', pid => 13 },
    ]);
    is(
        $hint,
        'VM 102, VM 9001; 2 unattributed sockets (possible kernel clients); pvestatd (2), rbd',
        'VMs are unique and processless sockets remain possible kernel clients',
    );
    is(
        summarize_monitor_connections([{ port => 6789 }]),
        'unattributed socket (possible kernel client)',
        'one processless socket is not presented as a known mount',
    );
    is(
        summarize_monitor_connections([
            { port => 3300, process => 'ceph-mgr', pid => 2 },
            { port => 3300, process => 'pverados', pid => 3 },
        ]),
        undef,
        'daemons and the Proxmox VE RADOS workers alone give no hint',
    );
    is(summarize_monitor_connections('garbage'), undef, 'and so does a malformed answer');
    is(
        summarize_monitor_connections([{ process => 'kvm', vmid => 102 }, {}], 1),
        'VM 102; unattributed socket without an owning process (possible kernel client)',
        'verbose output keeps the unidentified socket separate from the VM',
    );

    my $live = [
        { host => '10.0.0.2', global_id => 1 },
        { host => '10.0.0.2', global_id => 2 },
        { host => '198.51.100.8', global_id => 3 },
    ];
    my $hints = {
        '10.0.0.2' => { node => 'due', consumers => 'VM 102' },
    };
    is(
        describe_sessions($live, $hints),
        '198.51.100.8: 1, due: 2 (possible clients: VM 102)',
        'known IPs become node names while unknown hosts remain visible',
    );
    is(describe_sessions($live), session_hosts($live), 'without hints the plain host list stays');
    is_deeply(
        possible_consumer_hints(
            [@$live, { host => '10.0.0.2', global_id => 4 }], $hints,
        ),
        ['due: VM 102'],
        'a host-wide hint shared by several sessions and users is returned once',
    );

    my $info = {
        exported => { 'client.vm' => { key => $OLD } },
        service_cipher => $CIPHER,
        sessions =>
            { complete => 1, clients => { 'client.vm' => [{ host => 'due', global_id => 3 }] } },
        pve_mon_key => $NEW,
        health_checks => {},
    };
    my ($blocker) = grep { m/live client/ } restrict_blockers(
        $info,
        {},
        sub {
            describe_sessions(
                $_[0], { due => { node => 'due', consumers => 'VM 102' } },
            );
        },
    )->@*;
    like(
        $blocker,
        qr/1 live client\(s\) authenticate as 'client\.vm' \(due: 1 \(possible clients: VM 102\)\)/,
        'the restriction blocker labels host-wide hints as possible consumers',
    );
}

# --- restriction blockers read as one decision per user -----------------------------------------
{
    my $tools = $PVE::Ceph::KeyMigration::TOOL_CLIENT_KEYS;
    my $info = {
        exported => {
            'client.admin' => { key => $OLD, pending_key => $NEW },
            map { $_ => { key => $NEW } } @$tools,
        },
        service_cipher => $CIPHER,
        sessions => {
            complete => 1,
            clients => {
                'client.admin' => [map { { global_id => $_, host => 'due' } } 200 .. 209],
            },
        },
        pve_mon_key => $NEW,
        health_checks => {},
    };
    my $state = {
        staged => { 'client.admin' => { key => key_fingerprint($NEW), written => 1 } },
        client_refresh => {
            'client.admin' => { rotated => 1, session_ids => [200 .. 203] },
            map { $_ => { rotated => 1, session_ids => [] } } @$tools,
        },
    };
    my $blockers = restrict_blockers($info, $state);
    ok(
        !grep({ m/active or pending keys still use another cipher/ } @$blockers),
        'an old active key with a staged successor is not listed as a bare old key',
    );
    my @admin = grep { m/client\.admin'/ } @$blockers;
    is(scalar(@admin), 1, 'a user with live and recorded sessions gets one line');
    like(
        $admin[0],
        qr/^'client\.admin': 4 session\(s\) may still hold the previous key \(due: 4\).*Refresh these clients, then rerun without options\.$/,
        'only the recorded subset is reported as needing refresh',
    );
    my $unrecorded = { %$state, client_refresh => { %{ $state->{client_refresh} } } };
    $unrecorded->{client_refresh}->{'client.admin'} = { rotated => 1, session_ids => [] };
    $blockers = restrict_blockers($info, $unrecorded);
    @admin = grep { m/client\.admin'/ } @$blockers;
    is(scalar(@admin), 1, 'a staged user with live but unrecorded sessions gets one line too');
    like(
        $admin[0],
        qr/^'client\.admin': 10 session\(s\) have no key fingerprint\. Both keys remain valid\./,
        'unidentified new sessions cannot be offered confirmation while both keys authenticate',
    );
    my @tools = grep { m/bootstrap and crash keys/ } @$blockers;
    is(scalar(@tools), 1, 'the open bootstrap and crash records are one line');
    like(
        $tools[0],
        qr/the rotations of 7 bootstrap and crash keys await their confirmation, which needs no client refresh; '--confirm-all-clients-refreshed' closes them/,
        'saying why no refresh is needed and how to close them',
    );
    ok(!(grep { m/bootstrap-mds' awaits/ } @$blockers), 'and no line per tool key');

    my $one_tool =
        { %$state, client_refresh => { 'client.crash' => { rotated => 1, session_ids => [] } } };
    like(
        (grep { m/tool key/ } restrict_blockers($info, $one_tool)->@*)[0],
        qr/the rotation of the tool key 'client\.crash' awaits '--confirm-clients-refreshed client\.crash'/,
        'a single open tool record keeps its exact command',
    );

    my $connections =
        [map { { port => 3300, process => 'kvm', pid => $_, vmid => 100 + $_ } } 1 .. 10];
    is(
        summarize_monitor_connections($connections),
        'VM 101, VM 102, VM 103, VM 104, VM 105, VM 106, VM 107, VM 108, 2 more VMs',
        'a concise host hint is summarized after the first eight VMs',
    );
    is(
        summarize_monitor_connections($connections, 1),
        join(', ', map { "VM $_" } 101 .. 110),
        'verbose output includes every VM identity',
    );
}

# --- a monitor that names the key behind a session settles what a recorded ID only guessed ------
{
    my $summary = summarize_sessions([{
        mon => 'a',
        sessions => [
            {
                con_type => 'client',
                entity_name => 'client.vm',
                global_id => 1,
                socket_addr => { addr => '10.0.0.2:0' },
                auth_key_fingerprint => 'aaaaaaaaaaaaaaaa',
                auth_key_pending => 0,
            },
            {
                con_type => 'client',
                entity_name => 'client.vm',
                global_id => 2,
                socket_addr => { addr => '10.0.0.3:0' },
            },
        ],
    }]);
    my ($named, $plain) = $summary->{clients}->{'client.vm'}->@*;
    is($named->{key_fingerprint}, 'aaaaaaaaaaaaaaaa', 'the fingerprint a monitor reports is kept');
    ok(!exists($plain->{key_fingerprint}), 'a monitor without it leaves the session unnamed');

    my $targets = session_key_targets({
        'client.vm' => { key => $OLD, pending_key => $NEW },
        'client.done' => { key => $NEW },
        'client.odd' => 'not a hash',
    });
    is($targets->{'client.vm'}, key_fingerprint($NEW), 'a staged key is the target');
    is($targets->{'client.done'}, key_fingerprint($NEW), 'otherwise the active key');
    ok(!exists($targets->{'client.odd'}), 'and garbage is skipped');

    my $sessions = {
        complete => 1,
        clients => {
            'client.vm' => [
                { global_id => 1, host => 'a', key_fingerprint => key_fingerprint($OLD) },
                { global_id => 2, host => 'a', key_fingerprint => key_fingerprint($NEW) },
                { global_id => 3, host => 'b', key_fingerprint => key_fingerprint($OLD) },
                { global_id => 4, host => 'b' },
                { global_id => 5, host => 'b' },
            ],
        },
    };
    my $refresh = { 'client.vm' => { session_ids => [2, 4] } };
    my $held = stale_consumers($sessions, $refresh, $targets)->{'client.vm'};
    is_deeply(
        [sort map { $_->{global_id} } @$held],
        [1, 3, 4],
        'a known key overrides recorded IDs; unidentified sessions fall back to their record',
    );
    is_deeply(
        { map { $_->{global_id} => $_->{judged_by_key} } @$held },
        { 1 => 1, 3 => 1, 4 => 0 },
        'each held session says whether its key or its record made it stale',
    );
    ok(!sessions_judged_by_key($held), 'a mixed list is not judged by key alone');
    ok(
        sessions_judged_by_key([grep { $_->{judged_by_key} } @$held]),
        'a list of key-judged sessions is',
    );
    is_deeply(
        [map { $_->{global_id} } stale_consumers($sessions, $refresh)->{'client.vm'}->@*],
        [2, 4],
        'without targets only the recorded IDs count, as before',
    );

    is_deeply(
        $refresh,
        { 'client.vm' => { session_ids => [2, 4] } },
        'classification retains IDs for later observations without fingerprints',
    );
    for my $other (undef, '', key_fingerprint($OLD)) {
        my $observations = {
            complete => 1,
            clients => {
                'client.vm' => [
                    { global_id => 2, host => 'a', key_fingerprint => key_fingerprint($NEW) },
                    { global_id => 2, host => 'b', key_fingerprint => $other },
                ],
            },
        };
        for my $order (0, 1) {
            my $held = stale_consumers($observations, $refresh, $targets)->{'client.vm'};
            is_deeply(
                [map { $_->{host} } @$held],
                ['b'],
                'a matching observation cannot clear an old or unidentified observation of the same ID',
            );
            $observations->{clients}->{'client.vm'} =
                [reverse $observations->{clients}->{'client.vm'}->@*];
        }
    }
    my $matching = {
        complete => 0,
        clients => {
            'client.vm' => [{ global_id => 2, key_fingerprint => key_fingerprint($NEW) }],
        },
    };
    my $matching_stale = stale_consumers($matching, $refresh, $targets);
    is_deeply($matching_stale, {}, 'a target-key session is not itself stale in a partial sweep');
    is(
        ack_decision('client.vm', { client_refresh => $refresh }, $matching, $matching_stale)
            ->{verdict},
        'incomplete',
        'positive key evidence does not authorize confirmation from a partial sweep',
    );
    is_deeply(
        [
            map { $_->{global_id} }
                stale_consumers($matching, $refresh, { 'client.vm' => '' })->{'client.vm'}->@*
        ],
        [2],
        'an empty target fingerprint leaves recorded evidence authoritative',
    );

    my $reverse = reverse_session_status(
        $sessions, { 'client.vm' => { key => $OLD, pending_key => $NEW } }, 'client.vm',
    );
    is_deeply(
        [map { $_->{global_id} } $reverse->{pending}->@*],
        [2],
        'reverse refresh identifies sessions that still use the key to retire',
    );
    is_deeply(
        [map { $_->{global_id} } $reverse->{unknown}->@*],
        [4, 5],
        'a complete collection does not resolve sessions without key fingerprints',
    );
}

# --- an export that is ahead of the health check drops keys rotated a moment ago ---------------
{
    my $checks = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [
                map { { message => "entity $_ using insecure key type: aes" } }
                    ('client.admin', 'client.osd-lockbox.1', 'client.store'),
            ],
        },
    };
    my $exported = {
        'client.admin' => { key => $NEW },
        'client.osd-lockbox.1' => { key => $NEW },
        'client.store' => { key => $OLD },
    };
    my $clients = classify_insecure_clients($checks, { 'client.store' => ['s'] }, $exported);
    is_deeply(
        [$clients->{admin}, $clients->{lockbox}, $clients->{storage}],
        [[], [], ['client.store']],
        'a key the export shows on the new cipher is not offered on the strength of a stale check',
    );
    my $open =
        open_options($checks, {}, { 'client.store' => ['s'] }, $CIPHER, {}, undef, $exported);
    ok(
        !(grep { m/rotate-lockbox-keys|rotate-admin-key/ } $open->{next}->@*),
        'so neither is offered',
    );
    ok((grep { m/rotate-all-storage-keys/ } $open->{next}->@*), 'while the one still on aes is');
}

{
    my $checks = {
        AUTH_INSECURE_CLIENT_KEY_TYPE => {
            detail => [{ message => 'entity client.removed using insecure key type: aes' }],
        },
        AUTH_INSECURE_KEYS_ALLOWED => {},
    };
    my $stores = { 'client.store' => ['data'] };
    my $exported = { 'client.store' => { key => $OLD } };
    my $clients = classify_insecure_clients($checks, $stores, $exported);
    is_deeply($clients->{storage}, ['client.store'], 'the export discovers an unreported old key');
    is_deeply($clients->{other}, [], 'a complete export drops a removed health-check entity');
    is_deeply(
        classify_insecure_clients($checks, $stores)->{other},
        ['client.removed'],
        'health remains the fallback when no export is available',
    );
    is_deeply(
        classify_insecure_clients($checks, $stores, {})->{other},
        [],
        'a complete empty export does not reuse stale health entries',
    );
    my $info = {
        exported => $exported,
        pve_mon_key => $NEW,
        sessions => { complete => 1, clients => {} },
        service_cipher => $CIPHER,
        preferred_cipher => $CIPHER,
        allowed_ciphers => ['aes', $CIPHER],
    };
    my $open = open_actions('/helper', {}, {}, $stores, $CIPHER, {}, $info);
    ok(
        scalar(grep { m/^--rotate-all-storage-keys:/ } $open->{next}->@*),
        'the helper offers an old managed key before health catches up',
    );
    $info->{exported}->{'client.store'}->{key} = $NEW;
    $open = open_actions('/helper', {}, {}, $stores, $CIPHER, {}, $info);
    like($open->{next}->[0], qr/^--restrict-ciphers:/, 'actual mixed ciphers offer restriction');
    $info->{allowed_ciphers} = [$CIPHER];
    $open = open_actions('/helper', $checks, {}, $stores, $CIPHER, {}, $info);
    is_deeply($open->{next}, [], 'stale health does not offer already completed work');
    $info->{preferred_cipher} = 'aes';
    $open = open_actions('/helper', {}, {}, $stores, $CIPHER, {}, $info);
    like(
        $open->{next}->[0],
        qr/^--restrict-ciphers:/,
        'an old creation default still needs finishing',
    );
}

{
    my $user = 'client.admin';
    my $state = {
        client_refresh => { $user => { session_ids => [7] } },
        staged => {
            $user => {
                key => key_fingerprint($NEW),
                written => 1,
                aborting => 1,
                abort_written => 1,
                abort_key => key_fingerprint($OLD),
            },
        },
    };
    my $auth = { $user => { key => $OLD, pending_key => $NEW } };
    for my $case (
        ['restored', key_fingerprint($OLD), qr/visible sessions use the restored key/],
        ['pending', key_fingerprint($NEW), qr/1 session\(s\) still use the staged key/],
        ['unknown', undef, qr/1 session\(s\) have no key fingerprint.*19\.2\.6-pve4/s],
        ['other', key_fingerprint('unrelated'), qr/1 session\(s\) use an unexpected key/],
    ) {
        my ($name, $fp, $expected) = @$case;
        my $sessions = {
            complete => 1,
            clients =>
                { $user => [{ global_id => 7, host => 'node-a', key_fingerprint => $fp }] },
        };
        my $open = open_options({}, {}, {}, $CIPHER, $state, $sessions, $auth);
        my $text = $open->{waiting_details}->{$user};
        like($text, $expected, "$name rollback sessions have direction-specific guidance");
        unlike(
            $text,
            qr/Refresh clients/,
            'unknown sessions need identification, not another refresh',
        ) if $name eq 'unknown';
        unlike(
            $text,
            qr/--confirm-clients-refreshed|previous key/,
            'rollback never offers promotion',
        );
        is_deeply($open->{ready}, [], 'reverse refresh never joins forward confirmations');
        is(
            scalar(@{ $open->{waiting_sessions}->{$user} // [] }),
            $name eq 'restored' ? 0 : 1,
            'only unresolved reverse sessions contribute consumer hints',
        );
    }
    my $changed = open_options(
        {},
        {},
        {},
        $CIPHER,
        $state,
        { complete => 1, clients => {} },
        { $user => { key => 'changed-key', pending_key => $NEW } },
    );
    like(
        $changed->{waiting_details}->{$user},
        qr/active key changed after rollback preparation/,
        'a changed active key is not described as the restored credential',
    );
    unlike(
        $changed->{waiting_details}->{$user},
        qr/confirm-abort-clients-refreshed/,
        'changed managed credentials need reconciliation before a retirement command',
    );
    delete $state->{staged}->{$user}->{abort_key};
    my $unknown_copy = open_options(
        {}, {}, {}, $CIPHER, $state, { complete => 1, clients => {} }, $auth,
    );
    like(
        $unknown_copy->{waiting_details}->{$user},
        qr/rollback preparation is incomplete/,
        'missing restored-key evidence does not establish prepared rollback',
    );
    $state->{staged}->{$user}->{abort_key} = key_fingerprint($OLD);

    my $partial = open_options(
        {},
        {},
        {},
        $CIPHER,
        $state,
        { complete => 0, clients => {}, unanswered => ['mon-b'] },
        $auth,
    );
    like(
        $partial->{waiting_details}->{$user},
        qr/incomplete.*mon-b/s,
        'rollback reports incomplete collection instead of readiness',
    );
    $state->{mount_refresh}->{$user} = {
        pending => { cephfs => { tre => { phase => 'remount' } } },
    };
    my $mount = open_options({}, {}, {}, $CIPHER, $state, { complete => 1, clients => {} }, $auth);
    like(
        $mount->{waiting_details}->{$user},
        qr/cephfs.*tre.*[Ff]ree busy mounts.*--apply/s,
        'queued rollback mounts name the storage, node, and action before retry',
    );
}

{
    my $info = {
        exported => { 'mon.' => { key => $NEW }, 'client.admin' => { key => $NEW } },
        pve_mon_key => $NEW,
        sessions => { complete => 1, clients => {} },
        service_cipher => $CIPHER,
        preferred_cipher => $CIPHER,
        allowed_ciphers => [$CIPHER],
    };
    ok(
        open_actions('/helper', {}, {}, {}, $CIPHER, {}, $info)->{complete},
        'complete current state permits a migration completion summary',
    );
    for my $case (
        ['missing auth', { exported => undef }],
        ['unknown session collection', { sessions => { complete => 0, clients => {} } }],
        ['old creation default', { preferred_cipher => 'aes' }],
        [
            'untracked old-key session',
            {
                sessions => {
                    complete => 1,
                    clients => {
                        'client.admin' =>
                            [{ global_id => 77, key_fingerprint => key_fingerprint($OLD) }],
                    },
                },
            },
        ],
        [
            'session without an auth entry',
            {
                sessions => {
                    complete => 1,
                    clients => {
                        'client.removed' =>
                            [{ global_id => 78, key_fingerprint => key_fingerprint($NEW) }],
                    },
                },
            },
        ],
        ['unknown allowed ciphers', { allowed_ciphers => [] }],
        [
            'foreign pending key',
            { exported => { 'client.admin' => { key => $NEW, pending_key => $NEW } } },
        ],
    ) {
        my ($name, $changes) = @$case;
        ok(
            !open_actions('/helper', {}, {}, {}, $CIPHER, {}, { %$info, %$changes })->{complete},
            "$name prevents a completion claim",
        );
    }
    for my $state (
        { staged => { 'client.admin' => { key => key_fingerprint($NEW) } } },
        { client_refresh => { 'client.admin' => { session_ids => [] } } },
        { rotated => { 'osd.0' => 1 } },
        { preferred_cipher_was => 'aes' },
        { client_grace => {} },
        { lockbox => { 'client.osd-lockbox.x' => {} } },
    ) {
        ok(
            !open_actions('/helper', {}, {}, {}, $CIPHER, $state, $info)->{complete},
            'unfinished work prevents a completion claim',
        );
    }
}

# Restriction reports the same prerequisite as the ordinary status view without changing guards.
{
    my $entity = 'client.admin';
    my $target = key_fingerprint($NEW);
    my $info = {
        exported => { $entity => { key => $OLD, pending_key => $NEW } },
        service_cipher => $CIPHER,
        pve_mon_key => $NEW,
        health_checks => {},
        sessions => {
            complete => 1,
            clients => {
                $entity => [
                    map {
                        { global_id => $_, host => 'mits8', key_fingerprint => $target }
                    } 1 .. 64
                ],
            },
        },
    };
    my $state = {
        staged => { $entity => { key => $target, written => 1 } },
        client_refresh => { $entity => { rotated => 1, session_ids => [] } },
    };
    my $files = { $entity => [{ format => 'secret', store => 'cephfs' }] };
    my $unchanged = dclone($state);
    my @described;
    my $describe = sub { push @described, @{ $_[0] }; return session_hosts($_[0]); };
    my $blockers = restrict_blockers($info, $state, $describe, $files);
    my $open = open_options(
        {}, {}, {}, $CIPHER, dclone($state), $info->{sessions}, $info->{exported}, $files,
    );
    is_deeply(
        $blockers,
        ["'$entity': $open->{waiting_details}->{$entity}"],
        'both views give exactly the same pending inspection and next action',
    );
    like(
        $blockers->[0],
        qr/CephFS mounts need inspection: cephfs.*--apply.*inspect and refresh/,
        'restriction points to inspection rather than premature confirmation',
    );
    unlike(
        $blockers->[0],
        qr/Free busy mounts|--confirm-clients-refreshed|64 live/,
        'unperformed inspection is not an observed busy mount or a confirmation opportunity',
    );
    is_deeply($state, $unchanged, 'deriving the explanation does not change the journal');
    is(scalar(@described), 0, 'current-key sessions do not trigger possible-consumer inventories');

    $state->{mount_refresh}->{$entity} = {
        target => $target,
        pending => { cephfs => { mits8 => 1 } },
    };
    $blockers = restrict_blockers($info, $state, $describe, $files);
    like(
        $blockers->[0],
        qr/CephFS refresh pending: 'cephfs' on node 'mits8'.*--apply/,
        'recorded mount work identifies the storage and node',
    );

    $state->{mount_refresh}->{$entity} = { target => $target, finished => 1 };
    $blockers = restrict_blockers($info, $state, $describe, $files);
    is(scalar(@$blockers), 1, 'completed mount work does not implicitly confirm the staged key');
    like(
        $blockers->[0],
        qr/awaits your confirmation.*--confirm-clients-refreshed client.admin --apply/,
        'a ready record gets the explicit confirmation action',
    );
    unlike(
        $blockers->[0],
        qr/64|mits8|refresh those|inspection/,
        'connected sessions are not mistaken for remaining refresh work',
    );
    is(scalar(@described), 0, 'no host-wide hints are requested just because sessions exist');

    $info->{storage_copy_problems} =
        { $entity => ['Cannot retire: managed storage still has the old key.'] };
    $blockers = restrict_blockers($info, $state, $describe, $files);
    like(
        $blockers->[0],
        qr/managed storage still has the old key/,
        'restriction includes storage readiness',
    );
    unlike(
        $blockers->[0],
        qr/--confirm-clients-refreshed/,
        'restriction does not offer a refused confirmation',
    );
    delete $info->{storage_copy_problems};

    $info->{sessions}->{clients}->{$entity}->[0]->{key_fingerprint} = key_fingerprint($OLD);
    $blockers = restrict_blockers($info, $state, $describe, $files);
    like(
        $blockers->[0],
        qr/1 session\(s\) still authenticate with a previous key/,
        'positive stale evidence is reported as one stale session, not 64 consumers',
    );
    is(scalar(@described), 1, 'only the stale subset supplies consumer hints');
    $info->{sessions}->{clients}->{$entity}->[0]->{key_fingerprint} = $target;

    $info->{sessions}->{complete} = 0;
    $info->{sessions}->{unanswered} = ['mon-b'];
    $blockers = restrict_blockers($info, $state, $describe, $files);
    like(
        join(' ', @$blockers),
        qr/client verification is incomplete.*mon-b/,
        'restriction distinguishes incomplete observation from missing confirmation',
    );
    $info->{sessions}->{complete} = 1;
    delete $state->{client_refresh}->{$entity}->{session_ids};
    $blockers = restrict_blockers($info, $state, $describe, $files);
    like(
        $blockers->[0],
        qr/first complete client measurement.*first attempt records/,
        'a missing measurement does not look ready for retirement',
    );
}

{
    my $target = key_fingerprint($NEW);
    my $sessions = {
        complete => 1,
        clients => {
            'client.app' => [
                { global_id => 1, key_fingerprint => $target },
                { global_id => 2, key_fingerprint => $target },
                { global_id => 3, key_fingerprint => key_fingerprint($OLD) },
                { global_id => 4 },
            ],
        },
        observations => [{
            clients => {
                'client.app' => [
                    { global_id => 5, key_fingerprint => key_fingerprint($OLD) },
                    { global_id => 6, key_fingerprint => $target },
                ],
            },
        }],
    };
    my $record = { session_ids => [1], measurement_incomplete => 1 };
    my $merged = PVE::Ceph::KeyMigration::merge_refresh_record(
        $record, $sessions, 'client.app', 1, undef, $target,
    );
    is_deeply(
        $merged->{session_ids},
        [1, 3, 4, 5],
        'record old and unknown observations, but not newly observed target-key sessions',
    );
    is_deeply(
        $record,
        { session_ids => [1], measurement_incomplete => 1 },
        'merging does not modify the original record',
    );
    ok(!$merged->{measurement_incomplete}, 'a complete sweep completes the measurement');
    is_deeply(
        [
            map { $_->{global_id} } @{
                stale_consumers(
                    $sessions,
                    { 'client.app' => $merged },
                    { 'client.app' => $target },
                )->{'client.app'}
            }
        ],
        [3, 4],
        'a matching fingerprint supersedes a retained ID without erasing it',
    );
    my $unidentified = PVE::Ceph::KeyMigration::merge_refresh_record(
        undef, $sessions, 'client.app', 1,
    );
    is_deeply($unidentified->{session_ids}, [1 .. 6], 'without a target, every observation counts');
}

{
    my $state = { client_refresh => { 'client.app' => { session_ids => [1] } } };
    my $info = {
        exported => { 'client.app' => { key => $NEW } },
        sessions => {
            complete => 1,
            clients => {
                'client.app' => [{
                    global_id => 1,
                    host => '192.0.2.1',
                }],
            },
        },
    };
    my $described;
    my $open = open_actions(
        '/helper',
        {},
        {},
        {},
        $CIPHER,
        $state,
        $info,
        sub {
            $described = $_[0];
            return 'node-a: 1';
        },
    );
    is_deeply(
        [map { $_->{global_id} } @$described],
        [1],
        'next steps pass only the stale subset to the node-label formatter',
    );
    like(
        $open->{waiting_details}->{'client.app'},
        qr/\(node-a: 1\)/,
        'next-step waiting details use the same node labels as restriction refusals',
    );
    like(
        $open->{waiting_details}->{'client.app'},
        qr/then rerun without options\./,
        'refresh guidance selects a fresh status check instead of repeating old options',
    );
}

{
    my $target = key_fingerprint($NEW);
    my $refresh = { 'client.vm' => { session_ids => [100] } };
    for my $case (
        ['new unknown session while staged', 1, [{ global_id => 900 }], 'unidentified'],
        [
            'empty fingerprint while staged',
            1,
            [{ global_id => 900, key_fingerprint => '' }],
            'unidentified',
        ],
        [
            'target-key session while staged',
            1,
            [{ global_id => 100, key_fingerprint => $target }],
            'accept',
        ],
        [
            'conflicting observations while staged',
            1,
            [{ global_id => 900, key_fingerprint => $target }, { global_id => 900 }],
            'unidentified',
        ],
        ['disconnected staged user', 1, [], 'accept'],
        ['new session after immediate replacement', 0, [{ global_id => 900 }], 'accept'],
        [
            'recorded session after immediate replacement',
            0,
            [{ global_id => 100 }],
            'connected',
        ],
    ) {
        my ($name, $staged, $live, $expected) = @$case;
        my $state = {
            client_refresh => $refresh,
            staged => $staged ? { 'client.vm' => { key => $target, written => 1 } } : {},
        };
        my $sessions = { complete => 1, clients => { 'client.vm' => $live } };
        my $stale = stale_consumers($sessions, $refresh, { 'client.vm' => $target });
        is(ack_decision('client.vm', $state, $sessions, $stale)->{verdict}, $expected, $name);
    }
}

{
    my $orphan = 'client.osd-lockbox.orphan';
    my $live = 'client.osd-lockbox.live';
    my $info = {
        exported => { $orphan => { key => $OLD } },
        lockbox => { $orphan => { orphaned => 1 } },
        sessions => { complete => 1, clients => {} },
        service_cipher => $CIPHER,
        pve_mon_key => $NEW,
        preferred_cipher => $LEGACY_CIPHER,
        allowed_ciphers => [$LEGACY_CIPHER, $CIPHER],
    };
    my $open = open_actions('helper', {}, {}, {}, $CIPHER, {}, $info);
    is_deeply(
        $open->{orphaned_lockbox},
        [$orphan],
        'orphaned old lockbox keys have their own action',
    );
    is_deeply($open->{next}, [], 'an orphan alone is not offered lockbox rotation or restriction');
    ok(!$open->{complete}, 'an orphan alone is not migration completion');
    like(
        join(' ', restrict_blockers($info, {})->@*),
        qr/\Q$orphan\E.*no OSD.*leaves it unchanged/,
        'the restriction blocker explains why lockbox rotation cannot help',
    );

    $info->{exported}->{$live} = { key => $OLD };
    $info->{lockbox}->{$live} = { id => 1 };
    $open = open_actions('helper', {}, {}, {}, $CIPHER, {}, $info);
    like(
        join(' ', $open->{next}->@*),
        qr/--rotate-lockbox-keys/,
        'live OSD keys still get the rotation option',
    );
    is_deeply($open->{orphaned_lockbox}, [$orphan], 'mixed inventory keeps the orphan separate');

    $info->{exported}->{$orphan} = { key => $NEW };
    $open = open_actions('helper', {}, {}, {}, $CIPHER, {}, $info);
    is_deeply(
        $open->{orphaned_lockbox},
        [],
        'an orphan already using the new cipher needs no deletion',
    );
    $info->{exported}->{$orphan}->{pending_key} = $OLD;
    $open = open_actions('helper', {}, {}, {}, $CIPHER, {}, $info);
    is_deeply(
        $open->{orphaned_lockbox},
        [$orphan],
        'an orphan with an old pending key still blocks restriction',
    );
}

done_testing();
