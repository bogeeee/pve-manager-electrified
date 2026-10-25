package PVE::Ceph::KeyMigration;

# The decisions behind the cephx aes256k key migration, kept apart from the helper that carries
# them out so they can be tested: every sub here maps data to data and touches nothing else.

use v5.36;

use Digest::SHA qw(sha256_hex);
use JSON;
use MIME::Base64 qw(decode_base64 encode_base64);

use PVE::Ceph::Services;
use PVE::Tools ();
use PVE::Ceph::Tools;

use base 'Exporter';

our @EXPORT_OK = qw(
    $CIPHER $LEGACY_CIPHER $CIPHER_ID $CIPHER_NAMES $CIPHER_IDS
    $DAEMON_TYPES $TOOL_CLIENT_KEYS $ADMIN_ENTITY $GRACE_OPTION
    key_cipher key_fingerprint keyring_text short_version version_has_cipher
    parse_storage_key storage_config_problem storage_key_copy_problems storage_key_copy_warnings
    parse_auth_methods summarize_monitor_authentication
    parse_probe_output osd_label_identity needs_rotation mon_key_needs_rotation mon_keyring_stale
    mon_key_rotation_wanted client_keys_requested migration_unfinished unfinished_entities
    bulk_storage_staging_needed client_staging_needed touched_daemons
    plan_client_keys plan_lockbox_keys build_plan configured_daemon_locations
    resolve_configured_locations merge_configured_daemons resume_verdict
    summarize_sessions session_hosts describe_sessions summarize_monitor_connections
    possible_consumer_hints
    merge_refresh_record stale_consumers session_key_targets sessions_judged_by_key
    reverse_session_status session_key_support_hint mount_refresh_hint
    restrict_blockers
    cephfs_mount_storages mount_refresh_pending mount_refresh_required ack_decision finish_after_acks
    classify_insecure_clients open_options open_actions parse_lockbox_output
    manual_promotion_support client_key_stageable staged_records
);

our $CIPHER = 'aes256k';
our $LEGACY_CIPHER = 'aes';

# cipher type is a little-endian 16 bit prefix, see CryptoKey::encode() in Ceph
our $CIPHER_ID = 2; # CEPH_CRYPTO_AES256KRB5
our $CIPHER_NAMES = { 0 => 'none', 1 => $LEGACY_CIPHER, 2 => $CIPHER };
our $CIPHER_IDS = { reverse $CIPHER_NAMES->%* };

our $DAEMON_TYPES = ['mgr', 'mds', 'osd']; # cheaper restarts first

# no in-kernel client reads these, so no node's kernel gates them
our $TOOL_CLIENT_KEYS = [
    'client.bootstrap-mds',
    'client.bootstrap-mgr',
    'client.bootstrap-osd',
    'client.bootstrap-rbd',
    'client.bootstrap-rbd-mirror',
    'client.bootstrap-rgw',
    'client.crash',
];

our $ADMIN_ENTITY = 'client.admin';

# Monitors that know this option can keep a client's old and new key valid side by side while it
# is disabled; older ones promote a pending key on its first use.
our $GRACE_OPTION = 'mon_auth_client_pending_key_auto_promote';

sub parse_auth_methods($value) {
    return undef if !defined($value) || ref($value);
    my @methods = grep { length } split(/[;,= \t]+/, $value);
    @methods = ('cephx') if !@methods;
    return undef if grep { !m/^(?:none|cephx|gss)$/ } @methods;
    return { map { $_ => 1 } @methods };
}

# These are configured values, not the monitor's initialized authentication lists. A runtime
# change without a restart can make the two differ, so they must not authorize skipping keys.
sub summarize_monitor_authentication($monitors, $reports) {
    my @unknown;
    my $clients = 1;
    for my $mon (@$monitors) {
        my $report = $reports->{$mon} // {};
        my $service = parse_auth_methods($report->{auth_service_required});
        if (!defined($service)) {
            push @unknown, $mon;
        } elsif (!$service->{cephx}) {
            $clients = 0;
        }
    }
    push @unknown, 'unknown' if !@$monitors;
    return {
        monitors => $reports,
        unknown => \@unknown,
        client_cephx_available => @unknown ? undef : $clients,
    };
}

sub key_cipher($key) {
    return undef if !defined($key) || $key eq '';

    # decode_base64() drops anything that is not base64 rather than failing, so a short decode is
    # how garbage shows up. A key blob is at least a cipher type, a timestamp and a secret length.
    my $raw = eval { decode_base64($key) };
    return undef if $@ || !defined($raw) || length($raw) < 12;

    return unpack('v', substr($raw, 0, 2));
}

