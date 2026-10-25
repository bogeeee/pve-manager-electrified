#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use File::Temp qw(tempdir);
use Test::More;

use PVE::Ceph::KeyMigration qw(key_fingerprint plan_lockbox_keys);
use PVE::INotify;
use MIME::Base64;
use PVE::Tools;

our $NEW = 'AgCk941qku/sDSAAIjO5RhRv/ogXhuxccNS4DZxlXS1LUgzEGFIiY/U7IlI=';
our $OTHER = 'AgCk941qku/sDSAAIjO5RhRv/ogXhuxccNS4DZxlXS1LUgzEGFIiY/U7ImI=';
our $OLD = 'AQCP/Y5qflfDFxAAPII6O9qSA7p65js5CEJYDA==';
our $FSID = '6f0d1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';
our $ENTITY = "client.osd-lockbox.$FSID";
our $FSID2 = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';
our $ENTITY2 = "client.osd-lockbox.$FSID2";
our $NODE = PVE::INotify::nodename();

# runs from the repository root under 'make check' and from here when called directly
our $SCRIPT =
    -f './bin/pve-cephx-rotate-service-keys'
    ? './bin/pve-cephx-rotate-service-keys'
    : '../bin/pve-cephx-rotate-service-keys';
do $SCRIPT or die "could not load '$SCRIPT': " . ($@ || $!);
our $HOOKS = lockbox_test_hooks();

{

    package LockboxTestRados;

    sub new {
        my ($class, %args) = @_;
        return bless {
            auth => $args{auth},
            osds => $args{osds} // [{ osd => 7, uuid => $main::FSID }],
            pending_factory => $args{pending_factory} // $main::NEW,
            clear_fails => $args{clear_fails},
        }, $class;
    }

    sub mon_command {
        my ($self, $args) = @_;
        return { osds => [map { +{%$_} } $self->{osds}->@*] }
            if $args->{prefix} eq 'osd dump';

        my $entry = $self->{auth}->{ $args->{entity} };
        die "no auth entry for '$args->{entity}'\n" if !$entry;

        return [{%$entry}] if $args->{prefix} eq 'auth get';
        if ($args->{prefix} eq 'auth get-or-create-pending') {
            $entry->{pending_key} //= $self->{pending_factory};
            return [{%$entry}];
        }
        if ($args->{prefix} eq 'auth clear-pending') {
            die "injected clear failure\n" if $self->{clear_fails};
            delete $entry->{pending_key};
            return {};
        }
        if ($args->{prefix} eq 'auth commit-pending') {
            die "nothing pending\n" if !defined($entry->{pending_key});
            $entry->{key} = delete $entry->{pending_key};
            return {};
        }

        die "unexpected mon command '$args->{prefix}'\n";
    }
}

my $tmp = tempdir(CLEANUP => 1);
my $bindir = "$tmp/bin";
mkdir($bindir) or die "mkdir '$bindir': $!";
my $db = "$tmp/lvs";
my $lvm_log = "$tmp/lvm.log";
my $argv_log = "$tmp/lvm.argv";
my $home_log = "$tmp/lvm.home";

# The helper runs as root on OSD nodes; use the test directory for unprivileged test runs.
my $run_command = \&main::run_command;
no warnings qw(once redefine);
local *PVE::Storage::config = sub { return { ids => {} } };
local *PVE::Cluster::cfs_update = sub { };
local *PVE::Cluster::get_nodelist = sub { [$NODE] };
local *main::run_command = sub {
    my ($cmd, %param) = @_;
    $param{input} =~ s{DIR => '/run'}{DIR => '$tmp'}g if defined($param{input});
    return $run_command->($cmd, %param);
};
use warnings;
like($HOOKS->{script}, qr/DIR => '\/run'/, 'the private LVM home belongs on tmpfs');

sub write_executable {
    my ($path, $content) = @_;
    open(my $fh, '>', $path) or die "open '$path': $!";
    print {$fh} $content or die "write '$path': $!";
    close($fh) or die "close '$path': $!";
    chmod(0755, $path) or die "chmod '$path': $!";
}

