package PVE::CLI::pvesr;

use strict;
use warnings;
use POSIX qw(strftime);
use JSON;

use PVE::JSONSchema qw(get_standard_option);
use PVE::INotify;
use PVE::RPCEnvironment;
use PVE::Tools qw(extract_param);
use PVE::SafeSyslog;
use PVE::CLIHandler;

use PVE::Cluster;
use PVE::Replication;
use PVE::API2::ReplicationConfig;
use PVE::API2::Replication;

use base qw(PVE::CLIHandler);

my $nodename = PVE::INotify::nodename();

sub setup_environment {
    PVE::RPCEnvironment->setup_default_cli_env();
}

# fixme: get from plugin??
my $replicatable_storage_types = {
    zfspool => 1,
};

my $check_wanted_volid = sub {
    my ($storecfg, $vmid, $volid, $local_node) = @_;

    my ($storeid, $volname) = PVE::Storage::parse_volume_id($volid);
    my $scfg = PVE::Storage::storage_check_enabled($storecfg, $storeid, $local_node);
    die "storage '$storeid' is not replicatable\n"
        if !$replicatable_storage_types->{ $scfg->{type} };

    my ($vtype, undef, $ownervm) = PVE::Storage::parse_volname($storecfg, $volid);
    die "volume '$volid' has wrong vtype ($vtype != 'images')\n"
        if $vtype ne 'images';
    die "volume '$volid' has wrong owner\n"
        if !$ownervm || $vmid != $ownervm;

    return $storeid;
};