# Names the key a marker describes, so a marker left by a run that targeted a different key does
# not read as work already done. Never the key itself: the markers are progress, not secrets.
sub key_fingerprint($key) {
    return substr(sha256_hex($key // ''), 0, 16);
}

# the JSON form: plain-text 'auth get' adds a 'pending key' line no keyring parser accepts
sub keyring_text($entry) {
    my $text = "[$entry->{entity}]\n\tkey = $entry->{key}\n";
    my $caps = $entry->{caps} // {};
    for my $system (sort keys %$caps) {
        my $value = $caps->{$system} =~ s/"/\\"/gr;
        $text .= "\tcaps $system = \"$value\"\n";
    }

    return $text;
}

sub valid_storage_key($key) {
    return 0 if !defined($key) || ref($key) || $key !~ m{\A[A-Za-z0-9+/]+={0,2}\z};
    my $raw = decode_base64($key);
    return 0 if length($raw) < 12 || encode_base64($raw, '') ne $key;
    my ($type, $length) = (unpack('v', $raw), unpack('v', substr($raw, 10, 2)));
    return 0 if length($raw) != 12 + $length;
    return
        ($type == 0 && $length == 0)
        || ($type == 1 && $length >= 16)
        || ($type == 2 && $length == 32);
}

# Inspect the configured identity, not any matching substring or another section's credential.
# Errors describe structure only: malformed lines can themselves contain secret material.
sub parse_storage_key($content, $format, $entity) {
    my $invalid = { error => 'malformed or ambiguous key file' };
    return $invalid if !defined($content) || ref($content);
    if ($format eq 'secret') {
        $content =~ s/\A\s+|\s+\z//g;
        return valid_storage_key($content) ? { key => $content } : $invalid;
    }
    return $invalid if $format ne 'keyring';

    my ($section, $seen, $key);
    for my $line (split(/\n/, $content)) {
        $line =~ s/^\s+|\s+$//g;
        next if $line eq '' || $line =~ m/^[#;]/;
        if ($line =~ m/^\[([^\[\]]+)\]\s*(?:[#;].*)?$/) {
            $section = $1;
            return $invalid if $section eq $entity && $seen++;
            next;
        }
        next if !defined($section) || $section ne $entity || $line !~ m/^key\s*=/;
        return $invalid
            if defined($key)
            || $line !~ m/^key\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#;]+))\s*(?:[#;].*)?$/;
        $key = $1 // $2 // $3;
        return $invalid if !valid_storage_key($key);
    }
    return { error => 'no key for the configured Ceph user' } if !defined($key);
    return { key => $key };
}

# Custom configurations can redirect clients away from the standard file. Do not follow those
# paths or create configuration files during a read-only retirement check.
sub storage_config_problem($content, $path, $entity = 'client.admin', $cluster = 'ceph') {
    my ($type, $id) = split(/\./, $entity, 2);
    my $variables = { cluster => $cluster, name => $entity, type => $type, id => $id };
    my ($section, %sections, %options, $keyring);
    for my $line (split(/\n/, $content)) {
        $line =~ s/^\s+|\s+$//g;
        next if $line eq '' || $line =~ m/^[#;]/;
        if ($line =~ m/^\[([^\[\]]+)\]\s*(?:[#;].*)?$/) {
            $section = $1;
            return 'duplicate section in custom configuration' if $sections{$section}++;
            next;
        }
        return 'unverified custom configuration'
            if !defined($section) || $line !~ m/^([\w -]+?)\s*=\s*(.*?)\s*$/;
        my ($option, $value) = ($1, $2);
        $option =~ s/ /_/g;
        return 'duplicate option in custom configuration' if $options{"$section:$option"}++;
        $value =~ s/\s*[#;].*$// if $value !~ m/^["']/;
        $value =~ s/^(?:"([^"]*)"|'([^']*)')\s*(?:[#;].*)?$/$1 \/\/ $2/e;
        $value =~
            s/\$\{(cluster|name|id|type)\}|\$(cluster|name|id|type)\b/$variables->{$1 \/\/ $2}/ge;
        $keyring = 1 if $option eq 'keyring';
        return 'alternate credentials in custom configuration'
            if $option =~ m/^(?:key|keyfile|secretfile|name|id|include)$/
            || ($option eq 'keyring' && $value ne $path);
    }
    return 'no verified keyring path in custom configuration'
        if $path =~ m/\.keyring$/ && !$keyring;
    return undef;
}

sub storage_key_copy_problems($copies, $entity, $retiring, $target, $reverse = 0) {
    my (@problems, @stale);
    my $replacement = $reverse ? 'the restored key' : 'the staged key';
    for my $copy (@$copies) {
        my $where = "storage '$copy->{store}' in '$copy->{path}'";
        my $own_user = $entity =~ m/^client\.(?!osd-lockbox\.)/ && $copy->{entity} eq $entity;
        my $managed = $copy->{managed} && $own_user;
        if (defined($retiring) && $retiring ne $target && ($copy->{key} // '') eq $retiring) {
            push @stale, $copy;
        } elsif ($copy->{error} && $managed) {
            push @problems, "Cannot retire the key of '$entity': $where is unverified"
                . " ($copy->{error}). Verify its configured user's credentials, then retry.";
        } elsif ($managed && ($copy->{key} // '') ne $target) {
            push @problems,
                "Cannot retire the key of '$entity': managed $where does not hold"
                . " $replacement of the same Ceph user. Update this copy, refresh its clients,"
                . " then retry.";
        }
    }
    unshift @problems,
        join(
            "\n",
            "Cannot retire the key of '$entity': these storage key copies still hold it:",
            (map { "  $_->{store}: $_->{path}" } @stale),
            "Update each with $replacement of the same Ceph user and refresh its clients, then"
            . " retry. If one is configured for another cluster or Ceph user, first confirm"
            . " that it really shares this key.",
        ) if @stale;
    return \@problems;
}

sub storage_key_copy_warnings($copies, $entity = undef, $reverse = 0) {
    my $replacement = $reverse ? 'the restored key' : 'the staged key';
    my @unchecked = grep {
        !$_->{managed} && $_->{error} && (!defined($entity) || $_->{entity} eq $entity)
    } @$copies;
    return [] if !@unchecked;
    return [
        join(
            "\n",
            "These storage key copies could not be checked:",
            (map { "  $_->{store}: $_->{path} ($_->{error})" } @unchecked),
            "If one points at this cluster, update it with $replacement of the same Ceph user"
                . " before confirming.",
        ),
    ];
}

# parse_ceph_version() insists on the commit hash, which a bare or dev version lacks
sub short_version($version) {
    return 'an unknown version' if !defined($version) || $version eq '';

    return $version =~ m/^(?:ceph\s+version\s+)?v?(\d+(?:\.\d+)+)/ ? $1 : $version;
}

sub version_has_cipher($version) {
    return 0 if !defined($version) || $version eq '';
    return PVE::Ceph::Services::ceph_version_supports_aes256k($version) ? 1 : 0;
}

# the label is JSON keyed by device path; whoami and fsid say which OSD of which cluster
sub parse_probe_output($output) {
    my $probes = {};
    for my $line (split(/\n/, $output)) {
        next if $line !~ m/^(label|keyring|store|error) (\S+)(?: (.*))?$/;
        my ($kind, $spec, $payload) = ($1, $2, $3 // '');
        my $probe = $probes->{$spec} //= {};

        if ($kind eq 'error') {
            $probe->{store} = 'probe-error';
            my $error = eval { decode_json($payload) };
            if (ref($error) eq 'HASH' && defined($error->{message}) && !ref($error->{message})) {
                $probe->{error} = $error->{message};
                $probe->{'error-details'} = $error->{details}
                    if defined($error->{details}) && !ref($error->{details});
            } else {
                $probe->{error} = $payload;
            }
        } elsif ($kind eq 'keyring') {
            $probe->{store} = 'file';
            $probe->{sections} = [$payload =~ m/\[([^\]]+)\]/g];
        } elsif ($kind eq 'store') {
            $probe->{store} = $payload;
        } elsif ($kind eq 'label') {
            my $label = eval { decode_json($payload) };
            $label = {} if ref($label) ne 'HASH';
            my ($dev) = grep { ref($label->{$_}) eq 'HASH' } sort keys %$label;
            my $fields = $dev ? $label->{$dev} : undef;
            $probe->{store} =
                defined($fields) && defined($fields->{osd_key}) ? 'block' : 'block-without-key';
            $probe->{'label-whoami'} = $fields->{whoami} if $fields;
            $probe->{'label-fsid'} = $fields->{ceph_fsid} if $fields;
            $probe->{'label-osd-uuid'} = $fields->{osd_uuid} if $fields;
            $probe->{'label-key'} = $fields->{osd_key} if $fields;
        }
    }

    return $probes;
}

# One line per fact, each prefixed with the fsid it is about, so one probe answers for every
# encrypted OSD of a node: { <fsid> => { path, count, secret, error } }
sub parse_lockbox_output($output) {
    my $facts = {};
    for my $line (split(/\n/, $output // '')) {
        next if $line !~ m/^(\S+) (path|count|secret|error)=(.*)$/;
        $facts->{$1}->{$2} = $3;
    }

    return $facts;
}

# Match the device under an OSD data directory to the current OSD incarnation. An OSD ID and the
# cluster FSID survive ID reuse, so only the per-OSD UUID distinguishes a leftover old device.
sub osd_label_identity($daemon, $cluster_fsid) {
    my $whoami = $daemon->{'label-whoami'} // '';
    my $fsid = $daemon->{'label-fsid'} // '';
    my $uuid = $daemon->{'label-osd-uuid'} // '';
    my $expected_uuid = $daemon->{'osd-uuid'} // '';

    return 'wrong-id' if $whoami ne '' && $whoami ne $daemon->{id};
    return 'wrong-cluster' if $fsid ne '' && $fsid ne $cluster_fsid;
    return 'incomplete' if $whoami eq '' || $fsid eq '' || $uuid eq '';
    return 'missing-map-uuid' if $daemon->{down} && $expected_uuid eq '';
    return 'wrong-uuid' if $expected_uuid ne '' && $uuid ne $expected_uuid;
    return 'ok';
}

sub needs_rotation($info, $entity) {
    my $entry = $info->{exported}->{$entity};

    # 'ceph-mon --mkfs' moves 'mon.' out of the auth database into the monitor keyrings, so judge
    # its cipher by the copy on the cluster file system, and call it due only if there is none.
    if (!$entry) {
        return 0 if $entity ne 'mon.';
        my $key = $info->{pve_mon_key};
        return 1 if !defined($key);
        return (key_cipher($key) // -1) != $CIPHER_ID ? 1 : 0;
    }

    return (key_cipher($entry->{key}) // -1) != $CIPHER_ID ? 1 : 0;
}

sub mon_key_needs_rotation($info) {
    return needs_rotation($info, 'mon.');
}

# 'pveceph mon create' feeds this copy to --mkfs, so a stale one strands every later monitor
sub mon_keyring_stale($info) {
    my $current = $info->{mon_entry}->{key} // '';
    return 0 if $current eq '';
    return ($info->{pve_mon_key} // '') ne $current ? 1 : 0;
}

# must agree with the plan, or '--rotate-mon-key' on a migrated cluster is dropped silently
sub mon_key_rotation_wanted($info, $opts) {
    return 0 if !$opts->{'rotate-mon-key'};

    my $only = $opts->{only};
    return 0 if $only && !$only->{mon};

    return mon_key_needs_rotation($info) ? 1 : 0;
}

sub client_keys_requested($opts) {
    return 1
        if $opts->{'rotate-client-keys'}
        || $opts->{'rotate-admin-key'}
        || $opts->{'rotate-all-storage-keys'};
    return scalar(@{ $opts->{'rotate-storage-key'} // [] }) ? 1 : 0;
}

sub bulk_storage_staging_needed($plan) {
    return scalar(grep { $_->{bulk_new_staging} } @{ $plan // [] }) ? 1 : 0;
}

sub client_staging_needed($plan) {
    return scalar(grep { $_->{new_staging} } @{ $plan // [] }) ? 1 : 0;
}

# A completed older rotation must not hide a newer interrupted one. Live-swap state is always open;
# the other markers use their timestamps to distinguish two rotations of the same entity.
sub migration_unfinished($state, $entity) {
    return 1 if $state->{live_swap}->{$entity};

    my $rotated = $state->{rotated}->{$entity};
    my $previous = $state->{previous_keys}->{$entity};
    my $started = defined($rotated) || defined($previous);
    return 0 if !$started;

    my $done = $state->{done}->{$entity};
    return 1 if !defined($done);

    my @times = grep { defined($_) && /^\d+(?:\.\d+)?$/ } (
        $rotated, ref($previous) eq 'HASH' ? $previous->{saved} : undef,
    );
    return scalar(grep { $_ > $done } @times) ? 1 : 0;
}

# Rotated but not written everywhere. An OSD left stopped stays in 'osd metadata', so the recovery
# walk alone misses some. A lockbox key with a journal entry is finished from that journal before
# any plan is built, so it is not listed as something the plan has to pick up. A staged client key
# is open on purpose until its clients are confirmed, and reported through its own record.
sub unfinished_entities($state) {
    my $started = {
        %{ $state->{rotated} // {} },
        %{ $state->{previous_keys} // {} },
        %{ $state->{live_swap} // {} },
    };

    return sort grep {
        $_ eq 'mon.' && $state->{mon_key_complete} ? 0
            : $state->{lockbox}->{$_} ? 0
            : $state->{staged}->{$_} ? 0
            : migration_unfinished($state, $_)
    } keys %$started;
}

# Whether every monitor can keep a client's old and new key valid side by side. The option only
# exists on patched monitors, and a single monitor that still promotes on first use would end
# the grace period on its own, so every monitor of the map has to answer, not only the quorum.
# $reports is { <mon id> => { reached, value } } from each monitor's admin socket, where 'value'
# is undef on a monitor that does not know the option.
sub manual_promotion_support($reports, $monmap) {
    my $res = { supported => 0, disabled => 0, unsupported => [], unanswered => [] };
    return $res if ref($monmap) ne 'ARRAY' || !scalar(@$monmap);

    my $values = {};
    for my $mon (sort @$monmap) {
        my $report = ($reports // {})->{$mon};
        if (ref($report) ne 'HASH' || !$report->{reached}) {
            push $res->{unanswered}->@*, $mon;
        } elsif (!defined($report->{value}) || $report->{value} !~ m/^(?:true|false)$/) {
            push $res->{unsupported}->@*, $mon;
        } else {
            $values->{$mon} = $report->{value};
        }
    }
    return $res if scalar($res->{unanswered}->@*) || scalar($res->{unsupported}->@*);

    $res->{supported} = 1;
    $res->{disabled} = (grep { $_ ne 'false' } values %$values) ? 0 : 1;
    return $res;
}

# Ceph's own tools read a keyring for every command, so nothing keeps the old bootstrap or crash
# key in memory; only a key that long-running clients load is worth a grace period.
sub client_key_stageable($entity) {
    return (grep { $_ eq $entity } $TOOL_CLIENT_KEYS->@*) ? 0 : 1;
}

# What became of the keys this script staged, from the auth export: { <entity> => verdict }
#   waiting    the pending key is still the staged one, the rotation awaits its confirmation
#   committed  the staged key is the active key now, so it was promoted, by this script or by hand
#   lost       the staged key is gone without becoming active, so every copy written holds a key
#              the monitors no longer accept, and the rotation has to be redone
sub staged_records($info, $state) {
    my $verdicts = {};
    for my $entity (sort keys %{ $state->{staged} // {} }) {
        my $record = $state->{staged}->{$entity};
        next if ref($record) ne 'HASH' || !defined($record->{key});

        my $entry = ($info->{exported} // {})->{$entity};
        my $pending = $entry ? $entry->{pending_key} : undef;
        if (defined($pending) && length($pending) && key_fingerprint($pending) eq $record->{key}) {
            $verdicts->{$entity} = 'waiting';
        } elsif ($entry && key_fingerprint($entry->{key} // '') eq $record->{key}) {
            $verdicts->{$entity} = 'committed';
        } else {
            $verdicts->{$entity} = 'lost';
        }
    }
    return $verdicts;
}

# Keep every node that reports a data directory for an ID. Silently picking one would direct a
# stopped-daemon key write at an arbitrary leftover directory when an ID was reused.
sub configured_daemon_locations($by_node) {
    my $locations = {};
    for my $node (sort keys %{ $by_node // {} }) {
        my $ids = $by_node->{$node};
        next if ref($ids) ne 'HASH';
        for my $id (sort keys %$ids) {
            next if ref($ids->{$id}) ne 'HASH' || !$ids->{$id}->{direxists};
            push $locations->{"$id"}->@*, $node;
        }
    }
    return $locations;
}

# Running metadata is authoritative for its current node. Otherwise duplicate locations are
# ambiguous for an existing daemon, while every location of an absent OSD is only a remnant.
sub resolve_configured_locations($type, $locations, $running, $existing = undef) {
    my ($configured, $ghosts, $conflicts) = ({}, [], []);
    for my $id (sort keys %{ $locations // {} }) {
        my $nodes = $locations->{$id};
        next if $running->{$id};
        if ($existing && !exists($existing->{$id})) {
            push @$ghosts, map { { type => $type, id => "$id", node => $_ } } @$nodes;
            next;
        }
        if (scalar(@$nodes) > 1) {
            push @$conflicts, { type => $type, id => "$id", nodes => [@$nodes] };
            next;
        }
        $configured->{$id} = $nodes->[0];
    }
    return ($configured, $ghosts, $conflicts);
}

# The daemons this run writes to. Only these are asked about their data directory, so a run
# narrowed with '--only' touches one node instead of every node that runs a daemon.
# Ceph only lists daemons that are running, so one that is merely stopped would be missed and its
# key never migrated, which the service ticket switch at the end then refuses over. $configured is
# { <id> => <node> } from what the nodes broadcast about themselves.
# Live sessions come from each monitor's admin socket. Only 'client' connections matter here:
# daemons re-read their keyring at restart, while a client process loads its key once and keeps
# it for as long as it runs.
sub summarize_sessions($per_mon, $expected_mons = undef) {
    my $summary = { complete => 1, clients => {} };
    if (ref($per_mon) ne 'ARRAY') {
        $summary->{complete} = 0;
        return $summary;
    }

    my ($expected, $seen);
    if (defined($expected_mons)) {
        if (
            ref($expected_mons) ne 'ARRAY'
            || !scalar(@$expected_mons)
            || grep { !defined($_) || ref($_) || !length($_) } @$expected_mons
        ) {
            $summary->{complete} = 0;
        } else {
            $expected = { map { $_ => 1 } @$expected_mons };
            $summary->{complete} = 0 if scalar(keys %$expected) != scalar(@$expected_mons);
            $seen = {};
        }
    }

    for my $mon (@$per_mon) {
        if (ref($mon) ne 'HASH' || ref($mon->{sessions}) ne 'ARRAY') {
            $summary->{complete} = 0;
            next;
        }
        if ($expected) {
            my $id = $mon->{mon};
            if (!defined($id) || ref($id) || !$expected->{$id} || $seen->{$id}++) {
                $summary->{complete} = 0;
                next;
            }
        }
        for my $session ($mon->{sessions}->@*) {
            if (
                ref($session) ne 'HASH'
                || !defined($session->{con_type})
                || ref($session->{con_type})
                || !length($session->{con_type})
            ) {
                $summary->{complete} = 0;
                next;
            }
            next if $session->{con_type} ne 'client';
            # skip the monitors' own key, which a 'ceph tell' sent as 'mon.' also shows up as
            next if ($session->{entity_name} // '') eq 'mon.';

            my $gid = $session->{global_id};
            my $entity = $session->{entity_name};
            if (
                !defined($gid)
                || ref($gid)
                || $gid !~ m/^\d+$/
                || !defined($entity)
                || ref($entity)
                || !length($entity)
            ) {
                $summary->{complete} = 0;
                next;
            }

            my $socket = $session->{socket_addr};
            if (
                defined($socket)
                && (ref($socket) ne 'HASH'
                    || (defined($socket->{addr}) && ref($socket->{addr})))
            ) {
                $summary->{complete} = 0;
                next;
            }
            my ($host) = ((($socket // {})->{addr} // '') =~ m/^\[?(.+?)\]?:\d+$/);
            my $client = { global_id => $gid, host => $host // '?' };
            # a monitor that records the key behind a session names it by fingerprint
            my $fingerprint = $session->{auth_key_fingerprint};
            if (defined($fingerprint) && !ref($fingerprint) && length($fingerprint)) {
                $client->{key_fingerprint} = "$fingerprint";
                $client->{key_pending} = $session->{auth_key_pending} ? 1 : 0;
            }
            push $summary->{clients}->{$entity}->@*, $client;
        }
    }
    if ($expected) {
        my @unanswered = sort grep { !$seen->{$_} } keys %$expected;
        $summary->{unanswered} = \@unanswered;
        $summary->{complete} = 0 if scalar(@unanswered);
    }
    return $summary;
}

# the hosts of one entity's live sessions, as 'host: count' for the run log
sub session_hosts($live) {
    my $hosts = {};
    $hosts->{ $_->{host} }++ for @$live;
    return join(', ', map { "$_: $hosts->{$_}" } sort keys %$hosts);
}

# The same with node names and host-wide client hints when known. A hint describes every
# monitor connection on that node, not the particular cephx session being reported.
sub describe_sessions($live, $hints = {}) {
    my ($hosts, $possible) = ({}, {});
    for my $session (@$live) {
        my $host = $session->{host};
        my $entry = ($hints // {})->{$host};
        my $label = ref($entry) eq 'HASH' ? ($entry->{node} // $host) : $host;
        $hosts->{$label}++;
        my $consumers = ref($entry) eq 'HASH' ? $entry->{consumers} : $entry;
        $possible->{$label}->{$consumers} = 1 if defined($consumers) && length($consumers);
    }
    return join(
        ', ',
        map {
            my $line = "$_: $hosts->{$_}";
            my @possible = sort keys %{ $possible->{$_} // {} };
            $line .= " (possible clients: " . join('; ', @possible) . ")"
                if scalar(@possible);
            $line;
        } sort keys %$hosts,
    );
}

# One node can have sessions for many cephx users. Return each host-wide hint once so callers can
# present it separately from per-user decisions instead of repeating an ambiguous attribution.
sub possible_consumer_hints($live, $hints = {}) {
    my $by_node = {};
    for my $session (@$live) {
        my $host = $session->{host};
        my $entry = ($hints // {})->{$host};
        next if ref($entry) ne 'HASH';
        my $consumers = $entry->{consumers};
        next if !defined($consumers) || !length($consumers);
        my $node = $entry->{node} // $host;
        $by_node->{$node}->{$consumers} = 1;
    }
    return [map { "$_: " . join('; ', sort keys $by_node->{$_}->%*) } sort keys %$by_node];
}

# What may hold monitor connections on one node. Monitor sockets do not identify which cephx
# session or kernel mount owns them, so processless sockets remain possible kernel clients.
sub summarize_monitor_connections($connections, $verbose = 0) {
    return undef if ref($connections) ne 'ARRAY';
    my ($vms, $others, $processless) = ({}, {}, 0);
    for my $conn (@$connections) {
        next if ref($conn) ne 'HASH';
        my $process = $conn->{process};
        if (!defined($process) || !length($process)) {
            $processless++;
        } elsif ($process =~ m/^ceph-(?:mon|osd|mds|mgr)$/) {
            next;
        } elsif ($process eq 'pverados') {
            # the worker every Proxmox VE tool spawns per RADOS call, this run's own included;
            # it reads the keyring afresh each time and never needs a refresh
            next;
        } elsif ($process eq 'kvm' && defined($conn->{vmid}) && $conn->{vmid} =~ m/^\d+$/) {
            $vms->{ $conn->{vmid} } = 1;
        } else {
            $others->{$process}++;
        }
    }
    my @vm_ids = sort { $a <=> $b } keys %$vms;
    my $extra = !$verbose && scalar(@vm_ids) > 8 ? scalar(@vm_ids) - 8 : 0;
    splice(@vm_ids, 8) if $extra;
    my @vms = map { "VM $_" } @vm_ids;
    push @vms, "$extra more VMs" if $extra;
    my @parts;
    push @parts, join(', ', @vms) if @vms;

    if ($processless) {
        my $sockets =
            $processless == 1 ? 'unattributed socket' : "$processless unattributed sockets";
        my $clients = $processless == 1 ? 'client' : 'clients';
        $sockets .= ' without an owning process' if $verbose;
        push @parts, "$sockets (possible kernel $clients)";
    }
    push @parts,
        join(', ', map { $others->{$_} > 1 ? "$_ ($others->{$_})" : $_ } sort keys %$others)
        if scalar(keys %$others);
    return scalar(@parts) ? join('; ', @parts) : undef;
}

# Retain old or unidentified instances observed around a rotation, including partial retry samples.
# A session already authenticated with the target key adds no stale evidence. Retain existing IDs
# as fallback evidence for observations that cannot identify the key.
sub merge_refresh_record(
    $record, $sessions, $entity, $measurement_complete,
    $rotated = undef,
    $target = undef,
) {
    my $merged = { %{ $record // {} } };
    my $ids = {};
    for my $id (@{ $merged->{session_ids} // [] }) {
        $ids->{"$id"} = $id;
    }
    for my $sample ($sessions, @{ $sessions->{observations} // [] }) {
        for my $session (@{ ($sample->{clients} // {})->{$entity} // [] }) {
            my $id = $session->{global_id} // next;
            my $fingerprint = $session->{key_fingerprint};
            next
                if defined($target)
                && length($target)
                && defined($fingerprint)
                && $fingerprint eq $target;
            $ids->{"$id"} = $id;
        }
    }
    $merged->{session_ids} = [sort { "$a" cmp "$b" } values %$ids]
        if scalar(keys %$ids) || defined($merged->{session_ids}) || $measurement_complete;

    if ($measurement_complete) {
        delete $merged->{measurement_incomplete};
    } else {
        $merged->{measurement_incomplete} = 1;
    }

    if (defined($rotated)) {
        $merged->{rotated} = $rotated;
        delete $merged->{cleared};
        delete $merged->{acknowledged};
    }

    return $merged;
}

# A recorded ID names the same client instance across reconnects and monitor restarts. Numeric
# order says nothing because monitors allocate IDs in independent rank-strided sequences.
# The key each entity's clients should be on, by fingerprint: the pending key while one is
# staged, the active key otherwise. A session a monitor names by its key fingerprint is judged
# against that; one without the fingerprint falls back to the IDs recorded around the rotation.
sub session_key_targets($exported) {
    my $targets = {};
    for my $entity (keys %{ $exported // {} }) {
        my $entry = $exported->{$entity};
        next if ref($entry) ne 'HASH';
        my $key =
            defined($entry->{pending_key}) && length($entry->{pending_key})
            ? $entry->{pending_key}
            : $entry->{key};
        $targets->{$entity} = key_fingerprint($key) if defined($key) && length($key);
    }
    return $targets;
}

# A known fingerprint identifies the key used for the session's latest accepted authentication,
# even when its global ID predates the rotation. Fall back to recorded IDs without that evidence.
# Judge each observation separately: another monitor may report the same ID on an old or unknown key.
sub stale_consumers($sessions, $refresh, $targets = undef) {
    my $stale = {};
    for my $entity (sort keys %{ $refresh // {} }) {
        my $recorded = { map { $_ => 1 } @{ $refresh->{$entity}->{session_ids} // [] } };
        my $target = ($targets // {})->{$entity};
        my @held;
        for my $session (@{ ($sessions->{clients} // {})->{$entity} // [] }) {
            my $fingerprint = $session->{key_fingerprint};
            my $by_key =
                defined($target)
                && length($target)
                && defined($fingerprint)
                && length($fingerprint);
            my $is_stale = $by_key ? $fingerprint ne $target : $recorded->{ $session->{global_id} };
            next if !$is_stale;
            push @held, { %$session, judged_by_key => $by_key ? 1 : 0 };
        }
        $stale->{$entity} = \@held if scalar(@held);
    }
    return $stale;
}

# whether every session in a list was found stale by its key, not only by its recorded ID
sub sessions_judged_by_key($held) {
    return scalar(@{ $held // [] }) && !scalar(grep { !$_->{judged_by_key} } @$held) ? 1 : 0;
}

# Reverse refresh retires the pending key. Every visible session must therefore prove that it uses
# the active key. A complete collection without fingerprints still leaves those sessions unknown.
sub reverse_session_status($sessions, $exported, $entity) {
    my $entry = ($exported // {})->{$entity};
    my $status = { current => [], pending => [], unknown => [], other => [] };
    return $status if ref($entry) ne 'HASH' || !defined($entry->{key});

    my $active = key_fingerprint($entry->{key});
    my $pending =
        defined($entry->{pending_key})
        && length($entry->{pending_key})
        ? key_fingerprint($entry->{pending_key})
        : undef;
    for my $session (@{ ($sessions->{clients} // {})->{$entity} // [] }) {
        my $fingerprint = $session->{key_fingerprint};
        if (!defined($fingerprint) || !length($fingerprint)) {
            push $status->{unknown}->@*, $session;
        } elsif ($fingerprint eq $active) {
            push $status->{current}->@*, $session;
        } elsif (defined($pending) && $fingerprint eq $pending) {
            push $status->{pending}->@*, $session;
        } else {
            push $status->{other}->@*, $session;
        }
    }
    return $status;
}

sub session_key_support_hint() {
    return
        "Session-key identification requires Ceph 19.2.6-pve4, 20.2.4-pve4, or newer"
        . " and a restart of each monitor. Upgrade older monitors, or disconnect this user's"
        . " clients before confirming.";
}

sub mount_refresh_hint($state, $entity, $files = []) {
    my $pending = (($state->{mount_refresh} // {})->{$entity} // {})->{pending} // {};
    my @mounts;
    for my $store (sort keys %$pending) {
        push @mounts, map { "'$store' on node '$_'" } sort keys %{ $pending->{$store} // {} };
    }
    if (@mounts) {
        return
            'CephFS refresh pending: '
            . join(', ', @mounts)
            . ". Free busy mounts and resolve node or mount errors, then rerun with '--apply'.";
    }
    return
        'CephFS mounts need inspection: '
        . join(', ', @{ cephfs_mount_storages({ files => $files }) })
        . ". Run with '--apply' to inspect and refresh these mounts; busy mounts are left alone.";
}

# The CephFS storages whose mount reads a rotated key. The kernel holds the key a mount was
# made with and cannot take a new one, so such a mount is a client of its own.
sub cephfs_mount_storages($item) {
    my $stores = {};
    for my $file ($item->{files}->@*) {
        next if ($file->{format} // '') ne 'secret' || !defined($file->{store});
        $stores->{ $file->{store} } = 1;
    }
    return [sort keys %$stores];
}

sub mount_refresh_pending($state, $entity) {
    my $pending = (($state->{mount_refresh} // {})->{$entity} // {})->{pending};
    return 0 if ref($pending) ne 'HASH';
    return scalar(grep { ref($_) eq 'HASH' && scalar(keys %$_) } values %$pending) ? 1 : 0;
}

# A previous helper could mark file distribution complete without recording mount work. For a
# staged key with managed CephFS mounts, only an explicit finished marker proves that the pairs
# were inspected. Existing pending work remains required even if the storage mapping changed.
sub mount_refresh_required($state, $entity, $item, $target = undef) {
    return 1 if mount_refresh_pending($state, $entity);
    return 0 if !scalar(cephfs_mount_storages($item)->@*);

    my $work = ($state->{mount_refresh} // {})->{$entity};
    return 1 if ref($work) ne 'HASH';
    return 1 if defined($target) && ($work->{target} // '') ne $target;
    return $work->{finished} ? 0 : 1;
}

# Whether the cipher restriction would go through once exactly the confirmations a run offers
# are given. Asking the blocker set itself, on a copy of the state with those records closed,
# keeps the offer honest: an empty option list says nothing about a key nobody manages, a
# service key still on the old cipher, or a rotation this very run is about to make.
sub finish_after_acks($info, $state, $ready) {
    my $records = {
        map { $_ => { ($state->{client_refresh}->{$_} // {})->%* } }
            keys %{ $state->{client_refresh} // {} }
    };
    my $staged = {
        map { $_ => { ($state->{staged}->{$_} // {})->%* } }
            keys %{ $state->{staged} // {} }
    };
    my $exported = {
        map { $_ => { ($info->{exported}->{$_} // {})->%* } }
            keys %{ $info->{exported} // {} }
    };
    for my $entity (@$ready) {
        $records->{$entity} = { ($records->{$entity} // {})->%*, cleared => time() };
        my $record = $staged->{$entity} // next;
        next if $record->{aborting} || !$record->{written};
        next if mount_refresh_pending($state, $entity);
        my $entry = $exported->{$entity} // next;
        my $pending = $entry->{pending_key};
        next
            if !defined($pending)
            || !length($pending)
            || key_fingerprint($pending) ne ($record->{key} // '');
        $entry->{key} = $pending;
        delete $entry->{pending_key};
        delete $staged->{$entity};
    }

    my $simulated_info = { %$info, exported => $exported };
    my $simulated_state = {
        %$state,
        client_refresh => $records,
        staged => $staged,
    };
    return scalar(@{ restrict_blockers($simulated_info, $simulated_state) }) ? 0 : 1;
}

# What a requested confirmation can do, from the records and the session picture alone. Only
# 'accept' closes a record; everything else names what stands in the way, and 'measure' first
# turns the clients visible right now into named clients.
sub ack_decision($entity, $state, $sessions, $stale) {
    my $mark = ($state->{client_refresh} // {})->{$entity};
    return { verdict => 'unknown' } if !$mark;
    return { verdict => 'connected', held => $stale->{$entity} } if $stale->{$entity};
    return { verdict => 'incomplete' } if !$sessions->{complete};

    if ($mark->{measurement_incomplete} || !defined($mark->{session_ids})) {
        my $live = ($sessions->{clients} // {})->{$entity} // [];
        return { verdict => 'measure', live => $live };
    }

    # Both keys authenticate while staged, so a new global ID does not prove use of the new key.
    if (($state->{staged} // {})->{$entity}) {
        my @unknown = grep { !length($_->{key_fingerprint} // '') }
            @{ ($sessions->{clients} // {})->{$entity} // [] };
        return { verdict => 'unidentified', held => \@unknown } if @unknown;
    }

    return { verdict => 'accept' };
}

# what must be resolved before the old cipher can be disallowed without stopping a client
sub restrict_blockers($info, $state, $describe = undef, $files = {}) {
    $describe //= \&session_hosts;
    my $blockers = [];
    my $sessions = $info->{sessions} // {};
    if (!$sessions->{complete}) {
        my $errors = $sessions->{errors} // {};
        my $detail = join('; ', map { "$_: $errors->{$_}" } sort keys %$errors);
        $detail ||= join(', ', @{ $sessions->{unanswered} // [] });
        push @$blockers,
            "not every monitor answered the session query, so live clients cannot be verified"
            . (length($detail) ? " ($detail)" : '');
    }
    push @$blockers,
        "the service tickets still use the '" . ($info->{service_cipher} // 'unknown') . "' cipher"
        if ($info->{service_cipher} // '') ne $CIPHER;

    my $staged_open = $state->{staged} // {};
    my $records = $state->{client_refresh} // {};
    my $stale = stale_consumers($sessions, $records, session_key_targets($info->{exported}));
    my $clients = $sessions->{clients} // {};
    my $readiness;
    my $refresh_detail = sub($entity) {
        # Share the explanation, not the restriction decision: an open staged key still blocks.
        $readiness //= open_options(
            $info->{health_checks} // {},
            {},
            {},
            $info->{service_cipher},
            {%$state},
            $sessions,
            $info->{exported},
            $files,
            $describe,
            $info->{lockbox_status} // $info->{lockbox} // {},
            $info->{storage_copy_problems} // {},
        );
        return $readiness->{waiting_details}->{$entity}
            // "client refresh awaits your confirmation with '--confirm-clients-refreshed"
            . " $entity --apply'. Confirm only after refreshing every client, including"
            . " disconnected ones and external key copies.";
    };

    # A key with an open staged record is resolved by its confirmation, so its one line names
    # what holds that up; a key without one needs its rotation option first.
    my @old_keys;
    my $covered = {};
    for my $entity (sort keys %{ $info->{exported} // {} }) {
        my $entry = $info->{exported}->{$entity};
        my $old_active = (key_cipher($entry->{key}) // -1) != $CIPHER_ID;
        my $old_pending =
            defined($entry->{pending_key})
            && length($entry->{pending_key})
            && (key_cipher($entry->{pending_key}) // -1) != $CIPHER_ID;
        next if !$old_active && !$old_pending;
        my $record = $records->{$entity};
        if ($old_active && $staged_open->{$entity} && $record && !defined($record->{cleared})) {
            $covered->{$entity} = 1;
            push @$blockers, "'$entity': " . $refresh_detail->($entity);
            next;
        }
        if ((($info->{lockbox_status} // $info->{lockbox} // {})->{$entity} // {})->{orphaned}) {
            push @$blockers,
                "'$entity' has no OSD in the current map and still uses another cipher;"
                . " '--rotate-lockbox-keys' leaves it unchanged. Run without options for"
                . " verification and removal advice";
            next;
        }
        push @old_keys, "$entity (active)" if $old_active;
        push @old_keys, "$entity (pending)" if $old_pending;
    }
    if (scalar(@old_keys)) {
        my $count = scalar(@old_keys);
        my @shown_keys = @old_keys;
        my $shown = join(', ', splice(@shown_keys, 0, 5));
        $shown .= " and " . scalar(@shown_keys) . " more" if scalar(@shown_keys);
        push @$blockers,
            "$count active or pending keys still use another cipher: $shown (run this without"
            . " '--restrict-ciphers' to see the option for each)";
    }
    push @$blockers, "the stored 'mon.' key still uses another cipher, see '--rotate-mon-key'"
        if defined($info->{pve_mon_key})
        && (key_cipher($info->{pve_mon_key}) // -1) != $CIPHER_ID;

    # the live sessions of a key still on the old cipher would be refused; one line per user,
    # the recorded ones being the subset that predates its rotation
    for my $entity (sort keys %$clients) {
        next if $covered->{$entity};
        my $entry = $info->{exported}->{$entity};
        next if !$entry || (key_cipher($entry->{key}) // -1) == $CIPHER_ID;
        my $live = $clients->{$entity};
        if (my $held = $stale->{$entity}) {
            $covered->{$entity} = 1;
            push @$blockers,
                scalar(@$live)
                . " live client(s) authenticate as '$entity', "
                . scalar(@$held)
                . " of them recorded before its key rotation ("
                . $describe->($held) . ")";
        } else {
            push @$blockers,
                scalar(@$live)
                . " live client(s) authenticate as '$entity' ("
                . $describe->($live)
                . "), whose key they could then no longer use";
        }
    }
    my @open_tools;
    for my $entity (sort keys %$records) {
        next if $covered->{$entity} && $staged_open->{$entity};
        my $mark = $records->{$entity};
        if (my $held = $stale->{$entity}) {
            push @$blockers,
                scalar(@$held)
                . (
                    sessions_judged_by_key($held)
                    ? " live client(s) still authenticate with a previous key of '$entity' ("
                    : " recorded live client(s) may still hold the previous key of '$entity' ("
                )
                . $describe->($held) . ")"
                if !$covered->{$entity};
            next;
        }
        next if defined($mark->{cleared});
        if (grep { $_ eq $entity } $TOOL_CLIENT_KEYS->@*) {
            push @open_tools, $entity;
            next;
        }
        # a client can keep its IO on established connections without any monitor session,
        # so its absence from the sweep proves nothing; only the operator closes a record
        push @$blockers, "'$entity': " . $refresh_detail->($entity);
    }
    if (scalar(@open_tools) == 1) {
        push @$blockers,
            "the rotation of the tool key '$open_tools[0]' awaits '--confirm-clients-refreshed"
            . " $open_tools[0]'; only Ceph's own tools read it, so it needs no client refresh";
    } elsif (scalar(@open_tools)) {
        push @$blockers,
            "the rotations of "
            . scalar(@open_tools)
            . " bootstrap and crash keys await their confirmation, which needs no client"
            . " refresh; '--confirm-all-clients-refreshed' closes them once every open record is"
            . " ready, or '--confirm-clients-refreshed USER' each";
    }
    push @$blockers, "the stored 'mon.' key could not be read, see '--rotate-mon-key'"
        if !defined($info->{pve_mon_key});
    # this monitor option overrides the restriction for as long as it is set
    push @$blockers,
        "the monitors run with 'mon_auth_emergency_allowed_ciphers' set, which overrides the"
        . " restriction; remove it from ceph.conf and restart every monitor first"
        if ($info->{health_checks} // {})->{AUTH_EMERGENCY_CIPHERS_SET};

    return $blockers;
}

sub merge_configured_daemons($daemons, $type, $configured, $existing = undef) {
    my $running = { map { $_->{id} => 1 } @$daemons };
    my $ghosts = [];
    for my $id (sort keys %{ $configured // {} }) {
        next if $running->{$id};
        # a removed daemon can leave its data directory behind, and there is nothing to rotate
        # for it, so it must not block the run
        if ($existing && !exists($existing->{$id})) {
            push @$ghosts, { type => $type, id => "$id", node => $configured->{$id} };
            next;
        }
        push @$daemons, {
            type => $type,
            id => "$id",
            entity => $type eq 'mon' ? 'mon.' : "$type.$id",
            node => $configured->{$id},
            # pvestatd only reports daemons on nodes of this cluster
            managed => 1,
            down => 1,
            $type eq 'osd' && $existing ? ('osd-uuid' => $existing->{$id}) : (),
        };
    }

    return wantarray ? ($daemons, $ghosts) : $daemons;
}

# What a run has to do about a live swap an earlier one did not finish, given its journal entry and
# the key staged right now. Split out from the doing so every interruption point can be tested:
#   verdict  'none'    nothing was journalled, or nothing is staged
#            'clear'   drop the staged key, no copy on disk can hold it yet
#            'commit'  a copy on disk holds it, so the monitors have to take it rather than lose it
#            'foreign' the journal cannot prove ownership of this key, so leave it alone
#   restart  the daemon may hold a key the monitors have moved past, so it cannot stay running
sub resume_verdict($swap, $staged_fingerprint) {
    return { verdict => 'none', restart => 0 } if !$swap;

    # From 'writing' on, a durable copy may already hold the pending key: an OSD's bluestore label
    # is written first, and its data directory is rebuilt from that label at every boot. Dropping
    # the key then would leave the OSD with one no monitor accepts, so commit and let the caller
    # rewrite every copy.
    my $durable = ($swap->{phase} // '') =~ m/^(?:writing|written|committed)$/ ? 1 : 0;
    return { verdict => 'none', restart => $durable } if !defined($staged_fingerprint);

    # A journal without a fingerprint cannot distinguish a key this run staged from one a direct
    # auth writer staged after the run stopped. Preserve every pending key unless ownership is
    # proven by an exact fingerprint match.
    my $mine = defined($swap->{key}) && $swap->{key} eq $staged_fingerprint;
    return { verdict => 'foreign', restart => 0 } if !$mine;

    return { verdict => $durable ? 'commit' : 'clear', restart => $durable };
}

sub touched_daemons($info, $plan) {
    my @touched = $plan->{daemons}->@*;
    push @touched, $info->{daemons}->{mon}->@* if $plan->{mon_key} && !$plan->{mon_repair_only};

    return @touched;
}

# A lockbox key looks ordinary, but its only persistent copy is an LVM tag on the OSD it unlocks,
# so rotating the auth entry just breaks that OSD's next activation.
# Health can lag both key creation and retirement. A complete export is authoritative, including
# entries absent from the health details and entries removed since the last health update.
sub classify_insecure_clients($checks, $storage_entities = {}, $exported = undef, $lockbox = {}) {
    my $found = {};
    if (ref($exported) eq 'HASH') {
        for my $entity (grep { m/^client\./ } keys %$exported) {
            my $entry = $exported->{$entity};
            next if ref($entry) ne 'HASH' || !defined($entry->{key});
            $found->{$entity} = 1
                if (key_cipher($entry->{key}) // -1) != $CIPHER_ID
                || (($lockbox->{$entity} // {})->{orphaned}
                    && length($entry->{pending_key} // '')
                    && (key_cipher($entry->{pending_key}) // -1) != $CIPHER_ID);
        }
    } else {
        my $check = $checks->{AUTH_INSECURE_CLIENT_KEY_TYPE};
        for my $detail (((defined($check) ? $check->{detail} : undef) // [])->@*) {
            my $message = $detail->{message} // '';
            $found->{$1} = 1 if $message =~ m/^entity (\S+) using insecure key type: \S+$/;
        }
    }

    my $res = {
        lockbox => [],
        orphaned_lockbox => [],
        tool => [],
        admin => [],
        storage => [],
        other => [],
    };
    for my $entity (sort keys %$found) {
        my $bucket =
            $entity =~ m/^client\.osd-lockbox\./
            && ($lockbox->{$entity} // {})->{orphaned} ? 'orphaned_lockbox'
            : $entity =~ m/^client\.osd-lockbox\./ ? 'lockbox'
            : $entity eq $ADMIN_ENTITY ? 'admin'
            : (grep { $_ eq $entity } $TOOL_CLIENT_KEYS->@*) ? 'tool'
            : $storage_entities->{$entity} ? 'storage'
            : 'other';
        push $res->{$bucket}->@*, $entity;
    }
    return $res;
}

# Only the options that can still change something. 'stuck' holds the keys none of them reach, for
# the caller to report rather than offer.
sub open_options(
    $checks,
    $opts,
    $storage_entities,
    $service_cipher = $CIPHER,
    $state = {},
    $sessions = undef,
    $exported = undef,
    $files = {},
    $describe = \&session_hosts,
    $lockbox = {},
    $storage_problems = {},
) {
    my $clients = classify_insecure_clients($checks, $storage_entities, $exported, $lockbox);
    my $done = $opts->{'rotate-storage-key'} // [];
    # a key staged with every copy written is still on the old cipher, but its next step is the
    # confirmation, not the rotation option again
    my $awaiting = sub($entity) {
        my $record = ($state->{staged} // {})->{$entity};
        return $record && $record->{written} ? 1 : 0;
    };

    my ($next, $hedge) = ([], 0);
    push @$next, "--rotate-client-keys: the bootstrap keys and 'client.crash'"
        if scalar($clients->{tool}->@*) && !$opts->{'rotate-client-keys'};
    if (
        scalar($clients->{admin}->@*)
        && !$opts->{'rotate-admin-key'}
        && !$awaiting->($ADMIN_ENTITY)
    ) {
        push @$next,
            "--rotate-admin-key: '$ADMIN_ENTITY' and the copies of it that Proxmox VE keeps";
        $hedge = 1;
    }
    my @storage_open;
    for my $entity ($clients->{storage}->@*) {
        next if $awaiting->($entity);
        my $stores = $storage_entities->{$entity};
        next if grep {
            my $store = $_;
            grep { $_ eq $store } @$done
        } @$stores;
        push @storage_open,
            "'$entity' ("
            . (scalar(@$stores) > 1 ? 'storages ' : 'storage ')
            . join(', ', @$stores) . ")";
    }
    # Storage IDs can share one Ceph user, so offer the complete user inventory in bulk.
    my $storage_bulk = $opts->{'rotate-all-storage-keys'} ? 0 : scalar(@storage_open);
    if ($storage_bulk) {
        my $users = $storage_bulk == 1 ? 'user' : 'users';
        push @$next,
            "--rotate-all-storage-keys: stage keys for $storage_bulk dedicated storage $users";
        $hedge = 1;
    }
    # the monitors recount a moment behind, so a run that passed the option is not offered it
    # again, nor warned off doing by hand what it just did
    my $lockbox_open = scalar($clients->{lockbox}->@*) && !$opts->{'rotate-lockbox-keys'} ? 1 : 0;
    push @$next,
        "--rotate-lockbox-keys: the lockbox key of every encrypted OSD, in the auth"
        . " database and in the LVM tag it is rebuilt from"
        if $lockbox_open;

    # a rotation this run cannot see the end of is a step of its own, and it comes before the
    # cipher restriction, which no record may survive
    my $records = $state->{client_refresh} // {};
    my $picture = $sessions // { complete => 0, clients => {} };
    my $stale = stale_consumers($picture, $records, session_key_targets($exported));
    my (@waiting, @ready);
    my ($waiting_details, $waiting_sessions) = ({}, {});
    my $key_states =
        ref($exported) eq 'HASH'
        ? staged_records({ exported => $exported }, $state)
        : {};
    my $all_ready_for_aggregate = 1;

    my $entities = { %$records, %{ $state->{staged} // {} } };
    for my $entity (sort keys %$entities) {
        my $cleared = defined(($records->{$entity} // {})->{cleared});
        next if $cleared && !$stale->{$entity} && !$state->{staged}->{$entity};

        my $decision = ack_decision($entity, $state, $picture, $stale);
        my $verdict = $decision->{verdict};
        # a staged key whose copies are not all written yet must not be committed: the
        # confirmation would drop the key those copies still hold
        my $staged = $state->{staged}->{$entity};
        my $aborting = $staged && $staged->{aborting};
        my $key_state = $staged ? ($key_states->{$entity} // 'unknown') : 'none';
        my $target = $aborting ? $staged->{abort_key} : ($staged // {})->{key};
        my $mounts = $staged
            && (
                mount_refresh_pending($state, $entity)
                || (
                    defined($target)
                    && mount_refresh_required(
                        $state, $entity, { files => $files->{$entity} // [] }, $target,
                    )
                )
            );
        my $unwritten = $staged && (!$staged->{written} || $mounts);
        my $unresolved_key = $staged && $key_state !~ m/^(?:waiting|committed)$/;

        my $copy_problems = $storage_problems->{$entity} // [];
        if (
            !$cleared
            && $verdict eq 'accept'
            && !$unwritten
            && !$aborting
            && !$unresolved_key
            && !scalar(@$copy_problems)
        ) {
            push @ready, $entity;
            $all_ready_for_aggregate = 0
                if $records->{$entity}->{measurement_incomplete}
                || !defined($records->{$entity}->{session_ids});
        } else {
            push @waiting, $entity;
            $all_ready_for_aggregate = 0;

            my $both = $key_state eq 'waiting' ? ' Both keys remain valid.' : '';
            if (scalar(@$copy_problems)) {
                $waiting_details->{$entity} = join(' ', @$copy_problems);
            } elsif ($key_state eq 'unknown') {
                $waiting_details->{$entity} =
                    "the staged key cannot be matched to the current auth database."
                    . " Resolve its recorded state before confirming.";
            } elsif ($key_state eq 'lost') {
                $waiting_details->{$entity} =
                    $aborting
                    ? "the recorded staged key is no longer pending. Run this with '--apply'"
                    . " to reconcile the rollback and managed copies."
                    : "the recorded staged key is neither pending nor active. Rerun its rotation"
                    . " option with '--apply' after resolving any unrelated pending key.";
            } elsif ($key_state eq 'committed' && ($aborting || $unwritten)) {
                $waiting_details->{$entity} =
                    "the staged key is already active; the previous key no longer authenticates."
                    . " Run this with '--apply' to finish managed copies and CephFS refreshes.";
            } elsif ($aborting) {
                my $reverse = reverse_session_status($picture, $exported, $entity);
                my @held = map { $reverse->{$_}->@* } qw(pending unknown other);
                $waiting_sessions->{$entity} = \@held if @held;
                my @problems;
                push @problems,
                    scalar($reverse->{pending}->@*) . ' session(s) still use the staged key'
                    if $reverse->{pending}->@*;
                push @problems,
                    scalar($reverse->{unknown}->@*) . ' session(s) have no key fingerprint'
                    if $reverse->{unknown}->@*;
                push @problems, scalar($reverse->{other}->@*) . ' session(s) use an unexpected key'
                    if $reverse->{other}->@*;
                my $detail;

                if (!$staged->{abort_written} || !defined($staged->{abort_key})) {
                    $detail = "rollback preparation is incomplete.$both Run this with '--apply'"
                        . " to restore managed copies.";
                } elsif (key_fingerprint($exported->{$entity}->{key}) ne $staged->{abort_key}) {
                    $detail = "the active key changed after rollback preparation. Run this with"
                        . " '--apply' to restore managed copies before confirming.";
                } elsif ($mounts) {
                    $detail = "rollback is prepared.$both "
                        . mount_refresh_hint($state, $entity, $files->{$entity} // []);
                } elsif (!$picture->{complete}) {
                    $detail =
                        "rollback verification is incomplete.$both Retry after every monitor answers.";
                    my $missing = join(', ', @{ $picture->{unanswered} // [] });
                    $detail .= " Monitors that did not answer: $missing." if length($missing);
                } elsif (@problems) {
                    $detail =
                        "rollback is prepared.$both "
                        . join('; ', @problems) . ' ('
                        . $describe->(\@held) . ').';
                    $detail .= ' Refresh clients using another key to the restored key.'
                        if $reverse->{pending}->@* || $reverse->{other}->@*;
                    $detail .= ' ' . session_key_support_hint() if $reverse->{unknown}->@*;
                } else {
                    $detail = "rollback is prepared.$both "
                        . (
                            $reverse->{current}->@*
                            ? 'All visible sessions use the restored key.'
                            : 'No session is currently visible.'
                        )
                        . " After refreshing disconnected clients and external copies, use"
                        . " '--confirm-abort-clients-refreshed $entity --apply'.";
                }
                $waiting_details->{$entity} = $detail;
            } elsif ($unwritten) {
                $waiting_details->{$entity} =
                    $mounts
                    ? "the new key is staged.$both "
                    . mount_refresh_hint($state, $entity, $files->{$entity} // [])
                    : "the new key is not written to every managed copy.$both"
                    . " Rerun its rotation option with '--apply' to finish distribution.";
            } elsif ($verdict eq 'incomplete') {
                my $which = join(', ', @{ $picture->{unanswered} // [] });
                my $reason =
                    length($which)
                    ? "Monitors that did not answer: $which."
                    : "Not every monitor answered.";
                $waiting_details->{$entity} = "client verification is incomplete. $reason$both"
                    . " Retry after every monitor answers.";
            } elsif ($verdict eq 'unidentified') {
                $waiting_sessions->{$entity} = $decision->{held};
                $waiting_details->{$entity} =
                    scalar($decision->{held}->@*)
                    . " session(s) have no key fingerprint.$both "
                    . session_key_support_hint();
            } elsif ($verdict eq 'measure') {
                $waiting_details->{$entity} =
                    "the first complete client measurement is"
                    . " pending.$both After refreshing every client, run"
                    . " '--confirm-clients-refreshed $entity --apply'; the first attempt records"
                    . " the measurement without committing the key.";
            } elsif ($verdict eq 'connected') {
                my $count = scalar($decision->{held}->@*);
                my $held = $decision->{held};
                $waiting_sessions->{$entity} = $held;
                my $why =
                    sessions_judged_by_key($held)
                    ? 'still authenticate with a previous key'
                    : 'may still hold the previous key';
                $waiting_details->{$entity} =
                    "$count session(s) $why ("
                    . $describe->($held)
                    . ").$both Refresh these clients, then rerun without options.";
            } else {
                $waiting_details->{$entity} = "client refresh is not confirmed.$both Refresh"
                    . " every client, then rerun without options.";
            }
        }
    }

    # The wipe is an escape hatch, not a next step: the rotating keys expire on their own, so
    # it is named only when asked for details. A run narrowed by '--only' is refused the wipe
    # until the service cipher is switched, and the fresh action guard refuses it while the
    # session picture or a refresh record is unresolved.
    push @$next,
        "--wipe-rotating-keys: NOT RECOMMENDED; invalidate every service ticket instead of"
        . " waiting a few hours for the old rotating keys to expire; every client and service"
        . " daemon must support '$CIPHER'"
        if $opts->{verbose}
        && $checks->{AUTH_INSECURE_ROTATING_SERVICE_KEY_TYPE}
        && !$opts->{'wipe-rotating-keys'}
        && !($opts->{only} && $service_cipher ne $CIPHER)
        && (!$sessions || $picture->{complete})
        && !@waiting
        && !@ready;

    # The cluster-owned keys can be rotated together without a client decision. The aggregate
    # option also safely selects categories that are already done. Keep client.admin, Ceph storage
    # users, and the ticket wipe out; their clients can sit outside this cluster.
    my $cluster_keys = grep {
        my $entry = $_;
        grep { $entry =~ m/^\Q$_\E[: ]/ }
            ('--rotate-mon-key', '--rotate-client-keys', '--rotate-lockbox-keys')
    } @$next;
    my $together = [];
    push @$together, '--rotate-cluster-keys' if $cluster_keys;
    push @$together, '--restrict-ciphers'
        if grep { m/^--restrict-ciphers[: ]/ } @$next;

    return {
        next => $next,
        together => $together,
        waiting => \@waiting,
        waiting_details => $waiting_details,
        waiting_sessions => $waiting_sessions,
        ready => \@ready,
        all_ready_for_aggregate => $all_ready_for_aggregate,
        stuck => [$clients->{other}->@*],
        orphaned_lockbox => $clients->{orphaned_lockbox},
        lockbox => $lockbox_open,
        storage_bulk => $storage_bulk,
        storage_scope => \@storage_open,
        storage_requirement => "Staging needs Ceph 19.2.6-pve3, 20.2.4-pve3, or newer on every"
            . " monitor.",
        hedge => $hedge,
    };
}

# Add the final step only after asking the same cluster-wide predicate that guards it. The health
# details alone do not cover unmanaged clients, service keys, or work requested by the current run.
sub open_actions(
    $program, $checks, $opts, $storage_entities, $service_cipher, $state, $info,
    $describe = \&session_hosts,
) {
    my $open = open_options(
        $checks,
        $opts,
        $storage_entities,
        $service_cipher,
        $state,
        $info ? $info->{sessions} : undef,
        $info ? $info->{exported} : undef,
        ($info // {})->{client_files} // {},
        $describe,
        ($info // {})->{lockbox_status} // ($info // {})->{lockbox} // {},
        ($info // {})->{storage_copy_problems} // {},
    );
    my $allowed = $info ? $info->{allowed_ciphers} : undef;
    my $preferred = $info ? $info->{preferred_cipher} : undef;
    my $restriction_needed =
        ref($allowed) eq 'ARRAY'
        && scalar(@$allowed)
        && defined($preferred)
        ? ($preferred ne $CIPHER || scalar(grep { $_ ne $CIPHER } @$allowed))
        : $checks->{AUTH_INSECURE_KEYS_ALLOWED};
    my $finish =
        $info && !$opts->{'restrict-ciphers'} && $restriction_needed
        ? finish_after_acks($info, $state, $open->{ready})
        : 0;

    if ($finish && !scalar($open->{ready}->@*) && !scalar($open->{next}->@*)) {
        push $open->{next}->@*,
            "--restrict-ciphers: allow only the '$CIPHER' cipher for authentication, once every"
            . " running client holds its rotated key";
        push $open->{together}->@*, '--restrict-ciphers';
    }

    if (scalar($open->{ready}->@*)) {
        my $confirmations = !$open->{all_ready_for_aggregate}
            ? join(
                ' ',
                map {
                    "--confirm-clients-refreshed " . PVE::Tools::shellquote($_)
                } $open->{ready}->@*,
            )
            : '--confirm-all-clients-refreshed';
        $open->{command} =
            "$program --apply $confirmations" . ($finish ? ' --restrict-ciphers' : '');
    }

    # A missing next action is not completion: current auth, settings, and recovery state must
    # agree, and no invisible-client confirmation may still be outstanding.
    my @unfinished = unfinished_entities($state);
    my $visible = ($info // {})->{sessions}->{clients} // {};
    my @unmatched = grep {
        my $entry = (($info // {})->{exported} // {})->{$_};
        !$entry || grep {
            my $fingerprint = $_->{key_fingerprint};
            defined($fingerprint)
                && length($fingerprint)
                && $fingerprint ne key_fingerprint($entry->{key});
        } $visible->{$_}->@*;
    } keys %$visible;
    $open->{complete} =
        $info
        && ref($info->{exported}) eq 'HASH'
        && ref($allowed) eq 'ARRAY'
        && scalar(@$allowed)
        && !$restriction_needed
        && defined($preferred)
        && $preferred eq $CIPHER
        && !scalar($open->{next}->@*)
        && !scalar($open->{waiting}->@*)
        && !scalar($open->{ready}->@*)
        && !scalar($open->{stuck}->@*)
        && !scalar(keys %{ $state->{staged} // {} })
        && !scalar(keys %{ $state->{lockbox} // {} })
        && !scalar(@unfinished)
        && !scalar(@unmatched)
        && !$state->{client_grace}
        && !defined($state->{preferred_cipher_was})
        && !$state->{noout_owned}
        && !
        scalar(grep { mount_refresh_pending($state, $_) } keys %{ $state->{mount_refresh} // {} })
        && !
        scalar(grep { defined($_->{pending_key}) && length($_->{pending_key}) }
            values %{ $info->{exported} })
        && !scalar(@{ restrict_blockers($info, $state) }) ? 1 : 0;

    return $open;
}

# as { entity, files, kernel, reason }. Opt-in: only the operator knows what reads a client key
sub plan_client_keys($info, $state, $opts, $files) {
    my $wanted = {};
    if ($opts->{'rotate-client-keys'}) {
        $wanted->{$_} = "Ceph's own tools are the only ones that read it" for @$TOOL_CLIENT_KEYS;
    }
    $wanted->{$ADMIN_ENTITY} = 'asked for with --rotate-admin-key' if $opts->{'rotate-admin-key'};

    if ($opts->{'rotate-all-storage-keys'}) {
        for my $entity (sort keys %$files) {
            next if $entity eq $ADMIN_ENTITY;
            my @stores = sort grep { defined($_) } map { $_->{store} } $files->{$entity}->@*;
            next if !scalar(@stores);
            $wanted->{$entity} = "used by managed local Ceph "
                . (
                    scalar(@stores) == 1
                    ? "storage '$stores[0]'"
                    : "storages " . join(', ', @stores)
                );
        }
    }

    for my $storeid (@{ $opts->{'rotate-storage-key'} // [] }) {
        die "'--rotate-storage-key' needs a storage name\n" if $storeid eq '';

        my ($entity) = grep {
            grep { defined($_->{store}) && $_->{store} eq $storeid } $files->{$_}->@*
        } sort keys %$files;
        if (!$entity) {
            die "no Ceph storage named '$storeid' in the storage configuration, or it points at"
                . " another cluster\n";
        }
        if ($entity eq $ADMIN_ENTITY && !$opts->{'rotate-admin-key'}) {
            die "storage '$storeid' uses '$ADMIN_ENTITY', so add '--rotate-admin-key': every other"
                . " Ceph storage and the command line share that key\n";
        }
        $wanted->{$entity} = "used by storage '$storeid'";
    }

    my $plan = [];
    my $warnings = [];
    my $staged = staged_records($info, $state);
    # 'client.admin' is the broad fallback for the CLI and Ceph storages. Leaving it last
    # reduces the recovery scope if a dedicated Ceph user rotation fails.
    for my $entity (
        sort { ($a eq $ADMIN_ENTITY) <=> ($b eq $ADMIN_ENTITY) || $a cmp $b }
        keys %$wanted
    ) {
        if (!$info->{exported}->{$entity}) {
            push @$warnings,
                "'$entity' ($wanted->{$entity}) has no entry in the authentication database of"
                . " this cluster, so it is left alone";
            next;
        }
        # a key staged by an earlier run with every copy written stays open on purpose until its
        # clients are confirmed; one whose copies are not all written is planned again, and the
        # staging reuses the pending key rather than staging a second one over it. An aborting key
        # only follows the explicit rollback path.
        my $existing = $state->{staged}->{$entity};
        my $mine = $files->{$entity} // [];
        my $mount_refresh = mount_refresh_pending($state, $entity);
        if (
            !$mount_refresh
            && ($staged->{$entity} // '') eq 'waiting'
            && $existing->{written}
        ) {
            $mount_refresh =
                mount_refresh_required($state, $entity, { files => $mine }, $existing->{key});
        }
        next
            if ($staged->{$entity} // '') eq 'waiting'
            && ($existing->{aborting} || ($existing->{written} && !$mount_refresh));
        # 'rotated' without 'done' means copies are missing; with 'done' the kernel check below
        # would refuse a key nobody is changing
        next
            if !needs_rotation($info, $entity)
            && !migration_unfinished($state, $entity)
            && !$mount_refresh;

        # a key this script staged is finished on the staged path whatever the monitors report
        # now: replacing it at once would leave a third key state behind the copies
        my $owned = ($staged->{$entity} // '') eq 'waiting';
        my $bulk =
            $opts->{'rotate-all-storage-keys'}
            && $entity ne $ADMIN_ENTITY
            && grep { defined($_->{store}) } @$mine;
        my $refresh_only = $owned && $existing->{written} && $mount_refresh ? 1 : 0;
        my $new_staging =
            !$owned && needs_rotation($info, $entity) && client_key_stageable($entity) ? 1 : 0;
        my $bulk_new_staging = $bulk && $new_staging ? 1 : 0;
        my $staged = $owned || $new_staging ? 1 : 0;
        push @$plan, {
            entity => $entity,
            files => $mine,
            kernel => (grep { $_->{kernel} } @$mine) ? 1 : 0,
            reason => $wanted->{$entity},
            staged => $staged,
            refresh_only => $refresh_only,
            new_staging => $new_staging,
            bulk_new_staging => $bulk_new_staging,
            # A replacement started by an older helper may already have changed the active key.
            # Finish its managed copies without creating or replacing another key.
            resume_only => !$owned
                && !$staged
                && !needs_rotation($info, $entity)
                && (migration_unfinished($state, $entity) || $mount_refresh)
            ? 1
            : 0,
        };
    }

    return ($plan, $warnings);
}

# An encrypted OSD's lockbox key has two persistent copies that must agree: the auth entry, and a
# 'ceph.cephx_lockbox_secret' LVM tag on that OSD's block device. ceph-volume rebuilds the keyring
# from the tag at every activation and uses it to fetch the LUKS passphrase, so a key is only
# migrated once both hold it. Nothing reads the keyring while the OSD runs.
sub plan_lockbox_keys($info, $opts) {
    return [] if !$opts->{'rotate-lockbox-keys'};

    my $wanted = [];
    for my $entity (sort keys $info->{lockbox}->%*) {
        my $osd = $info->{lockbox}->{$entity};
        # no OSD, no tag to write: the caller names it instead
        next if $osd->{orphaned};
        # matching ciphers are not enough: two different keys both on the new cipher leave the
        # OSD unable to unlock, which is what a half finished run leaves behind
        next
            if ($osd->{cipher} // '') eq $CIPHER
            && ($osd->{tag_cipher} // '') eq $CIPHER
            && $osd->{tag_matches};

        push @$wanted,
            {
                entity => $entity,
                fsid => $osd->{fsid},
                node => $osd->{node},
                id => $osd->{id},
                device => $osd->{device},
                missing => $osd->{missing},
            };
    }
    return $wanted;
}

sub build_plan($info, $state, $opts, $files) {
    my $only = $opts->{only};
    my $plan = {
        mon_key => 0,
        daemons => [],
        service_cipher => 0,
        lockbox_keys => [],
        scoped => $only ? 1 : 0,
    };

    # Rotating 'mon.' restarts the quorum, hence opt-in. A repair or a resume restarts nothing.
    # Completion markers name their target key, so a marker from an older rotation is not enough.
    # 'previous_keys' is saved before 'auth rotate' and 'rotated' after it, so either marks a
    # rotation the monitors still have to be carried through.
    my $mon_wanted = !$only || $only->{mon};
    my $mon_target = $info->{mon_entry}->{key};
    my $mon_started = $state->{rotated}->{'mon.'} || $state->{previous_keys}->{'mon.'};
    my $resume_mon = $mon_started
        && (!defined($mon_target)
            || ($state->{mon_key_complete} // '') ne key_fingerprint($mon_target));
    if (
        $resume_mon
        || ($mon_wanted && mon_keyring_stale($info))
        || mon_key_rotation_wanted($info, $opts)
    ) {
        $plan->{mon_key} = 1;
    }
    if ($plan->{mon_key} && !$resume_mon && !mon_key_rotation_wanted($info, $opts)) {
        $plan->{mon_repair_only} = 1;
    }

    for my $type (@$DAEMON_TYPES) {
        next if $only && !$only->{$type} && !grep { m/^\Q$type\E\./ } keys %$only;

        # Restarting a standby costs no failover, so the active manager goes last: a fallback
        # restart there fails over onto one already migrated.
        my $daemons = [$info->{daemons}->{$type}->@*];
        $daemons = [sort { ($a->{active} // 0) <=> ($b->{active} // 0) } @$daemons]
            if $type eq 'mgr';

        for my $daemon (@$daemons) {
            next if $only && !$only->{$type} && !$only->{ $daemon->{entity} };
            my $unfinished = migration_unfinished($state, $daemon->{entity});
            # Not the marker alone: a reused OSD id gets a fresh key that needs migrating like any
            # other.
            if (
                !$unfinished
                && $state->{done}->{ $daemon->{entity} }
                && !needs_rotation($info, $daemon->{entity})
            ) {
                next;
            }
            if ($daemon->{recovered}) {
                push $plan->{daemons}->@*, $daemon;
                next;
            }
            # 'previous_keys' is written before the rotation and 'rotated' after, so one without the
            # other means the auth db moved on and the daemon did not
            if (
                !$unfinished
                && !needs_rotation($info, $daemon->{entity})
                && !$state->{rotated}->{ $daemon->{entity} }
                && !$state->{previous_keys}->{ $daemon->{entity} }
            ) {
                next;
            }
            push $plan->{daemons}->@*, $daemon;
        }
    }

    my ($clients, $warnings) = plan_client_keys($info, $state, $opts, $files);
    $plan->{client_keys} = $clients;
    $plan->{warnings} = $warnings;

    # the switch locks out every key still on the old one, so only a full run may do it
    $plan->{service_cipher} = 1 if !$only && $info->{service_cipher} ne $CIPHER;

    $plan->{lockbox_keys} = plan_lockbox_keys($info, $opts);

    # a pending key takes its cipher from 'auth_preferred_cipher', so any path that stages one
    # needs that setting pointed at the new cipher for the run
    $plan->{stages_pending_keys} =
        (!$opts->{'restart-daemons'} && scalar($plan->{daemons}->@*))
        || scalar($plan->{lockbox_keys}->@*)
        || scalar(grep { $_->{staged} } @$clients) ? 1 : 0;

    return $plan;
}

1;
