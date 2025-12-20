package PVE::API2::Tasks;

use strict;
use warnings;
use POSIX;
use IO::File;
use File::ReadBackwards;
use PVE::Tools;
use PVE::SafeSyslog;
use PVE::RESTHandler;
use PVE::ProcFSTools;
use PVE::RPCEnvironment;
use PVE::JSONSchema qw(get_standard_option);
use PVE::Exception qw(raise_param_exc);
use PVE::AccessControl;

use base qw(PVE::RESTHandler);

my $convert_token_task = sub {
    my ($task) = @_;

    if (PVE::AccessControl::pve_verify_tokenid($task->{user}, 1)) {
        ($task->{user}, $task->{tokenid}) = PVE::AccessControl::split_tokenid($task->{user});
    }
};

my $check_task_user = sub {
    my ($task, $user) = @_;

    if ($task->{tokenid}) {
        my $fulltoken = PVE::AccessControl::join_tokenid($task->{user}, $task->{tokenid});
        # token only sees token tasks, user sees user + token tasks
        return $user eq $fulltoken || $user eq $task->{user};
    } else {
        return $user eq $task->{user};
    }
};

__PACKAGE__->register_method({
    name => 'node_tasks',
    path => '',
    method => 'GET',
    permissions => {
        description =>
            "List task associated with the current user, or all task the user has 'Sys.Audit' permissions on /nodes/<node> (the <node> the task runs on).",
        user => 'all',
    },
    description => "Read task list for one node (finished tasks).",
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            start => {
                type => 'integer',
                minimum => 0,
                default => 0,
                optional => 1,
                description => "List tasks beginning from this offset.",
            },
            limit => {
                type => 'integer',
                minimum => 0,
                default => 50,
                optional => 1,
                description => "Only list this number of tasks.",
            },
            userfilter => {
                type => 'string',
                optional => 1,
                description => "Only list tasks from this user.",
            },
            typefilter => {
                type => 'string',
                optional => 1,
                description => 'Only list tasks of this type (e.g., vzstart, vzdump).',
            },
            vmid => get_standard_option(
                'pve-vmid',
                {
                    description => "Only list tasks for this VM.",
                    optional => 1,
                },
            ),
            errors => {
                type => 'boolean',
                default => 0,
                optional => 1,
                description => 'Only list tasks with a status of ERROR.',
            },
            source => {
                type => 'string',
                enum => ['archive', 'active', 'all'],
                default => 'archive',
                optional => 1,
                description => 'List archived, active or all tasks.',
            },
            since => {
                type => 'integer',
                description => "Only list tasks since this UNIX epoch.",
                optional => 1,
            },
            until => {
                type => 'integer',
                description => "Only list tasks until this UNIX epoch.",
                optional => 1,
            },
            statusfilter => {
                type => 'string',
                format => 'pve-task-status-type-list',
                optional => 1,
                description => 'List of Task States that should be returned.',
            },
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                upid => { type => 'string', title => 'UPID' },
                node => { type => 'string', title => 'Node' },
                pid => { type => 'integer', title => 'PID' },
                pstart => { type => 'integer' },
                starttime =>
                    { type => 'integer', title => 'Starttime', renderer => 'timestamp' },
                type => { type => 'string', title => 'Type' },
                id => { type => 'string', title => 'ID' },
                user => { type => 'string', title => 'User' },
                endtime => {
                    type => 'integer',
                    optional => 1,
                    title => 'Endtime',
                    renderer => 'timestamp',
                },
                status => { type => 'string', optional => 1, title => 'Status' },
            },
        },
        links => [{ rel => 'child', href => "{upid}" }],
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $res = [];

        my $filename = "/var/log/pve/tasks/index";

        my $node = $param->{node};
        my $start = $param->{start} // 0;
        my $limit = $param->{limit} // 50;
        my $userfilter = $param->{userfilter};
        my $typefilter = $param->{typefilter};
        my $errors = $param->{errors} // 0;
        my $source = $param->{source} // 'archive';
        my $since = $param->{since};
        my $until = $param->{until};
        my $statusfilter = {
            ok => 1,
            warning => 1,
            error => 1,
            unknown => 1,
        };

        if (defined($param->{statusfilter}) && !$errors) {
            $statusfilter = {
                ok => 0,
                warning => 0,
                error => 0,
                unknown => 0,
            };
            for my $filter (PVE::Tools::split_list($param->{statusfilter})) {
                $statusfilter->{ lc($filter) } = 1;
            }
        } elsif ($errors) {
            $statusfilter->{ok} = 0;
        }

        my $count = 0;
        my $line;

        my $auditor = $rpcenv->check($user, "/nodes/$node", ['Sys.Audit'], 1);

        my $filter_task = sub {
            my $task = shift;

            return 1 if $userfilter && $task->{user} !~ m/\Q$userfilter\E/i;
            return 1 if !($auditor || $check_task_user->($task, $user));

            return 1 if $typefilter && $task->{type} ne $typefilter;

            return 1 if $param->{vmid} && (!$task->{id} || $task->{id} ne $param->{vmid});

            return 1 if defined($since) && $task->{starttime} < $since;
            return 1 if defined($until) && $task->{starttime} > $until;

            my $type = PVE::Tools::upid_normalize_status_type($task->{status});
            return 1 if !$statusfilter->{$type};

            return 1 if $count++ < $start;
            return 1 if $limit <= 0;

            return 0;
        };

        my $parse_line = sub {
            if ($line =~ m/^(\S+)(\s([0-9A-Za-z]{8})(\s(\S.*))?)?$/) {
                my $upid = $1;
                my $endtime = $3;
                my $status = $5;
                if ((my $task = PVE::Tools::upid_decode($upid, 1))) {

                    $task->{upid} = $upid;
                    $task->{endtime} = hex($endtime) if $endtime;
                    $task->{status} = $status if $status;

                    $convert_token_task->($task);
                    if (!$filter_task->($task)) {
                        push @$res, $task;
                        $limit--;
                    }
                }
            }
        };

        if ($source eq 'active' || $source eq 'all') {
            my $recent_tasks = PVE::INotify::read_file('active');
            for my $task (@$recent_tasks) {
                next if $task->{saved}; # archived task, already in index(.1)
                if (!$filter_task->($task)) {
                    $task->{status} = 'RUNNING' if !$task->{status}; # otherwise it would be archived
                    push @$res, $task;
                    $limit--;
                }
            }
        }

        if ($source ne 'active') {
            if (my $bw = File::ReadBackwards->new($filename)) {
                while (defined($line = $bw->readline)) {
                    &$parse_line();
                }
                $bw->close();
            }
            if (my $bw = File::ReadBackwards->new("$filename.1")) {
                while (defined($line = $bw->readline)) {
                    &$parse_line();
                }
                $bw->close();
            }
        }

        $rpcenv->set_result_attrib('total', $count);

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'upid_index',
    path => '{upid}',
    method => 'GET',
    description => '', # index helper
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            upid => { type => 'string' },
        },
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

        return [
            { name => 'log' }, { name => 'status' },
        ];
    },
});