__PACKAGE__->register_method({
    name => 'prepare_local_job',
    path => 'prepare_local_job',
    method => 'POST',
    description =>
        "Prepare for starting a replication job. This is called on the target node before replication starts. This call is for internal use, and return a JSON object on stdout. The method first test if VM <vmid> reside on the local node. If so, stop immediately. After that the method scans all volume IDs for snapshots, and removes all replications snapshots with timestamps different than <last_sync>. It also removes any unused volumes. Returns a hash with boolean markers for all volumes with existing replication snapshots.",
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-replication-id'),
            'extra-args' => get_standard_option(
                'extra-args',
                { description => "The list of volume IDs to consider." },
            ),
            scan => {
                description => "List of storage IDs to scan for stale volumes.",
                type => 'string',
                format => 'pve-storage-id-list',
                optional => 1,
            },
            force => {
                description => "Allow to remove all existion volumes (empty volume list).",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            last_sync => {
                description =>
                    "Time (UNIX epoch) of last successful sync. If not specified, all replication snapshots get removed.",
                type => 'integer',
                minimum => 0,
                optional => 1,
            },
            parent_snapname => get_standard_option('pve-snapshot-name', {
                    optional => 1,
            }),
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $logfunc = sub {
            my ($msg) = @_;
            print STDERR "$msg\n";
        };

        my $local_node = PVE::INotify::nodename();

        die "no volumes specified\n"
            if !$param->{force} && !scalar(@{ $param->{'extra-args'} });

        my ($vmid, undef, $jobid) =
            PVE::ReplicationConfig::parse_replication_job_id($param->{id});

        my $vms = PVE::Cluster::get_vmlist();
        die "guest '$vmid' is on local node\n"
            if $vms->{ids}->{$vmid} && $vms->{ids}->{$vmid}->{node} eq $local_node;

        my $last_sync = $param->{last_sync} // 0;
        my $parent_snapname = $param->{parent_snapname};

        my $storecfg = PVE::Storage::config();

        # compute list of storages we want to scan
        my $storage_hash = {};
        foreach my $storeid (PVE::Tools::split_list($param->{scan})) {
            my $scfg = PVE::Storage::storage_check_enabled($storecfg, $storeid, $local_node, 1);
            next if !$scfg; # simply ignore unavailable storages here
            die "storage '$storeid' is not replicatable\n"
                if !$replicatable_storage_types->{ $scfg->{type} };
            $storage_hash->{$storeid} = 1;
        }

        my $wanted_volids = {};
        foreach my $volid (@{ $param->{'extra-args'} }) {
            my $storeid = $check_wanted_volid->($storecfg, $vmid, $volid, $local_node);
            $wanted_volids->{$volid} = 1;
            $storage_hash->{$storeid} = 1;
        }
        my $storage_list = [sort keys %$storage_hash];

        # activate all used storage
        my $cache = {};
        PVE::Storage::activate_storage_list($storecfg, $storage_list, $cache);

        my $snapname = PVE::ReplicationState::replication_snapshot_name($jobid, $last_sync);

        # find replication snapshots
        my $volids = [];
        foreach my $storeid (@$storage_list) {
            my $scfg = PVE::Storage::storage_config($storecfg, $storeid);
            my $plugin = PVE::Storage::Plugin->lookup($scfg->{type});
            my $images = $plugin->list_images($storeid, $scfg, $vmid, undef, $cache);
            push @$volids, map { $_->{volid} } @$images;
        }
        my ($local_snapshots, $cleaned_replicated_volumes) = PVE::Replication::prepare(
            $storecfg, $volids, $jobid, $last_sync, $parent_snapname, $logfunc,
        );
        for my $volid ($volids->@*) {
            next if $wanted_volids->{$volid};

            my $stale = $cleaned_replicated_volumes->{$volid};
            # prepare() will not remove the last_sync snapshot, but if the volume was used by the
            # job and is not wanted anymore, it is stale too. And not removing it now might cause
            # it to be missed later, because the relevant storage might not get scanned anymore.
            $stale ||= grep {
                PVE::Replication::is_replication_snapshot($_, $jobid)
            } keys %{ $local_snapshots->{$volid} // {} };

            if ($stale) {
                $logfunc->("$jobid: delete stale volume '$volid'");
                PVE::Storage::vdisk_free($storecfg, $volid);
                delete $local_snapshots->{$volid};
            }
        }

        print to_json($local_snapshots) . "\n";

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'finalize_local_job',
    path => 'finalize_local_job',
    method => 'POST',
    description =>
        "Finalize a replication job. This removes all replications snapshots with timestamps different than <last_sync>.",
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-replication-id'),
            'extra-args' => get_standard_option(
                'extra-args',
                { description => "The list of volume IDs to consider." },
            ),
            last_sync => {
                description =>
                    "Time (UNIX epoch) of last successful sync. If not specified, all replication snapshots gets removed.",
                type => 'integer',
                minimum => 0,
                optional => 1,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my ($vmid, undef, $jobid) =
            PVE::ReplicationConfig::parse_replication_job_id($param->{id});
        my $last_sync = $param->{last_sync} // 0;

        my $local_node = PVE::INotify::nodename();

        my $vms = PVE::Cluster::get_vmlist();
        die "guest '$vmid' is on local node\n"
            if $vms->{ids}->{$vmid} && $vms->{ids}->{$vmid}->{node} eq $local_node;

        my $storecfg = PVE::Storage::config();

        my $volids = [];

        die "no volumes specified\n" if !scalar(@{ $param->{'extra-args'} });

        foreach my $volid (@{ $param->{'extra-args'} }) {
            $check_wanted_volid->($storecfg, $vmid, $volid, $local_node);
            push @$volids, $volid;
        }

        $volids = [sort @$volids];

        my $logfunc = sub {
            my ($msg) = @_;
            print STDERR "$msg\n";
        };

        PVE::Replication::prepare($storecfg, $volids, $jobid, $last_sync, undef, $logfunc);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'run',
    path => 'run',
    method => 'POST',
    description =>
        "This method is called by the systemd-timer and executes all (or a specific) sync jobs.",
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-replication-id', { optional => 1 }),
            verbose => {
                description => "Print more verbose logs to stdout.",
                type => 'boolean',
                default => 0,
                optional => 1,
            },
            mail => {
                description => "Send an email notification in case of a failure.",
                type => 'boolean',
                default => 0,
                optional => 1,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        die "Mail and id are mutually exclusive!\n"
            if $param->{id} && $param->{mail};

        my $logfunc;

        if ($param->{verbose}) {
            $logfunc = sub {
                my ($msg) = @_;
                print "$msg\n";
            };
        }

        if (my $id = extract_param($param, 'id')) {

            PVE::API2::Replication::run_single_job($id, undef, $logfunc);

        } else {

            PVE::API2::Replication::run_jobs(undef, $logfunc, 0, $param->{mail});
        }

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'enable',
    path => 'enable',
    method => 'POST',
    description => "Enable a replication job.",
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-replication-id'),
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        $param->{disable} = 0;

        return PVE::API2::ReplicationConfig->update($param);
    },
});

__PACKAGE__->register_method({
    name => 'disable',
    path => 'disable',
    method => 'POST',
    description => "Disable a replication job.",
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-replication-id'),
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        $param->{disable} = 1;

        return PVE::API2::ReplicationConfig->update($param);
    },
});

__PACKAGE__->register_method({
    name => 'set_state',
    path => '',
    protected => 1,
    method => 'POST',
    description =>
        "Set the job replication state on migration. This call is for internal use. It will accept the job state as ja JSON obj.",
    permissions => {
        check => ['perm', '/storage', ['Datastore.Allocate']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            vmid =>
                get_standard_option('pve-vmid', { completion => \&PVE::Cluster::complete_vmid }),
            state => {
                description => "Job state as JSON decoded string.",
                type => 'string',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $vmid = extract_param($param, 'vmid');
        my $json_string = extract_param($param, 'state');
        my $remote_job_state = decode_json $json_string;

        PVE::ReplicationState::write_vmid_job_states($remote_job_state, $vmid);
        return undef;
    },
});

my $print_job_list = sub {
    my ($list) = @_;

    my $format = "%-20s %-20s %10s %5s %8s\n";

    printf($format, "JobID", "Target", "Schedule", "Rate", "Enabled");

    foreach my $job (sort { $a->{guest} <=> $b->{guest} } @$list) {
        my $plugin = PVE::ReplicationConfig->lookup($job->{type});
        my $tid = $plugin->get_unique_target_id($job);

        printf(
            $format,
            $job->{id},
            $tid,
            defined($job->{schedule}) ? $job->{schedule} : '*/15',
            defined($job->{rate}) ? $job->{rate} : '-',
            $job->{disable} ? 'no' : 'yes',
        );
    }
};

my $print_job_status = sub {
    my ($list) = @_;

    my $format = "%-10s %-10s %-20s %20s %20s %10s %10s %s\n";

    printf($format,
        "JobID",
        "Enabled",
        "Target",
        "LastSync",
        "NextSync",
        "Duration",
        "FailCount",
        "State");

    foreach my $job (sort { $a->{guest} <=> $b->{guest} } @$list) {
        my $plugin = PVE::ReplicationConfig->lookup($job->{type});
        my $tid = $plugin->get_unique_target_id($job);

        my $timestr = '-';
        if ($job->{last_sync}) {
            $timestr = strftime("%Y-%m-%d_%H:%M:%S", localtime($job->{last_sync}));
        }

        my $nextstr = '-';
        if (my $next = $job->{next_sync}) {
            my $now = time();
            if ($next > $now) {
                $nextstr = strftime("%Y-%m-%d_%H:%M:%S", localtime($job->{next_sync}));
            } else {
                $nextstr = 'pending';
            }
        }

        my $state = $job->{pid} ? "SYNCING" : $job->{error} // 'OK';
        my $enabled = $job->{disable} ? 'No' : 'Yes';

        printf($format,
            $job->{id},
            $enabled,
            $tid,
            $timestr,
            $nextstr,
            $job->{duration} // '-',
            $job->{fail_count},
            $state);
    }
};

our $cmddef = {
    status =>
        ['PVE::API2::Replication', 'status', [], { node => $nodename }, $print_job_status],
    'schedule-now' => ['PVE::API2::Replication', 'schedule_now', ['id'], { node => $nodename }],

    list => ['PVE::API2::ReplicationConfig', 'index', [], {}, $print_job_list],
    read => [
        'PVE::API2::ReplicationConfig',
        'read',
        ['id'],
        {},
        sub {
            my $res = shift;
            print to_json($res, { utf8 => 1, pretty => 1, canonical => 1 });
        },
    ],
    update => ['PVE::API2::ReplicationConfig', 'update', ['id'], {}],
    delete => ['PVE::API2::ReplicationConfig', 'delete', ['id'], {}],
    'create-local-job' =>
        ['PVE::API2::ReplicationConfig', 'create', ['id', 'target'], { type => 'local' }],

    enable => [__PACKAGE__, 'enable', ['id'], {}],
    disable => [__PACKAGE__, 'disable', ['id'], {}],

    'prepare-local-job' => [__PACKAGE__, 'prepare_local_job', ['id', 'extra-args'], {}],
    'finalize-local-job' => [__PACKAGE__, 'finalize_local_job', ['id', 'extra-args'], {}],

    run => [__PACKAGE__, 'run'],
    'set-state' => [__PACKAGE__, 'set_state', ['vmid', 'state']],
};

1;
