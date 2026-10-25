package PVE::API2::Cluster::Ceph;

use strict;
use warnings;

use JSON;
use Time::HiRes qw(time);

use PVE::APIClient::LWP;
use PVE::Ceph::Services;
use PVE::Ceph::Tools;
use PVE::Cluster;
use PVE::Exception qw(raise_param_exc);
use PVE::INotify;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RADOS;
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::SafeSyslog;
use PVE::Tools qw(extract_param);
use PVE::UPID;

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'cephindex',
    path => '',
    method => 'GET',
    description => "Cluster ceph index.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {},
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        my $result = [
            { name => 'flags' },
            { name => 'health-mute' },
            { name => 'metadata' },
            { name => 'restart-bulk' },
            { name => 'status' },
        ];

        return $result;
    },
});

my $metadata_common_props = {
    hostname => {
        type => "string",
        description => "Hostname on which the service is running.",
    },
    ceph_release => {
        type => "string",
        description => "Ceph release codename currently used.",
    },
    ceph_version => {
        type => "string",
        description => "Version info currently used by the service.",
    },
    ceph_version_short => {
        type => "string",
        description => "Short version (numerical) info currently used by the service.",
    },
    mem_total_kb => {
        type => "integer",
        description => "Memory consumption of the service.",
    },
    mem_swap_kb => {
        type => "integer",
        description => "Memory of the service currently in swap.",
    },
};