__PACKAGE__->register_method({
    name => 'stop_task',
    path => '{upid}',
    method => 'DELETE',
    description => 'Stop a task.',
    permissions => {
        description =>
            "The user needs 'Sys.Modify' permissions on '/nodes/<node>' if they aren't the owner of the task.",
        user => 'all',
    },
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            upid => { type => 'string' },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my ($task, $filename) = PVE::Tools::upid_decode($param->{upid}, 1);
        raise_param_exc({ upid => "unable to parse worker upid" }) if !$task;
        raise_param_exc({ upid => "no such task" }) if !-f $filename;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        my $node = $param->{node};

        $convert_token_task->($task);

        if (!$check_task_user->($task, $user)) {
            $rpcenv->check($user, "/nodes/$node", ['Sys.Modify']);
        }

        PVE::RPCEnvironment->check_worker($param->{upid}, 1);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'read_task_log',
    path => '{upid}/log',
    method => 'GET',
    permissions => {
        description =>
            "The user needs 'Sys.Audit' permissions on '/nodes/<node>' if they aren't the owner of the task.",
        user => 'all',
    },
    protected => 1,
    download_allowed => 1,
    description => "Read task log.",
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            upid => {
                type => 'string',
                description => "The task's unique ID.",
            },
            start => {
                type => 'integer',
                minimum => 0,
                default => 0,
                optional => 1,
                description => "Start at this line when reading the tasklog",
            },
            limit => {
                type => 'integer',
                minimum => 0,
                default => 50,
                optional => 1,
                description => "The number of lines to read from the tasklog.",
            },
            download => {
                type => 'boolean',
                optional => 1,
                description =>
                    "Whether the tasklog file should be downloaded. This parameter can't be used in conjunction with other parameters",
            },
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                n => {
                    description => "Line number",
                    type => 'integer',
                },
                t => {
                    description => "Line text",
                    type => 'string',
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my ($task, $filename) = PVE::Tools::upid_decode($param->{upid}, 1);
        raise_param_exc({ upid => "unable to parse worker upid" }) if !$task;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        my $node = $param->{node};

        $convert_token_task->($task);

        if (!$check_task_user->($task, $user)) {
            $rpcenv->check($user, "/nodes/$node", ['Sys.Audit']);
        }

        if ($param->{download}) {
            if (defined($param->{start}) || defined($param->{limit})) {
                die "'download' cannot be used together with 'start' or 'limit' parameters\n";
            }
            # 1024 is a practical cutoff for the size distribution of our log files.
            my $use_compression = (-s $filename) > 1024;

            my $fh;
            if ($use_compression) {
                open($fh, "-|", "/usr/bin/gzip", "-c", "$filename")
                    or die "Could not create compressed file stream for file '$filename' - $!\n";
            } else {
                open($fh, '<', $filename) or die "Could not open file '$filename' - $!\n";
            }

            my $task_time = strftime('%FT%TZ', gmtime($task->{starttime}));
            my $download_name =
                'task-' . $task->{node} . '-' . $task->{type} . '-' . $task_time . '.log';

            return {
                download => {
                    fh => $fh,
                    stream => 1,
                    'content-encoding' => $use_compression ? 'gzip' : undef,
                    'content-type' => "text/plain",
                    'content-disposition' => "attachment; filename=\"" . $download_name . "\"",
                },
                },
                ;
        } else {
            my $start = $param->{start} // 0;
            my $limit = $param->{limit} // 50;

            my ($count, $lines) = PVE::Tools::dump_logfile($filename, $start, $limit);

            $rpcenv->set_result_attrib('total', $count);

            return $lines;
        }
    },
});

