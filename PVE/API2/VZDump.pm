package PVE::API2::VZDump;

use strict;
use warnings;

use PVE::AccessControl;
use PVE::Cluster;
use PVE::Exception qw(raise_param_exc);
use PVE::INotify;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RPCEnvironment;
use PVE::Storage;
use PVE::Tools qw(extract_param);
use PVE::VZDump::Common;
use PVE::VZDump;

use PVE::API2::Backup;
use PVE::API2Tools;

use Data::Dumper; # fixme: remove

use base qw(PVE::RESTHandler);

my sub assert_param_permission_vzdump {
    my ($rpcenv, $user, $param) = @_;
    return if $user eq 'root@pam'; # always OK

    PVE::API2::Backup::assert_param_permission_common($rpcenv, $user, $param);

    if (defined($param->{'prune-backups'})) {
        if (my $storeid = PVE::VZDump::get_storage_param($param)) {
            $rpcenv->check($user, "/storage/$storeid", ['Datastore.Allocate']);
        }
    }
}

__PACKAGE__->register_method({
    name => 'vzdump',
    path => '',
    method => 'POST',
    description => "Create backup.",
    permissions => {
        description => "The user needs 'VM.Backup' permissions on any VM, and"
            . " 'Datastore.AllocateSpace' on the backup storage (and fleecing storage when fleecing"
            . " is used). The 'tmpdir', 'dumpdir', 'script' and 'job-id' parameters are restricted"
            . " to the 'root\@pam' user. The 'prune-backups' setting requires 'Datastore.Allocate'"
            . " on the backup storage. The 'bwlimit', 'performance' and 'ionice' parameters require"
            . " 'Sys.Modify' on '/'.",
        user => 'all',
    },
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => PVE::VZDump::Common::json_config_properties({
            'job-id' => get_standard_option(
                'pve-backup-jobid',
                {
                    description =>
                        "The ID of the backup job. If set, the 'backup-job' metadata field"
                        . " of the backup notification will be set to this value. Only root\@pam"
                        . " can set this parameter.",
                    optional => 1,
                },
            ),
            stdout => {
                type => 'boolean',
                description => "Write tar to stdout, not to a file.",
                optional => 1,
            },
        }),
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $user = $rpcenv->get_user();

        my $nodename = PVE::INotify::nodename();

        if ($rpcenv->{type} ne 'cli') {
            raise_param_exc({ node => "option is only allowed on the command line interface." })
                if $param->{node} && $param->{node} ne $nodename;

            raise_param_exc({
                stdout => "option is only allowed on the command line interface." })
                if $param->{stdout};
        }

        assert_param_permission_vzdump($rpcenv, $user, $param);

        PVE::VZDump::verify_vzdump_parameters($param, 1);

        # silent exit if we run on wrong node
        return 'OK' if $param->{node} && $param->{node} ne $nodename;

        my $cmdline = PVE::VZDump::Common::command_line($param);

        my $vmids_per_node = PVE::VZDump::get_included_guests($param);

        my $local_vmids = delete $vmids_per_node->{$nodename} // [];

        # include IDs for deleted guests, and visibly fail later
        my $orphaned_vmids = delete $vmids_per_node->{''} // [];
        push @{$local_vmids}, @{$orphaned_vmids};

        my $skiplist = [map { @$_ } values $vmids_per_node->%*];

        if ($param->{stop}) {
            PVE::VZDump::stop_running_backups();
            return 'OK' if !scalar(@{$local_vmids});
        }

        # silent exit if specified VMs run on other nodes
        return "OK" if !scalar(@{$local_vmids}) && !$param->{all};

        PVE::VZDump::parse_mailto_exclude_path($param);

        die "you can only backup a single VM with option --stdout\n"
            if $param->{stdout} && scalar(@{$local_vmids}) != 1;

        if (my $storeid = PVE::VZDump::get_storage_param($param)) {
            $rpcenv->check($user, "/storage/$storeid", ['Datastore.AllocateSpace']);
        }

        my $worker = sub {
            my $upid = shift;

            $SIG{INT} = $SIG{TERM} = $SIG{QUIT} = $SIG{HUP} = $SIG{PIPE} = sub {
                die "interrupted by signal\n";
            };

            $param->{vmids} = $local_vmids;
            my $vzdump = PVE::VZDump->new($cmdline, $param, $skiplist);

            my $LOCK_FH = eval {
                $vzdump->getlock($upid); # only one process allowed
            };
            if (my $err = $@) {
                $vzdump->send_notification([], 0, $err);
                exit(-1);
            }

            if (defined($param->{ionice})) {
                if ($param->{ionice} > 7) {
                    PVE::VZDump::run_command(undef, "ionice -c3 -p $$");
                } else {
                    PVE::VZDump::run_command(undef, "ionice -c2 -n$param->{ionice} -p $$");
                }
            }
            $vzdump->exec_backup($rpcenv, $user);

            close($LOCK_FH);
        };

        open STDOUT, '>/dev/null' if $param->{quiet} && !$param->{stdout};
        open STDERR, '>/dev/null' if $param->{quiet};

        if ($rpcenv->{type} eq 'cli') {
            if ($param->{stdout}) {

                open my $saved_stdout, ">&STDOUT"
                    || die "can't dup STDOUT: $!\n";

                open STDOUT, '>&STDERR'
                    || die "unable to redirect STDOUT: $!\n";

                $param->{stdout} = $saved_stdout;
            }
        }

        my $taskid;
        $taskid = $local_vmids->[0] if scalar(@{$local_vmids}) == 1;

        return $rpcenv->fork_worker('vzdump', $taskid, $user, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'defaults',
    path => 'defaults',
    method => 'GET',
    description => "Get the currently configured vzdump defaults.",
    permissions => {
        description => "The user needs 'Datastore.Audit' or 'Datastore.AllocateSpace' "
            . "permissions for the specified storage (or default storage if none specified). Some "
            . "properties are only returned when the user has 'Sys.Audit' permissions for the node.",
        user => 'all',
    },
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            storage => get_standard_option('pve-storage-id', { optional => 1 }),
        },
    },
    returns => {
        type => 'object',
        additionalProperties => 0,
        properties => PVE::VZDump::Common::json_config_properties(),
    },
    code => sub {
        my ($param) = @_;

        my $node = extract_param($param, 'node');
        my $storage = extract_param($param, 'storage');

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $res = PVE::VZDump::read_vzdump_defaults();

        $res->{storage} = $storage if defined($storage);

        if (!defined($res->{dumpdir}) && !defined($res->{storage})) {
            $res->{storage} = 'local';
        }

        if (defined($res->{storage})) {
            $rpcenv->check_any(
                $authuser,
                "/storage/$res->{storage}",
                ['Datastore.Audit', 'Datastore.AllocateSpace'],
            );

            my $info = PVE::VZDump::storage_info($res->{storage});
            for my $key (qw(dumpdir prune-backups)) {
                $res->{$key} = $info->{$key} if defined($info->{$key});
            }
        }

        if (defined($res->{'prune-backups'})) {
            $res->{'prune-backups'} = PVE::JSONSchema::print_property_string(
                $res->{'prune-backups'}, 'prune-backups',
            );
        }

        $res->{mailto} = join(",", @{ $res->{mailto} })
            if defined($res->{mailto});

        $res->{'exclude-path'} = join(",", @{ $res->{'exclude-path'} })
            if defined($res->{'exclude-path'});

        # normal backup users don't need to know these
        if (!$rpcenv->check($authuser, "/nodes/$node", ['Sys.Audit'], 1)) {
            delete $res->{mailto};
            delete $res->{tmpdir};
            delete $res->{dumpdir};
            delete $res->{script};
            delete $res->{ionice};
        }

        my $pool = $res->{pool};
        if (
            defined($pool)
            && !$rpcenv->check($authuser, "/pool/$pool", ['Pool.Audit'], 1)
        ) {
            delete $res->{pool};
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'extractconfig',
    path => 'extractconfig',
    method => 'GET',
    description => "Extract configuration from vzdump backup archive.",
    permissions => {
        description =>
            "The user needs 'VM.Backup' permissions on the backed up guest ID, and 'Datastore.AllocateSpace' on the backup storage.",
        user => 'all',
    },
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            volume => {
                description => "Volume identifier",
                type => 'string',
                completion => \&PVE::Storage::complete_volume,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        my $volume = extract_param($param, 'volume');

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $storage_cfg = PVE::Storage::config();
        PVE::Storage::check_volume_access(
            $rpcenv, $authuser, $storage_cfg, undef, $volume, 'backup',
        );

        if (PVE::Storage::parse_volume_id($volume, 1)) {
            my (undef, undef, $ownervm) = PVE::Storage::parse_volname($storage_cfg, $volume);
            $rpcenv->check($authuser, "/vms/$ownervm", ['VM.Backup']);
        }

        return PVE::Storage::extract_vzdump_config($storage_cfg, $volume);
    },
});

1;
