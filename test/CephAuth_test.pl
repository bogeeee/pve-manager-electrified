#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use Test::More;
use JSON qw(encode_json decode_json);
use Storable qw(dclone);
use PVE::Ceph::Services;
use PVE::CLI::pveceph;

my $members = { map { $_ => 1 } qw(node1 node2 node1.exact) };
for my $test (
    ['node1', 'node1', 'exact member'],
    ['node1.exact', 'node1.exact', 'exact membership precedes first-label mapping'],
    ['node1.example.com', 'node1', 'member FQDN'],
    ['node2.example.com', 'node2', 'local member FQDN'],
    ['foreign.example.com', 'foreign.example.com', 'foreign FQDN'],
    ['foreign', 'foreign', 'foreign short name'],
    ['node1.foreign.invalid', 'node1', 'same-label foreign domain is a known ambiguity'],
    ['.example.com', '.example.com', 'empty first label is not a member'],
    ['', '', 'empty input remains for caller validation'],
    [undef, undef, 'undefined input remains for caller validation'],
) {
    my ($host, $expected, $name) = @$test;
    is(PVE::Ceph::Services::metadata_host_node($host, $members), $expected, $name);
}
my $invalid_host = {};
is(
    PVE::Ceph::Services::metadata_host_node($invalid_host, $members),
    $invalid_host,
    'reference input remains for caller validation, not transport',
);
is(
    PVE::Ceph::Services::metadata_host_node('node1.example.com', { node1 => 1 }),
    'node1',
    'single-node membership also maps an FQDN',
);

# The cipher landed mid-release, so $AES256K_MIN_CEPH_RELEASE has to answer per major and
# not just compare against one minimum. Both the full 'ceph versions' string and the bare
# 'ceph_version_short' of the daemon metadata reach ceph_version_supports_aes256k(), which
# is why it accepts either.
my $versions = [
    ['19.2.6', 1, 'the squid release that added the cipher'],
    ['19.2.5', 0, 'the squid release before it'],
    ['19.2.10', 1, 'a later squid, numerically not lexically'],
    ['19.1.9', 0, 'a lower minor in the same major'],
    ['20.2.4', 1, 'the tentacle release that added the cipher'],
    ['20.2.3', 0, 'the tentacle release before it'],
    ['20.3.0', 1, 'a higher minor in the same major'],
    ['18.2.7', 0, 'reef never got the cipher'],
    ['21.0.0', 1, 'a major past every known one always carries it'],
    ['20.2', 0, 'a missing patch level counts as zero'],
    ['ceph version 19.2.6 (0000) squid (stable)', 1, 'the full version string'],
    ['ceph version 19.2.5 (0000) squid (stable)', 0, 'the full string of an older release'],
    ['19.2.6-124-gabcdef', 1, 'a dev build judged by the release in front of the suffix'],
    ['', undef, 'an empty string is unknown, not a no'],
    [undef, undef, 'an undefined version is unknown, not a no'],
    ['garbage', undef, 'an unparsable version is unknown, not a no'],
];

for my $test (@$versions) {
    my ($version, $expected, $name) = @$test;
    is(PVE::Ceph::Services::ceph_version_supports_aes256k($version), $expected, $name);
}

my $kernels = [
    ['7.0.14-2-pve', 1, 'the first kernel with support, as uname reports it'],
    ['6.14.11-1-pve', 0, 'a 6.14 kernel, which must not compare as newer than 7.0'],
    ['6.9', 0, 'a single digit minor, which a string compare would get wrong'],
    ['10.1.0', 1, 'a two digit major'],
    ['', undef, 'an empty release is unknown, not a no'],
    [undef, undef, 'an undefined release is unknown, not a no'],
];

for my $test (@$kernels) {
    my ($release, $expected, $name) = @$test;
    is(PVE::Ceph::Services::kernel_supports_aes256k($release), $expected, $name);
}