write_executable(
    "$bindir/lvs",
    <<'PERL',
#!/usr/bin/perl
use strict;
use warnings;
open(my $fh, '<', $ENV{LOCKBOX_LVS_DB}) or die $!;
my @rows = map { chomp; [split(/\t/, $_, 2)] } <$fh>;
my ($path) = grep { m{^/dev/} } @ARGV;
if (defined($path)) {
    my ($row) = grep { $_->[0] eq $path } @rows;
    print "  " . ($row ? $row->[1] : '') . "\n";
} else {
    print "  $_->[0] $_->[1]\n" for @rows;
}
PERL
);

# The production helper starts the LVM shell and sends the complete command on its stdin. This
# stand-in records its arguments and that command, then applies the tag update to the fake LVM
# inventory. Like the real shell it reports a failed command on stderr and still exits zero.
write_executable(
    "$bindir/lvm",
    <<'PERL',
#!/usr/bin/perl
use strict;
use warnings;
open(my $afh, '>>', $ENV{LOCKBOX_ARGV_LOG}) or die $!;
print {$afh} join("\0", @ARGV), "\n";
close($afh) or die $!;
chomp(my $command = do { local $/; <STDIN> } // '');
open(my $lfh, '>>', $ENV{LOCKBOX_LVM_LOG}) or die $!;
print {$lfh} "$command\n";
close($lfh) or die $!;
open(my $hfh, '>>', $ENV{LOCKBOX_HOME_LOG}) or die $!;
printf {$hfh} "%s %04o\n", $ENV{HOME}, (stat($ENV{HOME}))[2] & 07777;
close($hfh) or die $!;
open(my $history, '>', "$ENV{HOME}/.lvm_history") or die $!;
print {$history} "$command\n";
close($history) or die $!;
print "\n";
my @args = split(/ /, $command);
die "not lvchange\n" if shift(@args) ne 'lvchange';
my (@delete, $add, $path);
while (@args) {
    my $arg = shift @args;
    if ($arg eq '--deltag') {
        push @delete, shift @args;
    } elsif ($arg eq '--addtag') {
        $add = shift @args;
    } else {
        $path = $arg;
    }
}
die "incomplete command\n" if !defined($add) || !defined($path);
if ($ENV{LOCKBOX_LVM_FAIL}) {
    # Exceed the pipe capacity while stdout is still open; a regression must not hang the test.
    alarm(10);
    print STDERR 'x' x 131072, "\n";
    alarm(0);
    print STDERR "  Failed to remove tag $_ from vg/osd-block\n" for @delete;
    print STDERR "  Failed to add tag $add to vg/osd-block\n";
    exit(0);
}
open(my $in, '<', $ENV{LOCKBOX_LVS_DB}) or die $!;
my @rows = <$in>;
close($in) or die $!;
for my $row (@rows) {
    chomp $row;
    my ($lv, $tags) = split(/\t/, $row, 2);
    next if $lv ne $path;
    my %delete = map { $_ => 1 } @delete;
    my @tags = grep { !$delete{$_} } split(/,/, $tags // '');
    push @tags, $add if !grep { $_ eq $add } @tags;
    $row = "$lv\t" . join(',', @tags);
}
open(my $out, '>', $ENV{LOCKBOX_LVS_DB}) or die $!;
print {$out} "$_\n" for @rows;
close($out) or die $!;
PERL
);

local $ENV{PATH} = "$bindir:$ENV{PATH}";
local $ENV{LOCKBOX_LVS_DB} = $db;
local $ENV{LOCKBOX_LVM_LOG} = $lvm_log;
local $ENV{LOCKBOX_ARGV_LOG} = $argv_log;
local $ENV{LOCKBOX_HOME_LOG} = $home_log;
# the stub writes history below the HOME it is given, so a helper that stops isolating the shell
# must fail here without touching the history of whoever runs the tests
mkdir("$tmp/caller-home") or die "mkdir '$tmp/caller-home': $!";
local $ENV{HOME} = "$tmp/caller-home";

sub set_rows {
    my (@rows) = @_;
    open(my $fh, '>', $db) or die "open '$db': $!";
    print {$fh} join("\t", @$_), "\n" for @rows;
    close($fh) or die "close '$db': $!";
    unlink($lvm_log, $argv_log, $home_log);
}

sub read_file {
    my ($path) = @_;
    return '' if !-f $path;
    open(my $fh, '<', $path) or die "open '$path': $!";
    return do { local $/; <$fh> }
        // '';
}

sub check_private_home {
    my ($home, $mode) = split(/ /, read_file($home_log));
    chomp($mode);
    isnt($home, $ENV{HOME}, 'the LVM shell does not use the caller home');
    is($mode, '0700', 'only the owner can access LVM history while the shell runs');
    ok(!-e $home, 'the private home and its history are removed after the shell exits');
}

sub tag_for {
    my ($path) = @_;
    open(my $fh, '<', $db) or die "open '$db': $!";
    while (my $line = <$fh>) {
        chomp $line;
        my ($lv, $tags) = split(/\t/, $line, 2);
        next if $lv ne $path;
        my ($tag) = ($tags // '') =~ m/(?:^|,)ceph\.cephx_lockbox_secret=([^,]*)/;
        return $tag;
    }
    return undef;
}

sub base_tags {
    my ($type, $key, $fsid) = @_;
    my $tags = "ceph.osd_fsid=" . ($fsid // $FSID) . ",ceph.type=$type";
    $tags .= ",ceph.cephx_lockbox_secret=$key" if defined($key);
    return $tags;
}

sub info_for {
    my ($entry) = @_;
    return {
        exported => { $ENTITY => {%$entry} },
        daemons => { osd => [{ type => 'osd', id => '7', entity => 'osd.7', node => $NODE }] },
    };
}

{
    no warnings qw(once redefine);
    local *main::file_set_contents = sub { };

    set_rows(
        ['/dev/vg/osd-db', base_tags('db', $OLD)],
        ['/dev/vg/osd-wal', base_tags('wal', $OLD)],
        ['/dev/vg/osd-block', base_tags('block', $OLD)],
    );
    my $rados = LockboxTestRados->new(auth => { $ENTITY => { key => $OLD } });
    my $info = info_for($rados->{auth}->{$ENTITY});
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 0);
    is($info->{lockbox}->{$ENTITY}->{node}, $NODE, 'a run that leaves the tags alone maps the OSD');
    ok(!exists($info->{lockbox}->{$ENTITY}->{device}), 'but does not ask its node for the tag');

    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    is(
        $info->{lockbox}->{$ENTITY}->{device},
        '/dev/vg/osd-block',
        'lockbox discovery selects the block LV when DB and WAL LVs carry the same OSD tags',
    );

    my $state = {};
    my $item = { $info->{lockbox}->{$ENTITY}->%*, entity => $ENTITY };
    eval { $HOOKS->{migrate}->($rados, $state, $item) };
    diag(
        "migration failed: $@\nLVM rows:\n" . read_file($db) . "LVM calls:\n" . read_file($lvm_log))
        if $@;
    is($@, '', 'migration completes');
    is($rados->{auth}->{$ENTITY}->{key}, $NEW, 'migration commits the staged key');
    is(tag_for('/dev/vg/osd-block'), $NEW, 'migration writes the staged key to the block LV');
    is(tag_for('/dev/vg/osd-db'), $OLD, 'migration does not mistake the DB LV for the block LV');
    my @commands = grep { length } split(/\n/, read_file($lvm_log));
    is(scalar(@commands), 1, 'the old tag is deleted and the new tag is added in one LVM call');
    like($commands[0], qr/--deltag .* --addtag /, 'the single LVM call carries both changes');
    unlike(read_file($argv_log), qr/\Q$NEW\E/, 'the lockbox key is absent from process arguments');
    ok($state->{done}->{$ENTITY}, 'successful migration records completion');
    check_private_home();

    # LVM applies '--deltag X --addtag X' as a removal, so a key the tag already holds stays put,
    # and only base64 may reach the command string the LVM shell parses
    my $node_err = '';
    my $node_script = sub {
        my ($payload, @args) = @_;
        my $out = '';
        $node_err = '';
        main::run_command(
            ['perl', '-', @args],
            input => $HOOKS->{script} . "__END__\n$payload",
            outfunc => sub { $out .= "$_[0]\n" },
            errfunc => sub { $node_err .= "$_[0]\n" },
        );
        return $out;
    };
    unlink($lvm_log, $argv_log);
    like(
        $node_script->("$NEW\n", $FSID),
        qr/^\Q$FSID\E secret=\Q$NEW\E$/m,
        'writing the key the tag holds keeps it',
    );
    ok(!-f $lvm_log, 'without touching LVM');
    set_rows(['/dev/vg/osd-block', base_tags('block', $OLD) . ",ceph.cephx_lockbox_secret=$NEW"]);
    like(
        $node_script->("$NEW\n", $FSID),
        qr/^\Q$FSID\E secret=\Q$NEW\E$/m,
        'a second tag next to the one that holds the key is removed',
    );
    my ($repair) = grep { length } split(/\n/, read_file($lvm_log));
    like(
        $repair,
        qr/--deltag ceph\.cephx_lockbox_secret=\Q$OLD\E --addtag/,
        'by deleting the other',
    );
    unlike($repair, qr/--deltag ceph\.cephx_lockbox_secret=\Q$NEW\E/, 'and not the key itself');
    # LVM names the whole tag in some of its errors, and its shell reports them without a failing
    # exit status, so the re-read of the tag is what fails the write
    {
        local $ENV{LOCKBOX_LVM_FAIL} = 1;
        set_rows(['/dev/vg/osd-block', base_tags('block', $OLD)]);
        eval { $node_script->("$NEW\n", $FSID) };
        like($@, qr/exit code/, 'an LVM failure fails the write');
        cmp_ok(length($node_err), '>', 131072, 'large stderr is drained while stdout stays open');
        like(
            $node_err,
            qr/does not hold the requested key/,
            'caught by re-reading the tag, not by the shell exit status',
        );
        like(
            $node_err,
            qr/Failed to add tag ceph\.cephx_lockbox_secret=<key>/,
            'and its error comes back',
        );
        unlike($node_err, qr/\Q$NEW\E|\Q$OLD\E/, 'without either key in it');
        is(tag_for('/dev/vg/osd-block'), $OLD, 'the tag is as it was');
        check_private_home();

        my $tags = base_tags('block', 'QUJD') . ',ceph.cephx_lockbox_secret=QUJDREVG';
        set_rows(['/dev/vg/osd-block', $tags]);
        eval { $node_script->("$NEW\n", $FSID) };
        unlike($node_err, qr/QUJD|REVG/, 'a tag that prefixes another leaves no tail in the clear');
    }
    set_rows(['/dev/vg/osd-block', base_tags('block', $NEW)]);
    eval { $node_script->("not base64!\n", $FSID) };
    like($@, qr/exit code/, 'a value that is not base64 is refused before LVM sees it');
    is(tag_for('/dev/vg/osd-block'), $NEW, 'and the tag is untouched');
    my $short = MIME::Base64::encode_base64(substr(MIME::Base64::decode_base64($NEW), 0, -1), '');
    for my $value ('Z2FyYmFnZQ==', $short, $OLD =~ s/^AQ/Aw/r) {
        eval { $node_script->("$value\n", $FSID) };
        like($node_err, qr/not a cephx key/, "'$value' is not a cephx key");
    }
    is(tag_for('/dev/vg/osd-block'), $NEW, 'and the tag is still untouched');
    my $raw = MIME::Base64::decode_base64($OLD);
    my $spare = MIME::Base64::encode_base64(
        substr($raw, 0, 10) . pack('v', 17) . substr($raw, 12) . 'X', '',
    );
    like(
        $node_script->("$spare\n", $FSID),
        qr/^\Q$FSID\E secret=\Q$spare\E$/m,
        'an aes key with a spare byte is a key, ceph takes any length from 16 up',
    );

    set_rows(['/dev/vg/osd-block', base_tags('block', undef)]);
    $rados = LockboxTestRados->new(
        auth => { $ENTITY => { key => $OLD, pending_key => $NEW } },
    );
    $info = info_for($rados->{auth}->{$ENTITY});
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    is($info->{lockbox}->{$ENTITY}->{tag_count}, 0, 'a missing tag remains a repairable fact');
    ok(!$info->{lockbox}->{$ENTITY}->{missing}, 'a missing tag is not confused with a missing LV');
    my $planned = plan_lockbox_keys($info, { 'rotate-lockbox-keys' => 1 });
    is(scalar(@$planned), 1, 'an OSD with no lockbox tag is included in the repair plan');

    $state = {
        lockbox => {
            $ENTITY => {
                phase => 'staged',
                key => key_fingerprint($NEW),
                node => $NODE,
                fsid => $FSID,
            },
        },
    };
    ok($HOOKS->{resume}->($rados, $state, $info),
        'resume repairs a tag missing after interruption');
    is(tag_for('/dev/vg/osd-block'), $OLD,
        'resume restores the verified active key after clearing');
    ok(!defined($rados->{auth}->{$ENTITY}->{pending_key}), 'resume clears the owned staged key');
    ok(!$state->{lockbox}->{$ENTITY}, 'resume removes its journal only after verification');

    set_rows(['/dev/vg/osd-block', base_tags('block', $OTHER)]);
    $rados = LockboxTestRados->new(
        auth => { $ENTITY => { key => $OLD, pending_key => $OTHER } },
    );
    $info = info_for($rados->{auth}->{$ENTITY});
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    $state = {
        lockbox => {
            $ENTITY => {
                phase => 'written',
                key => key_fingerprint($NEW),
                node => $NODE,
                fsid => $FSID,
            },
        },
    };
    eval { $HOOKS->{resume}->($rados, $state, $info) };
    like($@, qr/not the one an earlier run .* staged/s, 'resume refuses a foreign pending key');
    is($rados->{auth}->{$ENTITY}->{pending_key}, $OTHER, 'the foreign pending key is untouched');
    ok($state->{lockbox}->{$ENTITY}, 'the journal remains after the ownership refusal');

    $state->{lockbox}->{$ENTITY} = { phase => 'staging', node => $NODE, fsid => $FSID };
    eval { $HOOKS->{resume}->($rados, $state, $info) };
    like($@, qr/has no fingerprint/, 'staging intent alone does not claim a pending key');

    set_rows(['/dev/vg/osd-block', base_tags('block', $OLD)]);
    $rados = LockboxTestRados->new(
        auth => { $ENTITY => { key => $OLD, pending_key => $OTHER } },
    );
    $state = {};
    eval {
        $HOOKS->{migrate}->(
            $rados,
            $state,
            { entity => $ENTITY, node => $NODE, fsid => $FSID, device => '/dev/vg/osd-block' },
        );
    };
    like($@, qr/a pending key already exists/, 'migration refuses a pending key without a journal');
    is_deeply($state, {}, 'the refusal happens before migration state is created');

    $rados = LockboxTestRados->new(
        auth => { $ENTITY => { key => $NEW } },
        pending_factory => $OLD,
        clear_fails => 1,
    );
    $state = {};
    eval {
        $HOOKS->{migrate}->(
            $rados,
            $state,
            { entity => $ENTITY, node => $NODE, fsid => $FSID, device => '/dev/vg/osd-block' },
        );
    };
    like($@, qr/clearing it failed/, 'a wrong-cipher pending key reports a failed cleanup');
    ok($state->{lockbox}->{$ENTITY}, 'failed cleanup retains the ownership fingerprint');
    is(
        $state->{lockbox}->{$ENTITY}->{key},
        key_fingerprint($OLD),
        'the retained journal identifies the pending key',
    );

    set_rows(
        ['/dev/vg/osd-block-a', base_tags('block', $OLD)],
        ['/dev/vg/osd-block-b', base_tags('block', $OLD)],
    );
    $rados = LockboxTestRados->new(auth => { $ENTITY => { key => $OLD } });
    $info = info_for($rados->{auth}->{$ENTITY});
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    like(
        $info->{lockbox}->{$ENTITY}->{missing},
        qr/several block devices/,
        'discovery refuses an ambiguous block-LV mapping',
    );

    set_rows(['/dev/vg/osd-block', base_tags('block', 'bad;quit')]);
    $info = info_for($rados->{auth}->{$ENTITY});
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    like(
        $info->{lockbox}->{$ENTITY}->{missing},
        qr/malformed lockbox tag/,
        'discovery refuses a tag the LVM shell could parse as command syntax, before staging',
    );

    # two encrypted OSDs on one node are asked about in one go, and one that no OSD in the map
    # claims any more is kept apart from those whose device cannot be found
    set_rows(
        ['/dev/vg/osd-block-a', base_tags('block', $OLD)],
        ['/dev/vg/osd-block-b', base_tags('block', $NEW, $FSID2)],
    );
    $rados = LockboxTestRados->new(
        auth => { $ENTITY => { key => $OLD }, $ENTITY2 => { key => $NEW } },
        osds => [{ osd => 7, uuid => $FSID }, { osd => 8, uuid => $FSID2 }],
    );
    $info = {
        exported => { map { $_ => { $rados->{auth}->{$_}->%* } } ($ENTITY, $ENTITY2) },
        daemons => {
            osd => [
                { type => 'osd', id => '7', entity => 'osd.7', node => $NODE },
                { type => 'osd', id => '8', entity => 'osd.8', node => $NODE },
            ],
        },
    };
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    is($info->{lockbox}->{$ENTITY}->{device}, '/dev/vg/osd-block-a', 'the first OSD is found');
    is($info->{lockbox}->{$ENTITY2}->{device}, '/dev/vg/osd-block-b', 'and so is the second');
    ok($info->{lockbox}->{$ENTITY2}->{tag_matches}, 'each is compared with its own auth entry');
    $planned = plan_lockbox_keys($info, { 'rotate-lockbox-keys' => 1 });
    is_deeply([map { $_->{entity} } @$planned], [$ENTITY], 'only the legacy one is planned');

    $rados = LockboxTestRados->new(auth => { $ENTITY => { key => $OLD } }, osds => []);
    $info = info_for($rados->{auth}->{$ENTITY});
    $info->{lockbox} = $HOOKS->{collect}->($rados, $info, 1);
    ok($info->{lockbox}->{$ENTITY}->{orphaned}, 'an entry no OSD claims is an orphan');
    ok(!$info->{lockbox}->{$ENTITY}->{missing}, 'not a device that could not be located');
    is_deeply(
        plan_lockbox_keys($info, { 'rotate-lockbox-keys' => 1 }),
        [],
        'and nothing is planned for it',
    );
}

{
    no warnings qw(once redefine);
    my $cluster = 'cluster-fsid';
    local *PVE::Ceph::Services::get_cluster_service = sub {
        return { $NODE => { 7 => { direxists => 1 } } };
    };
    my @commands;
    local *main::run_command = sub {
        my ($cmd, %args) = @_;
        push @commands, [@$cmd];
        if (($args{input} // '') =~ /my \(\$cluster, \@specs\)/) {
            $args{outfunc}->(
                'label osd:7 '
                    . JSON::encode_json({
                        '/dev/block' => {
                            whoami => 7,
                            ceph_fsid => $cluster,
                            osd_uuid => $FSID,
                            osd_key => $OLD,
                        },
                    })
            );
        } else {
            $args{outfunc}->("$FSID count=1");
            $args{outfunc}->("$FSID secret=$OLD");
        }
    };
    local *main::file_set_contents = sub { };
    my $rados = LockboxTestRados->new(auth => { $ENTITY => { key => $OLD, pending_key => $NEW } });
    my $state = {
        fsid => $cluster,
        lockbox => {
            $ENTITY => {
                fsid => $FSID,
                node => "$NODE.example.invalid",
                key => key_fingerprint($NEW),
                phase => 'staged',
            },
        },
    };
    my $info = { exported => $rados->{auth}, fsid => $cluster };
    ok(
        $HOOKS->{resume}->($rados, $state, $info),
        'FQDN lockbox journal fallback resumes with node evidence',
    );
    ok(
        @commands && !grep({ $_->[0] ne 'perl' } @commands),
        'local FQDN recovery uses only the member shortcut',
    );
    ok(!$state->{lockbox}->{$ENTITY}, 'verified recovery completes the journal');

    $rados = LockboxTestRados->new(auth => { $ENTITY => { key => $OLD, pending_key => $NEW } });
    $info = { exported => $rados->{auth}, fsid => $cluster };
    for my $host ('foreign.invalid', "$NODE.foreign.invalid") {
        local *PVE::Ceph::Services::get_cluster_service = sub { return {} };
        $state = {
            fsid => $cluster,
            lockbox => {
                $ENTITY => {
                    fsid => $FSID,
                    node => $host,
                    key => key_fingerprint($NEW),
                    phase => 'staged',
                },
            },
        };
        @commands = ();
        eval { $HOOKS->{resume}->($rados, $state, $info) };
        like($@, qr/not a node|unique data directory/, 'foreign lockbox recovery is refused');
        is_deeply(\@commands, [], 'foreign lockbox recovery sends no node command');
        is($rados->{auth}->{$ENTITY}->{pending_key}, $NEW, 'refusal leaves the pending key valid');
        ok($state->{lockbox}->{$ENTITY}, 'refusal preserves lockbox recovery state');
    }
}

done_testing();