__PACKAGE__->register_method({
    name => 'metadata',
    path => 'metadata',
    method => 'GET',
    description => "Get ceph metadata.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            scope => {
                type => 'string',
                optional => 1,
                default => 'all',
                enum => ['all', 'versions'],
                description => "Which metadata facet to return: 'all' enriches the per-daemon"
                    . " metadata with the PVE-side service state (presence of unit, data"
                    . " directory), 'versions' collects only per-node Ceph binary version data.",
            },
        },
    },
    returns => {
        type => 'object',
        description => "Items for each type of service containing objects for each instance.",
        properties => {
            mds => {
                type => "object",
                description => "Metadata servers configured in the cluster and their"
                    . " properties, keyed by '<name>@<host>'.",
                additionalProperties => {
                    type => "object",
                    description => "Useful properties are listed, but not the full list.",
                    additionalProperties => 1,
                    properties => {
                        addr => {
                            type => "string",
                            description => "Bind addresses and ports.",
                            optional => 1,
                        },
                        name => {
                            type => "string",
                            description => "Name of the service instance.",
                            optional => 1,
                        },
                        %{$metadata_common_props},
                    },
                },
            },
            mgr => {
                type => "object",
                description => "Managers configured in the cluster and their properties,"
                    . " keyed by '<name>@<host>'.",
                additionalProperties => {
                    type => "object",
                    description => "Useful properties are listed, but not the full list.",
                    additionalProperties => 1,
                    properties => {
                        addr => {
                            type => "string",
                            description => "Bind address.",
                            optional => 1,
                        },
                        name => {
                            type => "string",
                            description => "Name of the service instance.",
                            optional => 1,
                        },
                        %{$metadata_common_props},
                    },
                },
            },
            mon => {
                type => "object",
                description => "Monitors configured in the cluster and their properties,"
                    . " keyed by '<name>@<host>'.",
                additionalProperties => {
                    type => "object",
                    description => "Useful properties are listed, but not the full list.",
                    additionalProperties => 1,
                    properties => {
                        addrs => {
                            type => "string",
                            description => "Bind addresses and ports.",
                            optional => 1,
                        },
                        name => {
                            type => "string",
                            description => "Name of the service instance.",
                            optional => 1,
                        },
                        %{$metadata_common_props},
                    },
                },
            },
            node => {
                type => "object",
                description => "Ceph version installed on the nodes, keyed by node name.",
                additionalProperties => {
                    type => "object",
                    additionalProperties => 1,
                    properties => {
                        buildcommit => {
                            type => "string",
                            description => "GIT commit used for the build.",
                        },
                        version => {
                            type => "object",
                            description => "Version info.",
                            properties => {
                                str => {
                                    type => "string",
                                    description => "Version as single string.",
                                },
                                parts => {
                                    type => "array",
                                    description => "Major, minor and patch version numbers.",
                                    items => {
                                        type => "string",
                                        description => "Version-component string.",
                                    },
                                },
                            },
                        },
                    },
                },
            },
            osd => {
                type => "array",
                description => "OSDs configured in the cluster and their properties.",
                items => {
                    type => "object",
                    description => "Useful properties are listed, but not the full list.",
                    properties => {
                        id => {
                            type => "integer",
                            description => "OSD ID.",
                        },
                        front_addr => {
                            type => "string",
                            description =>
                                "Bind addresses and ports for frontend traffic to OSDs.",
                        },
                        back_addr => {
                            type => "string",
                            description =>
                                "Bind addresses and ports for backend inter OSD traffic.",
                        },
                        devices => {
                            type => "string",
                            optional => 1,
                            description =>
                                "Comma-joined list of underlying device names (e.g. 'sdb,sdc').",
                        },
                        device_ids => {
                            type => "string",
                            optional => 1,
                            description => "Comma-joined list of device identifiers"
                                . " (e.g. 'sdb=<serial>,sdc=<serial>').",
                        },
                        device_paths => {
                            type => "string",
                            optional => 1,
                            description => "Comma-joined list of /dev/disk/by-path entries"
                                . " for the underlying devices.",
                        },
                        osd_data => {
                            type => "string",
                            description => "Path to the OSD data directory.",
                        },
                        osd_objectstore => {
                            type => "string",
                            description => "OSD objectstore type.",
                        },
                        %{$metadata_common_props},
                    },
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $scope = $param->{scope} // 'all';

        my $res = {};

        if (defined(my $versions = PVE::Ceph::Services::get_ceph_versions())) {
            $res->{node} = $versions;
        }

        return $res if ($scope eq 'versions');

        # only check now, we want to allow calls with scope 'versions' on non-ceph nodes too!
        PVE::Ceph::Tools::check_ceph_inited();
        my $rados = PVE::RADOS->new();
        my $nodes = { map { $_ => 1 } PVE::Cluster::get_nodelist()->@* };

        for my $type (qw(mon mgr mds)) {
            my $typedata = PVE::Ceph::Services::get_cluster_service($type);
            my $data = {};
            for my $host (sort keys %$typedata) {
                for my $service (sort keys %{ $typedata->{$host} }) {
                    $data->{"$service\@$host"} = $typedata->{$host}->{$service};
                }
            }

            # get data from metadata call and merge 'our' data
            my $services = $rados->mon_command({ prefix => "$type metadata" });
            for my $service (@$services) {
                my $hostname = PVE::Ceph::Services::metadata_host_node(
                    $service->{hostname}, $nodes,
                );
                next if !defined($hostname); # can happen if node is dead
                $service->{hostname} = $hostname;

                my $servicename = $service->{name} // $service->{id};
                my $id = "$servicename\@$hostname";

                if ($data->{$id}) { # copy values over to the metadata hash
                    for my $k (keys %{ $data->{$id} }) {
                        $service->{$k} = $data->{$id}->{$k};
                    }
                }
                $data->{$id} = $service;
            }

            $res->{$type} = $data;
        }

        $res->{osd} = $rados->mon_command({ prefix => "osd metadata" });

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'status',
    path => 'status',
    method => 'GET',
    description => "Get ceph status.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => { type => 'object' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados = PVE::RADOS->new();
        my $status = PVE::Ceph::Tools::ceph_cluster_status($rados);

        return PVE::Ceph::Services::annotate_restart_blocking($status, $rados);
    },
});

# Builds an APIClient to localhost:8006 so cross-node subrequests get proxied through pveproxy.
# Mirrors PVE::API2::Cluster::BulkAction::Guest::create_client. Tickets have a ~2h TTL; bulk
# restarts that exceed that lose remote-call auth - matches the existing precedent's tradeoff.
my sub create_client {
    my $rpcenv = PVE::RPCEnvironment::get();
    my $authuser = $rpcenv->get_user();
    my $credentials = $rpcenv->get_credentials();

    my $node = PVE::INotify::nodename();
    my $fingerprint = PVE::Cluster::get_node_fingerprint($node);

    my $client = PVE::APIClient::LWP->new(
        protocol => 'https',
        host => 'localhost',
        port => 8006,
        username => $authuser,
        ticket => $credentials->{ticket},
        api_token => $credentials->{api_token},
        timeout => 30,
        cached_fingerprints => { $fingerprint => 1 },
    );

    if (defined(my $csrf_token = $credentials->{token})) {
        $client->update_csrftoken($csrf_token);
    }

    return $client;
}

# Polls a remote task's status via $client. Bails on consecutive transport errors and on a
# wall-clock deadline of $timeout seconds (so a hung remote node doesn't strand the
# bulk-restart worker forever). $timeout is required - callers pass the per-daemon timeout.
my sub wait_for_remote_task {
    my ($client, $node, $upid, $timeout) = @_;

    die "wait_for_remote_task: \$timeout is required\n" if !$timeout;
    my $deadline = time() + $timeout;
    my $consecutive_errors = 0;
    my $max_consecutive_errors = 5;

    while (time() < $deadline) {
        my $task = eval { $client->get("/nodes/$node/tasks/$upid/status") };
        if (my $err = $@) {
            # A 404 from the proxy routing layer (e.g. unknown URL on a downgraded
            # node) is treated as completion rather than a transport failure - the
            # read_task_status endpoint itself raises 400 not 404 for missing task
            # logs, so this branch only fires for proxy-layer edge cases. Prefer the
            # PVE::Exception's HTTP status code (set by APIClient::LWP via
            # raise(..., code => $response->code)) over substring-matching the message.
            my $http_code = ref($err) ? ($err->{code} // 0) : 0;
            return if $http_code == 404;
            $consecutive_errors++;
            die "polling remote task $upid on $node failed $consecutive_errors times: $err\n"
                if $consecutive_errors >= $max_consecutive_errors;
            sleep(2);
            next;
        }
        $consecutive_errors = 0;
        my $status = $task->{status} // '';
        if ($status ne 'running') {
            my $exit = $task->{exitstatus};
            die "remote task $upid on $node ended with status '$status'"
                . (defined($exit) ? " exit '$exit'" : "") . "\n"
                if !defined($exit) || PVE::UPID::status_is_error($exit);
            return;
        }
        sleep(1);
    }
    die "remote task $upid on $node did not finish within $timeout seconds\n";
}

# Fetches the last meaningful log line from a remote task, used to relay a one-line
# summary of what the sub-task actually did into the parent task log. Returns undef
# if the log can not be read or has no informative line.
#
# The read_task_log API paginates from $start with $limit, so we first probe the
# total line count via get_raw (which surfaces the 'total' result attribute) and
# then fetch the final 50-line window. A naive { limit => 50 } would return the
# FIRST 50 lines and miss the summary on any sub-task with more output.
my sub remote_task_summary {
    my ($client, $node, $upid) = @_;
    my $probe =
        eval { $client->get_raw("/nodes/$node/tasks/$upid/log", { start => 0, limit => 1 }); };
    return undef if $@ || !$probe || !defined($probe->{total});
    my $total = $probe->{total};
    my $start = $total > 50 ? $total - 50 : 0;
    my $log =
        eval { $client->get("/nodes/$node/tasks/$upid/log", { start => $start, limit => 50 }); };
    return undef if $@ || ref($log) ne 'ARRAY';
    for my $entry (reverse @$log) {
        my $line = $entry->{t} // '';
        next if !length($line) || $line =~ /^\s*TASK (OK|ERROR)\b/i;
        return $line;
    }
    return undef;
}

__PACKAGE__->register_method({
    name => 'restart_bulk',
    path => 'restart-bulk',
    method => 'POST',
    description => "Cluster-wide rolling restart of all Ceph daemons of the given type. For"
        . " MON/MGR/MDS each daemon is restarted only after Ceph reports the previous one is"
        . " back up and the next one is safe to stop. For OSDs the cluster path orchestrates"
        . " the per-node endpoint at /nodes/{node}/ceph/restart-bulk on each node in turn,"
        . " inheriting that endpoint's per-OSD 'noout' handling and resume support. The"
        . " 'noout' flag itself is not exposed by this endpoint as it is OSD-specific (and"
        . " for OSDs handled by the per-node sub-tasks).",
    protected => 1,
    # Required so the worker can reuse the caller's credentials to authenticate cross-node
    # API calls (otherwise $rpcenv->get_credentials() dies with 'credentials not set').
    expose_credentials => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            'service-type' => {
                description => 'Ceph daemon type to restart cluster-wide.',
                type => 'string',
                enum => ['mon', 'mgr', 'mds', 'osd'],
            },
            timeout => {
                description => "Per-daemon timeout (in seconds) for the up-wait phase. Note:"
                    . " for daemons on remote nodes the same timeout also bounds the remote"
                    . " restart task, so the per-daemon budget can be up to 2x this value."
                    . " Default sized for slow MDS journal replay or MON paxos settle on"
                    . " busy clusters; bump higher if the cluster routinely takes longer to"
                    . " stabilize after a daemon restart.",
                type => 'integer',
                minimum => 30,
                maximum => 1800,
                optional => 1,
                default => 600,
            },
            'dry-run' => {
                description => "Log the plan (which daemons would be restarted, in what order)"
                    . " without actually doing anything.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            force => {
                description => "Proceed past a HEALTH_WARN with non-benign checks like"
                    . " PG_DEGRADED, SLOW_OPS, or MON_DOWN. A blocking HEALTH_ERR is fatal"
                    . " regardless of this flag. Checks that ceph reports as muted, and checks"
                    . " known to be harmless for a rolling restart, never block and are named"
                    . " in the task log. The cluster-wide OSD map flags are only ever"
                    . " evaluated for an OSD restart, since they govern nothing a mon, mgr or"
                    . " mds restart touches. Likewise, a missing active manager (MGR_DOWN) only"
                    . " blocks an OSD restart, as only the OSD safety check needs a manager."
                    . " The operator is responsible for confirming the cluster is stable enough"
                    . " to absorb a rolling restart.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            'only-outdated' => {
                description => "OSDs only: restart only OSDs whose running version differs from"
                    . " the locally-installed ceph-osd binary on their host. Forwarded to each"
                    . " per-node sub-task so the per-host installed version is used (a partial"
                    . " upgrade where one host is on a newer build is handled correctly).",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();
        my $type = $param->{'service-type'};
        my $timeout = $param->{timeout} // 600;
        my $dry_run = $param->{'dry-run'} // 0;
        my $force = $param->{force} // 0;
        my $only_outdated = $param->{'only-outdated'} // 0;

        raise_param_exc({ 'only-outdated' => "only supported with service-type=osd" })
            if $only_outdated && $type ne 'osd';

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados; # populated after fork
        my $worker = sub {
            my $upid = shift;

            # Use the ResilientRados wrapper for transparent reconnect on dead-connection
            # failures. A 60s mon-command timeout (rather than the 5s default) gives a
            # mon election or MDS/MGR settle burst room to recover without tripping the
            # internal kill_worker path; the wrapper picks up whatever single-call
            # failures still slip through.
            $rados = PVE::Ceph::Services::ResilientRados->new(timeout => 60);

            # Entry health check: HEALTH_ERR blockers always refuse, HEALTH_WARN blockers
            # need force=1. Skipped on dry-run so operators can still inspect a marginal
            # cluster.
            if (!$dry_run) {
                my ($ok, $sev, $blockers, $ignored) =
                    PVE::Ceph::Services::check_health_acceptable($rados, $force, $type);

                # Printed before the refusal too: a cluster the GUI shows as HEALTH_ERR is
                # exactly where an operator needs to know which errors were stepped over.
                print "NOTE: not blocking on health check(s) considered safe for a rolling"
                    . " restart, or muted by an operator:\n  - "
                    . join("\n  - ", @$ignored) . "\n"
                    if @$ignored;
                if (!$ok) {
                    die "could not evaluate ceph health, refusing rolling restart of"
                        . " '$type' daemons:\n  - "
                        . join("\n  - ", @$blockers) . "\n"
                        if $sev eq 'HEALTH_FETCH_FAIL';

                    if ($sev eq 'HEALTH_ERR') {
                        die "Ceph cluster has blocking HEALTH_ERR issues, refusing rolling"
                            . " restart of '$type' daemons (force cannot override those):\n  - "
                            . join("\n  - ", @$blockers) . "\n";
                    }
                    die "Ceph cluster has blocking HEALTH_WARN issues, refusing rolling"
                        . " restart of '$type' daemons (pass force=1 to override):\n  - "
                        . join("\n  - ", @$blockers) . "\n";
                }
                if ($force && @$blockers) {
                    print "WARNING: proceeding past HEALTH_WARN blockers due to force=1:\n"
                        . "  - "
                        . join("\n  - ", @$blockers) . "\n";
                }
            }

            my $cfg = PVE::Cluster::cfs_read_file('ceph.conf');
            my $known_nodes = { map { $_ => 1 } PVE::Cluster::get_nodelist()->@* };

            if ($type eq 'osd') {
                # OSD bulk-restart is per-node by design (one safety/noout cycle per node,
                # systemd-driven enumeration, resume state keyed by node). Cluster-wide
                # just orchestrates per-node restart-bulk calls in sequence: each node's
                # task acquires its own with_bulk_restart_lock and handles per-OSD noout
                # set/unset. The cluster-wide soft lock keeps two cluster-OSD operators
                # on different cluster nodes from racing; we deliberately do NOT take the
                # local file lock here because the local-node sub-task would deadlock on
                # it.
                #
                # The orchestrator keeps no checkpoint of its own; it rebuilds the plan
                # from the current cluster state on every invocation. A re-issued call
                # after an orchestrator death is therefore self-healing: a node whose
                # per-node checkpoint is still present is resumed (see the resume handling
                # below), already-finished nodes have no checkpoint and no-op, and not-yet-
                # started nodes run fresh.

                my $osd_services = PVE::Ceph::Services::get_cluster_service('osd');
                my @osd_nodes;
                for my $host (sort keys %$osd_services) {
                    next if !$known_nodes->{$host}; # skip stale ceph.conf entries
                    my $count = scalar(keys %{ $osd_services->{$host} // {} });
                    push @osd_nodes, [$host, $count] if $count > 0;
                }

                # When filtering to outdated OSDs, approximate per-host counts by comparing
                # each OSD's running ceph_version_short to the host's broadcast ceph version
                # and prune hosts with 0 outdated from the plan. Avoids pointless inter-node
                # recovery waits and a misleading "starting per-node bulk-restart" log line
                # for sub-tasks that immediately no-op. The per-node sub-task does the
                # authoritative exact-version check.
                if ($only_outdated) {
                    my $osd_meta = eval {
                        $rados->mon_command({
                            prefix => 'osd metadata',
                            format => 'json',
                        });
                    };
                    my $node_vers = PVE::Ceph::Services::get_ceph_versions() // {};
                    # If a host's broadcast ceph version is missing (fresh node, pvestatd
                    # not yet broadcast) count its OSDs as outdated; the per-node sub-task
                    # does the authoritative check. Same permissive treatment as the UI
                    # dialog so the run actually visits hosts the dialog showed work for.
                    my %outdated_count;
                    for my $osd (@{ $osd_meta // [] }) {
                        my $host = PVE::Ceph::Services::metadata_host_node(
                            $osd->{hostname}, $known_nodes,
                        );
                        my $running = $osd->{ceph_version_short};
                        next if !$host || !$running;
                        my $installed = $node_vers->{$host}->{version}->{str};
                        $outdated_count{$host}++ if !$installed || $running ne $installed;
                    }
                    @osd_nodes = map { [$_->[0], $outdated_count{ $_->[0] }] }
                        grep { ($outdated_count{ $_->[0] } // 0) > 0 } @osd_nodes;
                }

                my $node_total = scalar(@osd_nodes);
                if (!$node_total) {
                    print $only_outdated
                        ? "no outdated OSDs found in cluster, nothing to do\n"
                        : "no OSDs found in cluster, nothing to do\n";
                    return;
                }

                my $dry_prefix = $dry_run ? "[DRY-RUN] " : "";
                my $plan_label = $only_outdated ? 'outdated OSDs' : 'OSDs';
                print "${dry_prefix}planned cluster-wide rolling restart of"
                    . " $plan_label (per-node):\n";
                for my $i (0 .. $#osd_nodes) {
                    my ($host, $count) = $osd_nodes[$i]->@*;
                    my $count_label = $only_outdated ? "$count outdated OSDs" : "$count OSDs";
                    print "  [" . ($i + 1) . "/$node_total] $host ($count_label)\n";
                }
                if ($dry_run) {
                    print "[DRY-RUN] no daemons were restarted\n";
                    return;
                }

                PVE::Ceph::Services::with_cluster_bulk_restart_lock(
                    $rados,
                    'cluster-osd',
                    $upid,
                    sub {
                        my $client = create_client();
                        for my $i (0 .. $#osd_nodes) {
                            my ($host, $count) = $osd_nodes[$i]->@*;
                            my $tag = "[" . ($i + 1) . "/$node_total]";

                            # Re-check health before each node (an unrelated failure
                            # mid-run should abort the cluster orchestration cleanly).
                            my $errors =
                                PVE::Ceph::Services::get_blocking_health_errors($rados, $type);
                            die "$tag Ceph reports a blocking HEALTH_ERR mid-restart,"
                                . " aborting:\n  - "
                                . join("\n  - ", @$errors) . "\n"
                                if @$errors;

                            # Between nodes wait until ok-to-stop passes on a sample OSD; the
                            # previous node's restart leaves PGs re-peering which would otherwise
                            # trip the next sub-task's entry health-check.
                            if ($i > 0) {
                                my $osd_set = $osd_services->{$host} // {};
                                my ($sample) =
                                    sort { $a <=> $b } grep { /^\d+$/ } keys %$osd_set;
                                if (defined($sample)) {
                                    print "$tag waiting for recovery to allow restart on $host"
                                        . " (probing osd.$sample, up to ${timeout}s)\n";
                                    my ($safe, $msg) =
                                        PVE::Ceph::Services::wait_for_safe_to_stop(
                                            $rados,
                                            'osd',
                                            $sample,
                                            $timeout,
                                        );
                                    die "$tag recovery did not allow restart on $host: $msg\n"
                                        if !$safe;
                                    print "$tag recovery quiesced: $msg\n";
                                }
                            }

                            my $sub_params = { 'service-type' => 'osd', timeout => $timeout };
                            $sub_params->{force} = 1 if $force;
                            $sub_params->{'only-outdated'} = 1 if $only_outdated;

                            # If a prior orchestrator run died with this node mid-flight, its
                            # per-node checkpoint is still in the config-key store. Resume that
                            # node instead of tripping the per-node "state already exists"
                            # guard; the saved plan (and its noout/only-outdated decision) is
                            # honored, so force/only-outdated are not re-sent (both are ignored
                            # on resume anyway).
                            my $node_state =
                                PVE::Ceph::Services::load_bulk_restart_state($rados, $host);
                            my $resuming = $node_state && ($node_state->{next_index} // 0) > 0;
                            if ($resuming) {
                                $sub_params = {
                                    'service-type' => 'osd',
                                    timeout => $timeout,
                                    resume => 1,
                                };
                            }

                            my $sub_label =
                                $only_outdated ? "$count outdated OSDs" : "$count OSDs";
                            print "$tag "
                                . ($resuming ? "resuming" : "starting")
                                . " per-node OSD bulk-restart on $host ($sub_label)\n";
                            my $task_upid = $client->post(
                                "/nodes/$host/ceph/restart-bulk", $sub_params,
                            );
                            print "$tag sub-task UPID: $task_upid\n";

                            # Bound the wait generously: per OSD the sub-task can spend up to
                            # $timeout waiting for recovery to allow the restart (the between-OSD
                            # ok-to-stop gate) plus up to $timeout waiting for the OSD to come
                            # back up, plus the restart itself and the ok-to-stop retry
                            # overshoot. Budget that per OSD so the headroom scales with the
                            # count, plus a flat margin for the noout set/unset round-trips and
                            # task startup. The per-node task's own timeouts are the
                            # authoritative ones; this wall-clock only catches a hung or
                            # unreachable node.
                            my $node_timeout = ((2 * $timeout) + 120) * $count + 120;
                            wait_for_remote_task($client, $host, $task_upid, $node_timeout);
                            my $summary = remote_task_summary($client, $host, $task_upid);
                            print "$tag finished on $host"
                                . (defined($summary) ? ": $summary" : '') . "\n";
                        }
                        print "cluster-wide OSD rolling restart finished\n";
                    },
                );
                return;
            }

            my $services = PVE::Ceph::Services::get_services_info($type, $cfg, $rados);

            my $daemons = [];
            for my $name (sort keys %$services) {
                my $svc = $services->{$name};
                my $host = $svc->{host};
                if (!$host) {
                    print "skipping '$type.$name': no host known\n";
                    next;
                }
                if (!$known_nodes->{$host}) {
                    die "daemon '$type.$name' is registered on host '$host' which is not in"
                        . " the cluster node list - aborting before any restart to avoid a"
                        . " mid-loop transport failure (clean up stale ceph.conf entries first)\n";
                }
                push @$daemons, { host => $host, name => $name };
            }

            my $total = scalar(@$daemons);
            if (!$total) {
                print "no '$type' daemons found in cluster, nothing to do\n";
                return;
            }
            my $dry_prefix = $dry_run ? "[DRY-RUN] " : "";
            print "${dry_prefix}planned rolling restart order:\n";
            my $i = 0;
            for my $d (@$daemons) {
                $i++;
                print "  [$i/$total] $d->{host}: $type.$d->{name}\n";
            }
            if ($dry_run) {
                print "[DRY-RUN] no daemons were restarted\n";
                return;
            }

            # Two-level locking for MON/MGR/MDS: the cluster-wide soft lock keeps two
            # orchestrators on different cluster nodes from racing and (e.g.) restarting
            # two mons concurrently in the same paxos window. The local file lock is
            # nested inside it to serialize a second cluster-wide request on the same
            # node. Per-MON/MGR/MDS daemon restarts are handled inline (not via a
            # nested API call), so unlike the OSD branch there is no deadlock concern.
            PVE::Ceph::Services::with_cluster_bulk_restart_lock(
                $rados,
                "cluster-$type",
                $upid,
                sub {
                    PVE::Ceph::Services::with_bulk_restart_lock(sub {
                        my $local_node = PVE::INotify::nodename();
                        my $client; # lazy: only built when a remote daemon is encountered

                        $i = 0;
                        for my $d (@$daemons) {
                            $i++;
                            my ($host, $name) = ($d->{host}, $d->{name});
                            my $daemon = "$type.$name";
                            my $tag = "[$i/$total]";

                            # Re-check health every iteration so we abort if a blocking error
                            # shows up partway through (e.g. an unrelated OSD failure).
                            my $errors =
                                PVE::Ceph::Services::get_blocking_health_errors($rados, $type);
                            die "$tag Ceph reports a blocking HEALTH_ERR mid-restart,"
                                . " aborting:\n  - "
                                . join("\n  - ", @$errors) . "\n"
                                if @$errors;

                            my ($safe, $msg) =
                                PVE::Ceph::Services::is_safe_to_stop($rados, $type, $name);
                            die "$tag Ceph reports '$daemon' is not safe to stop: $msg\n"
                                if !$safe;

                            if ($host eq $local_node) {
                                print "$tag restarting $daemon on $host (local)\n";
                                PVE::Ceph::Services::ceph_service_cmd('restart', $daemon);
                            } else {
                                $client //= create_client();
                                print "$tag restarting $daemon on $host (remote)\n";
                                my $task_upid = $client->post(
                                    "/nodes/$host/ceph/restart",
                                    { service => $daemon },
                                );
                                print "$tag sub-task UPID: $task_upid\n";
                                wait_for_remote_task($client, $host, $task_upid, $timeout);
                            }

                            print
                                "$tag waiting up to ${timeout}s for $daemon to come back up\n";
                            PVE::Ceph::Services::wait_for_daemon_up(
                                $rados, $type, $name, $timeout,
                            );
                            print "$tag $daemon is up\n";
                        }

                        print
                            "rolling restart of '$type' daemons across the cluster finished\n";
                    });
                },
            );
        };

        return $rpcenv->fork_worker('srvrestart', "cluster-$type", $authuser, $worker);
    },
});

my $possible_flags = PVE::Ceph::Tools::get_possible_osd_flags();
my $possible_flags_list = [sort keys %$possible_flags];

my $get_current_set_flags = sub {
    my $rados = shift;

    $rados //= PVE::RADOS->new();

    my $stat = $rados->mon_command({ prefix => 'osd dump' });
    my $setflags = $stat->{flags} // '';
    return { map { $_ => 1 } PVE::Tools::split_list($setflags) };
};

__PACKAGE__->register_method({
    name => 'get_all_flags',
    path => 'flags',
    method => 'GET',
    description => "get the status of all ceph flags",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            additionalProperties => 1,
            properties => {
                name => {
                    description => "Flag name.",
                    type => 'string',
                    enum => $possible_flags_list,
                },
                description => {
                    description => "Flag description.",
                    type => 'string',
                },
                value => {
                    description => "Flag value.",
                    type => 'boolean',
                },
            },
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $setflags = $get_current_set_flags->();

        my $res = [];
        foreach my $flag (@$possible_flags_list) {
            my $el = {
                name => $flag,
                description => $possible_flags->{$flag}->{description},
                value => 0,
            };

            my $realflag = PVE::Ceph::Tools::get_real_flag_name($flag);
            if ($setflags->{$realflag}) {
                $el->{value} = 1;
            }

            push @$res, $el;
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'set_flags',
    path => 'flags',
    method => 'PUT',
    description => "Set/Unset multiple Ceph flags at once. Each flag is a top-level"
        . " optional boolean: passing true sets the flag, false unsets it,"
        . " omitting it leaves the current state untouched. Runs as a"
        . " worker task; returns a UPID to follow.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => $possible_flags,
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        PVE::Ceph::Tools::check_ceph_configured();

        my $worker = sub {
            my $rados = PVE::RADOS->new(); # (re-)open for forked worker

            my $setflags = $get_current_set_flags->($rados);

            my $errors = 0;
            foreach my $flag (@$possible_flags_list) {
                next if !defined($param->{$flag});
                my $val = $param->{$flag};
                my $realflag = PVE::Ceph::Tools::get_real_flag_name($flag);

                next if !$val == !$setflags->{$realflag}; # we do not set/unset flags to the same state

                my $prefix = $val ? 'set' : 'unset';
                eval {
                    print "$prefix $flag\n";
                    $rados->mon_command({ prefix => "osd $prefix", key => $flag });
                };
                if (my $err = $@) {
                    warn "error with $flag: '$err'\n";
                    $errors++;
                }
            }

            if ($errors) {
                die "could not set/unset $errors flags\n";
            }
        };

        return $rpcenv->fork_worker('cephsetflags', undef, $user, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'get_flag',
    path => 'flags/{flag}',
    method => 'GET',
    description => "Get the status of a specific ceph flag.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            flag => {
                description => "The name of the flag name to get.",
                type => 'string',
                enum => $possible_flags_list,
            },
        },
    },
    returns => {
        type => 'boolean',
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $realflag = PVE::Ceph::Tools::get_real_flag_name($param->{flag});

        my $setflags = $get_current_set_flags->();
        if ($setflags->{$realflag}) {
            return 1;
        }

        return 0;
    },
});

__PACKAGE__->register_method({
    name => 'update_flag',
    path => 'flags/{flag}',
    method => 'PUT',
    description => "Set or clear (unset) a specific Ceph flag. Runs synchronously"
        . " (unlike the bulk PUT /cluster/ceph/flags endpoint, which forks"
        . " a worker task).",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            flag => {
                description => 'The ceph flag to update',
                type => 'string',
                enum => $possible_flags_list,
            },
            value => {
                description => 'The new value of the flag',
                type => 'boolean',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $cmd = $param->{value} ? 'set' : 'unset';

        my $rados = PVE::RADOS->new();
        $rados->mon_command({
            prefix => "osd $cmd",
            key => $param->{flag},
        });

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'health_mute_index',
    path => 'health-mute',
    method => 'GET',
    description => "Get the currently muted Ceph health checks.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        items => {
            type => 'object',
            properties => {
                code => {
                    description => "The muted health check.",
                    type => 'string',
                },
                summary => {
                    description => "What the check reports.",
                    type => 'string',
                    optional => 1,
                },
                ttl => {
                    description => "When the mute expires. Absent if it does not.",
                    type => 'string',
                    optional => 1,
                },
                sticky => {
                    description => "Whether the mute survives the check getting worse.",
                    type => 'boolean',
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $rados = PVE::RADOS->new();
        # 'detail' would only add the per-check entity lists, which can be huge and are not
        # used here; the mutes come with any json formatted health reply
        my $health = $rados->mon_command({ prefix => 'health', format => 'json' });

        my $res = [];
        for my $mute ((ref($health->{mutes}) eq 'ARRAY' ? $health->{mutes} : [])->@*) {
            next if !defined($mute->{code});
            push @$res,
                {
                    code => $mute->{code},
                    sticky => $mute->{sticky} ? 1 : 0,
                    defined($mute->{summary}) ? (summary => $mute->{summary}) : (),
                    defined($mute->{ttl}) ? (ttl => $mute->{ttl}) : (),
                };
        }

        return $res;
    },
});

my $CEPH_TTL_UNITS = join(
    '|', qw(
        s sec seconds? m min minutes? h hr hours? d days? w wk weeks? mo months? y yr years?
    ),
);

__PACKAGE__->register_method({
    name => 'health_mute',
    path => 'health-mute/{code}',
    method => 'PUT',
    description => "Mute or unmute a Ceph health check. A muted check no longer counts towards"
        . " the cluster status, but stays visible and keeps being evaluated.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            code => {
                description => "The health check to mute, as reported by 'ceph health', for"
                    . " example 'AUTH_INSECURE_CLIENT_KEY_TYPE'.",
                type => 'string',
                pattern => '[A-Z][A-Z0-9_]+',
                maxLength => 64,
            },
            value => {
                description => "Whether to mute (true) or unmute (false) the check.",
                type => 'boolean',
            },
            ttl => {
                description => "How long the mute lasts, for example '2h', '3d' or '1w'."
                    . " Without it the mute has no expiry. Only used when muting.",
                type => 'string',
                # Ceph accepts a sequence of amount and unit pairs, so '1d12h' and '1d 12h'
                # are both valid. Spaces and tabs only, as '\s' would also let a newline
                # through; the web interface trims the value before it gets here.
                pattern => "\\d+[ \\t]*(?:${CEPH_TTL_UNITS})"
                    . "(?:[ \\t]*\\d+[ \\t]*(?:${CEPH_TTL_UNITS}))*(?!\\n)",
                optional => 1,
            },
            sticky => {
                description => "Keep the mute even when the check gets worse. Without this a"
                    . " mute clears itself as soon as the number of affected items grows,"
                    . " which brings the check back to attention. Only used when muting.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_configured();

        my $rados = PVE::RADOS->new();

        if (!$param->{value}) {
            $rados->mon_command({ prefix => 'health unmute', code => $param->{code} });
            return undef;
        }

        my $cmd = { prefix => 'health mute', code => $param->{code} };
        $cmd->{ttl} = $param->{ttl} if defined($param->{ttl});
        $cmd->{sticky} = JSON::true if $param->{sticky};

        # Ceph refuses a check that is not currently raised, and a duration that works out to
        # zero. Both are the caller's mistake rather than a server fault, so map the errno.
        # mon_command drops it, hence mon_cmd with the raw-result flag.
        my $res = $rados->mon_cmd($cmd, 1);
        my $rc = $res->{return_code} // 0;
        if ($rc == -2) {
            raise_param_exc({
                code => "cannot mute '$param->{code}', ceph does not currently report it",
            });
        } elsif ($rc == -22) {
            raise_param_exc({ ttl => "not a usable duration" });
        } elsif ($rc != 0) {
            die "could not mute '$param->{code}': " . ($res->{status} // "error $rc") . "\n";
        }

        return undef;
    },
});

1;