{

    package FakeRados;

    sub new {
        my ($class, $replies, $fail) = @_;
        return bless { replies => $replies, fail => $fail // {}, commands => [] }, $class;
    }

    sub mon_command {
        my ($self, $cmd) = @_;
        my $prefix = $cmd->{prefix};
        push $self->{commands}->@*, $prefix;
        die "$prefix unavailable\n" if $self->{fail}->{$prefix};
        die "unexpected command $prefix\n" if !exists($self->{replies}->{$prefix});
        return $self->{replies}->{$prefix};
    }

    sub mon_cmd { my $self = shift; return $self->mon_command(@_); }
}

my $secret = 'AQ-this-must-not-be-displayed';
my $key = sub {
    my ($entity, $current, $pending) = @_;
    my ($type, $id) = split(/\./, $entity, 2);
    return {
        entity => { type_str => $type, id => $id },
        auth => {
            key => { defined($current) ? (type_str => $current) : (), secret => $secret },
            defined($pending)
            ? (pending_key => { type_str => $pending, secret => $secret })
            : (),
        },
    };
};
my $base = {
    health => { checks => {} },
    'mon dump' => {
        auth_service_cipher => { name => 'aes256k' },
        auth_preferred_cipher => { name => 'aes256k' },
        auth_allowed_ciphers => [{ name => 'aes256k' }],
    },
    versions => {
        map {
            $_ => { 'ceph version 20.2.4 (0000) tentacle (stable)' => ($_ eq 'osd' ? 18 : 3) }
        } qw(mon mgr osd mds)
    },
    quorum_status => {
        quorum_names => [qw(mits6 mits7 mits8)],
        features => { quorum_mon => ['cephx_auth_aes256k'] },
    },
    'auth dump-keys' => {
        data => { secrets => [$key->('client.admin', 'aes256k'), $key->('osd.0', 'aes256k')] },
    },
    'mon metadata' =>
        [map { { hostname => $_, kernel_version => '7.0.14-16-pve' } } qw(mits6 mits7 mits8)],
    map { ("$_ metadata" => []) } qw(mgr mds osd),
};
my $collect = sub {
    my ($replies, $fail) = @_;
    my $rados = FakeRados->new($replies // dclone($base), $fail);
    no warnings 'redefine';
    local *PVE::Cluster::get_nodelist = sub { [qw(mits6 mits7 mits8)] };
    local *PVE::INotify::nodename = sub { 'mits8' };
    local *POSIX::uname = sub { ('Linux', 'mits8', '7.0.14-16-pve') };
    my $status = PVE::Ceph::Services::get_cephx_auth_status($rados);
    return wantarray ? ($status, $rados->{commands}) : $status;
};
my $render = sub {
    my ($data, $format) = @_;
    my $out = '';
    open(my $stdout, '>', \$out) or die $!;
    local *STDOUT = $stdout;
    PVE::CLI::pveceph::format_auth_status($data, {}, { 'output-format' => $format // 'text' });
    return $out;
};
my $conclusions = sub { join("\n", $_[0]->{conclusion}->@*) };
my $helper = '/usr/share/pve-manager/migrations/pve-cephx-rotate-service-keys';

my $expected_reads = [
    sort (
        'health',
        'mon dump',
        'versions',
        'quorum_status',
        'auth dump-keys',
        'mon metadata',
        'mgr metadata',
        'mds metadata',
        'osd metadata',
    ),
];
my ($current, $commands) = $collect->();
is_deeply(
    [sort @$commands],
    $expected_reads,
    'status collects auth, health, quorum, versions, and every daemon role without workload probes',
);
my $current_text = $render->($current);
like(
    $current_text,
    qr/All listed current keys use aes256k; no pending keys reported\./,
    'current keys receive a scoped all-current statement',
);
unlike($current_text, qr/client\.admin|osd\.0/, 'healthy identity names do not crowd the output');
like($current_text, qr/service: 1 aes256k\n  client: 1 aes256k/,
    'healthy groups have exact counts');
like($current_text, qr/not guests, mounts, or sessions/, 'counts are not workload counts');
like($current_text, qr/none active/, 'a successful empty health read says none active');
unlike(
    $current_text,
    qr/--rotate-|--restrict|migration complete|clients (?:are )?refreshed/,
    'current keys do not imply further rotations, restriction safety, or refreshed clients',
);
like($current_text, qr/^  \Q$helper\E$/m, 'the all-current helper readiness command is standalone');
like(
    $current_text,
    qr/20\.2\.4 - supports aes256k: 3 mon, 3 mgr, 18 osd, 3 mds/,
    'identical daemon versions keep per-role counts without repeated support claims',
);
like($current_text, qr/members: mits6, mits7, mits8/, 'quorum members remain visible');
like(
    $current_text,
    qr/mits6: 7\.0\.14-16-pve \(at Ceph daemon start\)/,
    'remote kernel evidence keeps its version and provenance',
);
like($current_text, qr/mits8: 7\.0\.14-16-pve \(uname\)/, 'local uname overrides metadata');
is(
    $current->{nodes}->{mits6}->{source},
    'ceph daemon metadata',
    'JSON retains the original kernel source label',
);
unlike(
    $current_text,
    qr/Keys needing attention/,
    'a complete healthy inventory needs no empty exception section',
);

my $fresh_replies = dclone($base);
$fresh_replies->{'auth dump-keys'}->{data}->{secrets} = [
    (map { $key->("osd.$_", 'aes') } 0 .. 17),
    (map { $key->("client.storage$_", 'aes') } 1 .. 12),
];
$fresh_replies->{'mon dump'} = {
    auth_service_cipher => { name => 'aes' },
    auth_preferred_cipher => { name => 'aes' },
    auth_allowed_ciphers => [{ name => 'aes' }, { name => 'aes256k' }],
};
my $fresh = $collect->($fresh_replies);
my $fresh_text = $render->($fresh);
unlike(
    $fresh_text,
    qr/Keys needing attention|osd\.\d|client\.storage\d|more identities/,
    'homogeneous old keys are grouped without redundant names or omission claims',
);
like($fresh_text, qr/service: 18 aes\n  client: 12 aes/, 'all 30 old keys remain counted');
like(
    $fresh_text,
    qr/^  \Q$helper --rotate-cluster-keys\E$/m,
    'homogeneous old keys retain the cluster-owned preview command',
);
like(
    $fresh_text,
    qr/Listed current keys \(Ceph identities, not guests, mounts, or sessions\)/,
    'the count scope belongs to the inventory heading',
);
is(
    scalar(() = $fresh_text =~ /not guests, mounts, or sessions/g),
    1,
    'identity scope is stated once',
);
like(
    $fresh_text,
    qr/Client refresh, including disconnected clients and external copies, is not verified here/,
    'grouped old keys retain client and saved-copy limits',
);

my $mixed_replies = dclone($fresh_replies);
$mixed_replies->{'auth dump-keys'}->{data}->{secrets} = [
    $key->('osd.0', 'aes'),
    (map { $key->("osd.$_", 'aes256k') } 1 .. 17),
    $key->('client.storage1', 'aes'),
    (map { $key->("client.storage$_", 'aes256k') } 2 .. 12),
];
my $mixed = $collect->($mixed_replies);
my $mixed_text = $render->($mixed);
like(
    $mixed_text,
    qr/Keys needing attention \(2 listed identities\)\n  client\.storage1: current aes \(old\), pending none\n  osd\.0: current aes \(old\), pending none/,
    'mixed inventories name the remaining old identities',
);
like(
    $mixed_text,
    qr/service: 1 aes, 17 aes256k\n  client: 1 aes, 11 aes256k/,
    'mixed inventories preserve exact counts for both ciphers and classes',
);
unlike($mixed_text, qr/osd\.1:|client\.storage2:/, 'mixed inventories omit healthy names');

# A staged admin key can coexist with genuine ALLOWED and CREATABLE warnings.
my $admin_replies = dclone($base);
$admin_replies->{'mon dump'}->{auth_allowed_ciphers} = [{ name => 'aes' }, { name => 'aes256k' }];
$admin_replies->{'auth dump-keys'}->{data}->{secrets} = [
    $key->('client.admin', 'aes', 'aes256k'),
    (map { $key->("osd.$_", 'aes256k') } 0 .. 24),
    (
        map {
            $key->(
                sprintf('client.osd-lockbox.%08x-4a86-4fa4-b0b7-ad193ece2f24', $_),
                'aes256k',
            )
        } 1 .. 25
    ),
];
my $health_messages = {
    AUTH_INSECURE_CLIENT_KEY_TYPE => '1 auth client entities with insecure key types',
    AUTH_INSECURE_KEYS_ALLOWED =>
        'Monitors are configured to allow auth using insecure key types',
    AUTH_INSECURE_KEYS_CREATABLE =>
        'Monitors are configured to allow creation of insecure key types',
};
$admin_replies->{health}->{checks} = {
    map {
        $_ => { severity => 'HEALTH_WARN', summary => { message => $health_messages->{$_} } }
        }
        keys %$health_messages
};
my $admin = $collect->($admin_replies);
my $expected_admin = dclone($admin);
my $admin_text = $render->($admin);
is($admin->{entities}->{'pending-keys'}, 1, 'collector counts pending keys');
ok($admin->{entities}->{'pending-keys-known'}, 'collector knows the complete pending inventory');
is_deeply(
    $admin->{entities}->{details}->{'client.admin'},
    { class => 'client', 'current-cipher' => 'aes', 'pending-cipher' => 'aes256k' },
    'collector keeps safe current/pending details',
);
like(
    $admin_text,
    qr/Keys needing attention \(1 listed identity\).*client\.admin: current aes \(old\), pending aes256k/s,
    'the pending admin exception leads the report',
);
is(scalar(() = $admin_text =~ /client\.admin/g), 1, 'admin appears only once');
like(
    $admin_text,
    qr/service: 25 aes256k\n  client: 1 aes, 25 aes256k/,
    'long healthy inventories are exact counts',
);
unlike($admin_text, qr/client\.osd-lockbox\./, 'healthy UUIDs are absent from text');

for my $name (sort keys %$health_messages) {
    like(
        $admin_text,
        qr/\Q$name: $health_messages->{$name}\E/,
        "raw $name health evidence remains visible",
    );
    is_deeply(
        $admin->{checks}->{$name}->{'blocks-restart'},
        { map { $_ => 0 } qw(mon mgr osd mds) },
        'JSON restart annotations are unchanged',
    );
}
like(
    $admin_text,
    qr/auth_preferred_cipher: aes256k \(default for new keys\)/,
    'preferred cipher is labeled as a default',
);
like(
    $admin_text,
    qr/The default for new keys does not restrict which key types may be created/,
    'CREATABLE is not inferred from the preferred cipher',
);
unlike(
    $admin_text,
    qr/stale|recomputed|rolling restart/,
    'no stale-warning claim or restart reassurance',
);
like(
    $admin_text,
    qr/Continue the migration or rollback that staged it/,
    'status does not infer the staging owner or direction',
);
like(
    $admin_text,
    qr/^  \Q$helper\E$/m,
    'pending admin gets the bare helper command on its own line',
);
unlike(
    $admin_text,
    qr/--rotate-|--confirm|--abort|--restrict|auth (?:commit|clear)/,
    'pending admin gets no new rotation, promotion, rollback, or retirement command',
);

my $json = $render->($admin, 'json');
is_deeply(
    decode_json($json),
    $expected_admin,
    'JSON formatting preserves every collected field and full inventory',
);
unlike($admin_text . $json, qr/\Q$secret\E/, 'neither text nor JSON exposes key material');

# A pending daemon or unrelated client is not necessarily helper-owned, and the cipher pair
# cannot distinguish forward staging from rollback. Any pending key suppresses new selections.
for my $case (
    [
        'mixed clients',
        [$key->('client.admin', 'aes', 'aes256k'), $key->('client.store', 'aes')],
    ],
    ['pending daemon', [$key->('osd.0', 'aes256k', 'aes')]],
    ['pending current client', [$key->('client.admin', 'aes256k', 'aes256k')]],
    ['unknown owner', [$key->('client.external', 'aes', 'aes256k')]],
) {
    my ($name, $keys) = @$case;
    my $replies = dclone($base);
    $replies->{'auth dump-keys'}->{data}->{secrets} = $keys;
    my $status = $collect->($replies);
    my $text = $render->($status);
    like($text, qr/^  \Q$helper\E$/m, "$name uses the bare helper conditionally");
    like($text, qr/For a helper-managed migration/, "$name does not presume helper ownership");
    unlike(
        $text,
        qr/--rotate-|--confirm|--abort|--restrict/,
        "$name does not suggest a new selection",
    );
    like(
        $text,
        qr/client\.store: current aes \(old\), pending none/,
        'unrotated client stays visible beside pending admin',
    ) if $name eq 'mixed clients';
}

for my $case (
    ['old service tickets', [], 'aes', '--rotate-cluster-keys'],
    ['old service key', [$key->('osd.1', 'aes')], 'aes256k', '--rotate-cluster-keys'],
    [
        'old client key',
        [$key->('client.admin', 'aes')],
        'aes256k',
        '--rotate-all-storage-keys --rotate-admin-key',
    ],
) {
    my ($name, $keys, $tickets, $selection) = @$case;
    my $replies = dclone($base);
    $replies->{'auth dump-keys'}->{data}->{secrets} =
        [$key->('client.healthy', 'aes256k'), $key->('osd.0', 'aes256k'), @$keys];
    $replies->{'mon dump'}->{auth_service_cipher} = { name => $tickets };
    my $status = $collect->($replies);
    my $text = $render->($status);
    like($text, qr/^  \Q$helper $selection\E$/m, "$name gets an intact, relevant preview command");
    like(
        $text,
        qr/Service tickets still use aes, independently of the identity keys/,
        'old tickets are actionable even with all keys current',
    ) if $tickets eq 'aes';
}

my $kernel_replies = dclone($base);
$kernel_replies->{'mon metadata'} = [
    { hostname => 'mits6', kernel_version => '6.14.11-1-pve' },
    { hostname => 'mits7', kernel_version => 'unparseable' },
];
my $kernel_status = $collect->($kernel_replies);
my $kernel_text = $render->($kernel_status);
is(
    $kernel_status->{nodes}->{mits6}->{'supports-aes256k'},
    0,
    'collector recognizes old metadata kernel',
);
ok(
    !exists($kernel_status->{nodes}->{mits7}->{'supports-aes256k'}),
    'unparseable kernel support stays unknown',
);
like(
    $kernel_text,
    qr/mits6: 6\.14\.11-1-pve .*too old for aes256k kernel clients/,
    'old kernels remain concrete problems',
);
like(
    $kernel_text,
    qr/mits7: unparseable .*compatibility unknown/,
    'unknown kernel is not called old',
);
like(
    $kernel_text,
    qr/Verify uname -r on affected nodes.*does not\s+block userspace-only\s+keys/s,
    'kernel guidance has an explicit command and the correct client scope',
);

my %kernel_examples;
for my $case (
    ['old-kernel', '6.14.11-1-pve', 'old'], ['unknown-kernel', undef, 'unknown'],
) {
    my ($name, $release, $issue) = @$case;
    my $replies = dclone($base);
    $replies->{'mon metadata'}->[0] = {
        hostname => 'mits6',
        defined($release) ? (kernel_version => $release) : (),
    };
    my $status = $collect->($replies);
    my $text = $render->($status);
    $kernel_examples{$name} = $text;
    like(
        $text,
        qr/Next step\n  \* Some reported node kernels are \Q$issue\E\./,
        "$name has an explicit conclusion before the helper advice",
    );
    like(
        $text =~ s/\s+/ /gr,
        qr/Verify uname -r on affected nodes; kernel RBD\/CephFS clients need a running kernel 7\.0 or newer before key rotation/,
        "$name identifies the check and running-kernel prerequisite",
    );
    is(scalar(() = $text =~ /Verify uname -r/g), 1, "$name has no repeated kernel advice");
    like(
        $text =~ s/\s+/ /gr,
        qr/does not block userspace-only keys/,
        "$name keeps the userspace-only scope",
    );
    like(
        $text,
        defined($release)
        ? qr/mits6: 6\.14\.11-1-pve \(at Ceph daemon start\)/
        : qr/mits6: unknown \(no kernel report\) - compatibility unknown/,
        "$name retains the evidence source rather than claiming a live remote kernel check",
    );
}
like(
    $kernel_text,
    qr/Next step\n  \* Some reported node kernels are old or unknown\./,
    'combined old and unknown evidence has a scoped conclusion',
);
my $no_nodes = dclone($current);
$no_nodes->{nodes} = {};
like(
    $render->($no_nodes),
    qr/Next step\n  \* No node kernel versions were reported\./,
    'an empty node inventory is unknown, not compatible',
);
unlike(
    $current_text,
    qr/Some reported node kernels are|Verify uname -r|does not block userspace-only/,
    'supported kernel reports need no compatibility caveat',
);

my $unknown_replies = dclone($base);
$unknown_replies->{'auth dump-keys'}->{data}->{secrets} = [$key->('client.unknown', undef)];
my $unknown = $collect->($unknown_replies);
like(
    $conclusions->($unknown),
    qr/1 listed current key has an unknown cipher, not a known old cipher/,
    'unknown cipher is not counted as old',
);
unlike(
    $conclusions->($unknown),
    qr/All listed|--rotate-/,
    'unknown keys prevent an all-current verdict or selection',
);
like(
    $render->($unknown),
    qr/client\.unknown: current unknown, pending none/,
    'unknown identity is named',
);
$unknown_replies->{'auth dump-keys'}->{data}->{secrets}->[0]->{auth}->{pending_key} =
    { secret => $secret };
my $unknown_pending = $collect->($unknown_replies);
is(
    $unknown_pending->{entities}->{'pending-keys'},
    1,
    'an unrecognized pending cipher is not absence',
);
like(
    $render->($unknown_pending),
    qr/current unknown, pending unknown/,
    'unknown pending cipher remains visible',
);
like(
    $conclusions->($unknown_pending),
    qr/^\Q$helper\E$/m,
    'unknown pending cipher also routes to staging',
);
unlike(
    encode_json($unknown_pending),
    qr/\Q$secret\E/,
    'unknown current and pending ciphers do not expose their key material',
);

for my $prefix ('health', 'auth dump-keys', 'quorum_status', 'mon dump', 'versions') {
    my ($status, $commands) = $collect->(dclone($base), { $prefix => 1 });
    is_deeply(
        [sort @$commands],
        $expected_reads,
        "$prefix failure does not prevent collecting independent evidence",
    );
    my $text = $render->($status);
    if ($prefix eq 'health') {
        is($status->{'checks-known'}, 0, 'failed health read is explicit');
        like($text, qr/health checks could not be read/, 'failed health read renders unknown');
        unlike($text, qr/none active/, 'failed health read never renders none active');
    } elsif ($prefix eq 'auth dump-keys') {
        is($status->{entities}->{complete}, 0, 'failed key read marks inventory incomplete');
        ok(!$status->{entities}->{'pending-keys-known'},
            'failed key read cannot know pending keys');
        like(
            $text,
            qr/service: unknown, none named\n  client: unknown, none named/,
            'empty partial inventories are not none',
        );
        unlike(
            $text,
            qr/All listed|--rotate-/,
            'partial inventory does not select another rotation',
        );
    } elsif ($prefix eq 'quorum_status') {
        ok(
            !exists($status->{quorum}->{'supports-aes256k'}),
            'failed quorum read is not unsupported',
        );
        like($text, qr/Monitor quorum features could not be read/, 'unknown quorum is explicit');
        unlike(
            $text,
            qr/restart monitors|--rotate-/,
            'unknown quorum gets no restart or rotation advice',
        );
    } elsif ($prefix eq 'mon dump') {
        like(
            $text,
            qr/unavailable or lacks cipher settings/,
            'missing monmap is not proof of an old release',
        );
        like($text, qr/auth_service_cipher: unknown/, 'missing settings are individually unknown');
    } else {
        like($text, qr/Daemon versions are unavailable/, 'unknown daemon versions are explicit');
    }
}

my $partial_replies = dclone($base);
$partial_replies->{health}->{checks}->{AUTH_INSECURE_CLIENT_KEY_TYPE} = {
    severity => 'HEALTH_WARN',
    summary => { message => $health_messages->{AUTH_INSECURE_CLIENT_KEY_TYPE} },
    detail => [{ message => 'entity client.admin using insecure key type: aes' }],
};
my $partial = $collect->($partial_replies, { 'auth dump-keys' => 1, quorum_status => 1 });
my $partial_text = $render->($partial);
like(
    $partial_text,
    qr/client\.admin: current aes \(old\), pending unknown/,
    'health fallback preserves known old key and unknown pending state',
);
like(
    $partial_text,
    qr/source: health check detail \(partial inventory\)/,
    'fallback provenance is explicit',
);
like(
    $partial_text,
    qr/Pending keys are unknown/,
    'fallback does not mistake auth health details for staged keys',
);
like($partial_text, qr/^  pveceph auth status$/m, 'partial read gets a standalone recheck command');
my $unreadable =
    $collect->(dclone($base), { health => 1, 'auth dump-keys' => 1, quorum_status => 1 });
unlike(
    $render->($unreadable),
    qr/none active|none reported|All listed|--rotate-/,
    'simultaneous failed reads cannot produce an all-clear',
);
my $malformed = dclone($base);
$malformed->{health} = {};
$malformed->{'auth dump-keys'}->{data}->{secrets} =
    [{ entity => {} }, $key->('client.admin', 'aes', 'aes256k')];
my $malformed_status = $collect->($malformed);
ok(!$malformed_status->{'checks-known'}, 'missing checks object is not a successful health read');
ok(
    !$malformed_status->{entities}->{complete},
    'skipped malformed identity makes inventory incomplete',
);
like(
    $conclusions->($malformed_status),
    qr/^\Q$helper\E$/m,
    'observed pending key wins even in an incomplete inventory',
);

for my $version ('19.2.5', 'unparseable') {
    my $replies = dclone($base);
    $replies->{versions}->{osd} = { $version => 18 };
    my $status = $collect->($replies);
    my $text = $render->($status);
    like(
        $text,
        qr/\Q$version\E - .*: 18 osd/,
        'problematic daemon version and count remain concrete',
    );
    unlike($text, qr/--rotate-/, 'old or unknown daemon versions suppress rotation selection');
    like($text, qr/aes256k support unknown/, 'unknown daemon version is not described as known old')
        if $version eq 'unparseable';
}
my $no_feature = dclone($base);
$no_feature->{quorum_status}->{features}->{quorum_mon} = [];
my $unsupported = $collect->($no_feature);
is($unsupported->{quorum}->{'supports-aes256k'}, 0, 'known missing quorum feature is unsupported');
like(
    $conclusions->($unsupported),
    qr/upgrade\/restart monitors first/,
    'known unsupported quorum gets prerequisite advice',
);

my $many = dclone($base);
$many->{'auth dump-keys'}->{data}->{secrets} = [
    map {
        $key->(
            sprintf('client.storage%02d', $_),
            $_ == 2 ? undef : 'aes',
            $_ == 50 ? 'aes256k' : undef,
        )
    } 1 .. 50
];
my $many_status = $collect->($many);
my $before_render = dclone($many_status);
my $many_text = $render->($many_status);
like(
    $many_text,
    qr/Keys needing attention \(50 listed identities\)\n  client\.storage50:/,
    'pending identity is prioritized even when it sorts after many old keys',
);
like(
    $many_text,
    qr/client\.storage50: current aes \(old\), pending aes256k\n  client\.storage02: current unknown, pending none/,
    'unknown identity takes priority over ordinary old keys after the pending identity',
);
like(
    $many_text,
    qr/client: 49 aes, 1 unknown/,
    'large unresolved inventory keeps exact cipher counts',
);
is(scalar(() = $many_text =~ /^  client\.storage\d+: current/gm), 24, 'exception rows are bounded');
like($many_text, qr/26 more identities needing attention/, 'truncation gives an exact remainder');
like(
    $many_text,
    qr/^  pveceph auth status --output-format json-pretty$/m,
    'the full-inventory command is complete and standalone',
);
is(
    scalar(keys %{ decode_json($render->($many_status, 'json'))->{entities}->{details} }),
    50,
    'JSON preserves all unresolved identities',
);
is_deeply(
    $many_status,
    $before_render,
    'rendering a bounded exception list does not alter the collected inventory or verdicts',
);

for my $text (
    $admin_text, $current_text, $partial_text, $many_text, $fresh_text, $mixed_text,
    $kernel_text, values %kernel_examples,
) {
    cmp_ok(
        (
            sort { $b <=> $a } map { length($_) }
            grep { !m{^  (?:\[|/usr/share/pve-manager/migrations/)} } split(/\n/, $text)
        )[0],
        '<=',
        100,
        'routine text stays within 100 columns, excluding raw health evidence and commands',
    );
}

my $schema = PVE::CLI::pveceph->map_method_by_name('auth_status')->{returns};
ok($schema->{properties}->{'checks-known'}, 'CLI schema declares health availability');
for my $case (
    ['current keys', $current],
    ['pending admin', $admin],
    ['partial reads', $partial],
    ['unreadable cluster', $unreadable],
    ['unknown pending cipher', $unknown_pending],
) {
    my ($name, $status) = @$case;
    eval { PVE::JSONSchema::validate($status, $schema); };
    is($@, '', "$name: collector response matches the CLI schema");
}

# Optional rendered fixtures let reviewers inspect the same cases exercised by the tests.
if (my $dir = $ENV{CEPH_AUTH_EXAMPLE_DIR}) {
    for my $example (
        ['fresh-old', $fresh_text],
        ['mixed-old-current', $mixed_text],
        ['pending-admin', $admin_text],
        ['all-current', $current_text],
        ['partial-read', $partial_text],
        (map { [$_, $kernel_examples{$_}] } sort keys %kernel_examples),
    ) {
        open(my $fh, '>', "$dir/$example->[0].txt") or die $!;
        print {$fh} $example->[1];
        close($fh) or die $!;
    }
}

done_testing();