my $exit_status_cache = {};

__PACKAGE__->register_method({
    name => 'read_task_status',
    path => '{upid}/status',
    method => 'GET',
    permissions => {
        description =>
            "The user needs 'Sys.Audit' permissions on '/nodes/<node>' if they are not the owner of the task.",
        user => 'all',
    },
    protected => 1,
    description => "Read task status.",
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            upid => {
                type => 'string',
                description => "The task's unique ID.",
            },
        },
    },
    returns => {
        type => "object",
        properties => {
            pid => {
                type => 'integer',
            },
            status => {
                type => 'string',
                enum => ['running', 'stopped'],
            },
            type => {
                type => 'string',
            },
            id => {
                type => 'string',
            },
            user => {
                type => 'string',
            },
            exitstatus => {
                type => 'string',
                optional => 1,
            },
            upid => {
                type => 'string',
            },
            starttime => {
                type => 'integer',
            },
            pstart => {
                type => 'integer',
            },
            node => {
                type => 'string',
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my ($task, $filename) = PVE::Tools::upid_decode($param->{upid}, 1);
        raise_param_exc({ upid => "unable to parse worker upid" }) if !$task;
        raise_param_exc({ upid => "no such task" }) if !-f $filename;

        my $lines = [];

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();
        my $node = $param->{node};

        $convert_token_task->($task);

        if (!$check_task_user->($task, $user)) {
            $rpcenv->check($user, "/nodes/$node", ['Sys.Audit']);
        }

        my $pstart = PVE::ProcFSTools::read_proc_starttime($task->{pid});
        $task->{status} = ($pstart && ($pstart == $task->{pstart})) ? 'running' : 'stopped';

        $task->{upid} = $param->{upid}; # include upid

        if ($task->{status} eq 'stopped') {
            if (!defined($exit_status_cache->{ $task->{upid} })) {
                $exit_status_cache->{ $task->{upid} } =
                    PVE::Tools::upid_read_status($task->{upid});
            }
            $task->{exitstatus} = $exit_status_cache->{ $task->{upid} };
        }

        return $task;
    },
});

1;
