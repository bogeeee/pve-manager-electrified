package PVE::VZDump;

use strict;
use warnings;

use Clone;
use Fcntl ':flock';
use File::Basename;
use File::Path;
use IO::File;
use IO::Select;
use IPC::Open3;
use POSIX qw(strftime);
use Time::Local;

use PVE::Cluster qw(cfs_read_file);
use PVE::DataCenterConfig;
use PVE::Exception qw(raise_param_exc);
use PVE::HA::Config;
use PVE::HA::Env::PVE2;
use PVE::JSONSchema qw(get_standard_option);
use PVE::Notify;
use PVE::RPCEnvironment;
use PVE::Storage;
use PVE::VZDump::Common;
use PVE::VZDump::Plugin;
use PVE::Tools qw(extract_param split_list);
use PVE::API2Tools;

# section config header/ID, this needs to cover UUIDs, user given values
# and `$digest:$counter` values converted from vzdump.cron
# TODO move to a better place once cycle
# Jobs::VZDump -> API2::VZDump -> API2::Backups -> Jobs::VZDump is broken..
PVE::JSONSchema::register_standard_option(
    'pve-backup-jobid',
    {
        type => 'string',
        description => "The job ID.",
        maxLength => 50,
        pattern => '\S+',
    },
);

my @posix_filesystems = qw(ext3 ext4 nfs nfs4 reiserfs xfs);

my $lockfile = '/var/run/vzdump.lock';
my $pidfile = '/var/run/vzdump.pid';
my $logdir = '/var/log/vzdump';

my @plugins = qw();

my $confdesc = PVE::VZDump::Common::get_confdesc();

my $confdesc_for_defaults = Clone::clone($confdesc);
delete $confdesc_for_defaults->{$_}->{requires} for qw(notes-template protected);

# Load available plugins
my @pve_vzdump_classes = qw(PVE::VZDump::QemuServer PVE::VZDump::LXC);
foreach my $plug (@pve_vzdump_classes) {
    my $filename = "/usr/share/perl5/$plug.pm";
    $filename =~ s!::!/!g;
    if (-f $filename) {
        eval { require $filename; };
        if (!$@) {
            $plug->import();
            push @plugins, $plug;
        } else {
            die $@;
        }
    }
}

sub get_storage_param {
    my ($param) = @_;

    return if $param->{dumpdir};
    return $param->{storage} || 'local';
}

# helper functions

sub debugmsg {
    my ($mtype, $msg, $logfd, $syslog) = @_;

    PVE::VZDump::Plugin::debugmsg(@_);
}

sub run_command {
    my ($logfd, $cmdstr, %param) = @_;

    my $logfunc = sub {
        my $line = shift;
        debugmsg('info', $line, $logfd);
    };

    PVE::Tools::run_command($cmdstr, %param, logfunc => $logfunc);
}

my $verify_notes_template = sub {
    my ($template) = @_;

    die "contains a line feed\n" if $template =~ /\n/;

    my @problematic = ();
    while ($template =~ /\\(.)/g) {
        my $char = $1;
        push @problematic, "escape sequence '\\$char' at char " . (pos($template) - 2)
            if $char !~ /^[n\\]$/;
    }

    while ($template =~ /\{\{([^\s{}]+)\}\}/g) {
        my $var = $1;
        push @problematic, "variable '$var' at char " . (pos($template) - length($var))
            if $var !~ /^(cluster|guestname|node|vmid)$/;
    }

    die "found unknown: " . join(', ', @problematic) . "\n" if scalar(@problematic);
};

my $generate_notes = sub {
    my ($notes_template, $task) = @_;

    $verify_notes_template->($notes_template);

    my $info = {
        cluster => PVE::Cluster::get_clinfo()->{cluster}->{name} // 'standalone node',
        guestname => $task->{hostname} // "VM $task->{vmid}", # is always set for CTs
        node => PVE::INotify::nodename(),
        vmid => $task->{vmid},
    };

    my $unescape = sub {
        my ($char) = @_;
        return '\\' if $char eq '\\';
        return "\n" if $char eq 'n';
        die "unexpected escape character '$char'\n";
    };

    $notes_template =~ s/\\(.)/$unescape->($1)/eg;

    my $vars = join('|', keys $info->%*);
    $notes_template =~ s/\{\{($vars)\}\}/$info->{$1}/g;

    return $notes_template;
};

sub parse_fleecing {
    my ($param) = @_;

    if (defined(my $fleecing = $param->{fleecing})) {
        return $fleecing if ref($fleecing) eq 'HASH'; # already parsed
        $param->{fleecing} = PVE::JSONSchema::parse_property_string('backup-fleecing', $fleecing);
    }

    return $param->{fleecing};
}

my sub parse_performance {
    my ($param) = @_;

    if (defined(my $perf = $param->{performance})) {
        return $perf if ref($perf) eq 'HASH'; # already parsed
        $param->{performance} = PVE::JSONSchema::parse_property_string('backup-performance', $perf);
    }

    return $param->{performance};
}

my sub merge_performance {
    my ($prefer, $fallback) = @_;

    my $res = {};
    for my $opt (keys PVE::JSONSchema::get_format('backup-performance')->%*) {
        $res->{$opt} = $prefer->{$opt} // $fallback->{$opt}
            if defined($prefer->{$opt}) || defined($fallback->{$opt});
    }
    return $res;
}

my $parse_prune_backups = sub {
    my ($param, $kind) = @_;

    my $prune_backups = $param->{'prune-backups'};

    if (defined($prune_backups)) {
        return $prune_backups if ref($prune_backups) eq 'HASH'; # already parsed
        $param->{'prune-backups'} = PVE::JSONSchema::parse_property_string(
            'prune-backups', $prune_backups,
        );
    }

    return $param->{'prune-backups'};
};

sub storage_info {
    my $storage = shift;

    my $cfg = PVE::Storage::config();
    my $scfg = PVE::Storage::storage_config($cfg, $storage);
    my $type = $scfg->{type};

    die "can't use storage '$storage' for backups - wrong content type\n"
        if (!$scfg->{content}->{backup});

    my $info = {
        scfg => $scfg,
    };

    $info->{'prune-backups'} =
        PVE::JSONSchema::parse_property_string('prune-backups', $scfg->{'prune-backups'})
        if defined($scfg->{'prune-backups'});

    if (PVE::Storage::storage_has_feature($cfg, $storage, 'backup-provider')) {
        $info->{'backup-provider'} =
            PVE::Storage::new_backup_provider($cfg, $storage, sub { debugmsg($_[0], $_[1]); });
    } elsif ($type eq 'pbs') {
        $info->{pbs} = 1;
    } else {
        $info->{dumpdir} = PVE::Storage::get_backup_dir($cfg, $storage);
    }

    return $info;
}

sub format_size {
    my $size = shift;

    my $kb = $size / 1024;

    if ($kb < 1024) {
        return int($kb) . "KB";
    }

    my $mb = $size / (1024 * 1024);
    if ($mb < 1024) {
        return int($mb) . "MB";
    }
    my $gb = $mb / 1024;
    if ($gb < 1024) {
        return sprintf("%.2fGB", $gb);
    }
    my $tb = $gb / 1024;
    return sprintf("%.2fTB", $tb);
}

sub format_time {
    my $seconds = shift;

    my $hours = int($seconds / 3600);
    $seconds = $seconds - $hours * 3600;
    my $min = int($seconds / 60);
    $seconds = $seconds - $min * 60;

    return sprintf("%02d:%02d:%02d", $hours, $min, $seconds);
}

sub encode8bit {
    my ($str) = @_;

    $str =~ s/^(.{990})/$1\n/mg; # reduce line length

    return $str;
}

sub escape_html {
    my ($str) = @_;

    $str =~ s/&/&amp;/g;
    $str =~ s/</&lt;/g;
    $str =~ s/>/&gt;/g;

    return $str;
}

sub check_bin {
    my ($bin) = @_;

    foreach my $p (split(/:/, $ENV{PATH})) {
        my $fn = "$p/$bin";
        if (-x $fn) {
            return $fn;
        }
    }

    die "unable to find command '$bin'\n";
}

sub check_vmids {
    my (@vmids) = @_;

    my $res = [];
    for my $vmid (sort { $a <=> $b } @vmids) {
        die "ERROR: strange VM ID '${vmid}'\n" if $vmid !~ m/^\d+$/;
        $vmid = int($vmid); # remove leading zeros
        next if !$vmid;
        push @$res, $vmid;
    }

    return $res;
}

sub read_vzdump_defaults {

    my $fn = "/etc/vzdump.conf";

    my $defaults = {
        map {
            my $default = $confdesc->{$_}->{default};
            defined($default) ? ($_ => $default) : ()
        } keys %$confdesc_for_defaults
    };
    my $performance_fmt = PVE::JSONSchema::get_format('backup-performance');
    $defaults->{performance} = {
        map {
            my $default = $performance_fmt->{$_}->{default};
            defined($default) ? ($_ => $default) : ()
        } keys $performance_fmt->%*
    };
    my $fleecing_fmt = PVE::JSONSchema::get_format('backup-fleecing');
    $defaults->{fleecing} = {
        map {
            my $default = $fleecing_fmt->{$_}->{default};
            defined($default) ? ($_ => $default) : ()
        } keys $fleecing_fmt->%*
    };
    $parse_prune_backups->($defaults, "defaults in VZDump schema");

    my $raw;
    eval { $raw = PVE::Tools::file_get_contents($fn); };
    return $defaults if $@;

    my $conf_schema = { type => 'object', properties => $confdesc_for_defaults };
    my $res = PVE::JSONSchema::parse_config($conf_schema, $fn, $raw);
    if (my $excludes = $res->{'exclude-path'}) {
        if (ref($excludes) eq 'ARRAY') {
            my $list = [];
            for my $path ($excludes->@*) {
                # We still use `split_args` here to be compatible with old configs where one line
                # still has multiple space separated entries.
                push $list->@*, PVE::Tools::split_args($path)->@*;
            }
            $res->{'exclude-path'} = $list;
        } else {
            $res->{'exclude-path'} = PVE::Tools::split_args($excludes);
        }
    }
    if (defined($res->{mailto})) {
        my @mailto = split_list($res->{mailto});
        $res->{mailto} = [@mailto];
    }
    $parse_prune_backups->($res, "options in '$fn'");
    parse_fleecing($res);
    parse_performance($res);

    for my $key (keys $defaults->%*) {
        if (!defined($res->{$key})) {
            $res->{$key} = $defaults->{$key};
        } elsif ($key eq 'performance') {
            $res->{$key} = merge_performance($res->{$key}, $defaults->{$key});
        }
    }

    if (defined($res->{storage}) && defined($res->{dumpdir})) {
        debugmsg('warn', "both 'storage' and 'dumpdir' defined in '$fn' - ignoring 'dumpdir'");
        delete $res->{dumpdir};
    }

    return $res;
}

my sub read_backup_task_logs {
    my ($task_list) = @_;

    my $task_logs = "";

    for my $task (@$task_list) {
        my $vmid = $task->{vmid};
        my $log_file = $task->{tmplog};
        if (!$task->{tmplog}) {
            $task_logs .= "$vmid: no log available\n\n";
            next;
        }
        if (open(my $TMP, '<', "$log_file")) {
            while (my $line = <$TMP>) {
                next if $line =~ /^status: \d+/; # not useful in mails
                $task_logs .= encode8bit("$vmid: $line");
            }
            close($TMP);
        } else {
            $task_logs .= "$vmid: Could not open log file\n\n";
        }
        $task_logs .= "\n";
    }

    return $task_logs;
}

my sub build_guest_table {
    my ($task_list) = @_;

    my $table = {
        schema => {
            columns => [
                {
                    label => "VMID",
                    id => "vmid",
                },
                {
                    label => "Name",
                    id => "name",
                },
                {
                    label => "Status",
                    id => "status",
                },
                {
                    label => "Time",
                    id => "time",
                    renderer => "duration",
                },
                {
                    label => "Size",
                    id => "size",
                    renderer => "human-bytes",
                },
                {
                    label => "Filename",
                    id => "filename",
                },
            ],
        },
        data => [],
    };

    for my $task (@$task_list) {
        my $successful = $task->{state} eq 'ok';
        my $size = $successful ? $task->{size} : 0;
        my $filename = $successful ? $task->{target} : undef;
        push @{ $table->{data} },
            {
                "vmid" => int($task->{vmid}),
                "name" => $task->{hostname},
                "status" => $task->{state},
                "time" => int($task->{backuptime}),
                "size" => int($size),
                "filename" => $filename,
            };
    }

    return $table;
}

my sub sanitize_task_list {
    my ($task_list) = @_;
    for my $task (@$task_list) {
        chomp $task->{msg} if $task->{msg};
        $task->{backuptime} = 0 if !$task->{backuptime};
        $task->{size} = 0 if !$task->{size};
        $task->{target} = 'unknown' if !$task->{target};
        $task->{hostname} = "VM $task->{vmid}" if !$task->{hostname};

        if ($task->{state} eq 'todo') {
            $task->{msg} = 'aborted';
        }
    }
}

my sub aggregate_task_statistics {
    my ($tasklist) = @_;

    my $error_count = 0;
    my $total_size = 0;
    for my $task (@$tasklist) {
        $error_count++ if $task->{state} ne 'ok';
        $total_size += $task->{size} if $task->{state} eq 'ok';
    }

    return ($error_count, $total_size);
}

my sub get_hostname {
    my $hostname = `hostname -f` || PVE::INotify::nodename();
    chomp $hostname;
    return $hostname;
}

use constant MAX_LOG_SIZE => 1024 * 1024;

sub send_notification {
    my ($self, $tasklist, $total_time, $err, $detail_pre, $detail_post) = @_;

    my $opts = $self->{opts};
    my $job_id = $opts->{'job-id'};
    my $mailto = $opts->{mailto};
    my $cmdline = $self->{cmdline};
    my $policy = $opts->{mailnotification} // 'always';
    my $mode = $opts->{"notification-mode"} // 'auto';

    sanitize_task_list($tasklist);
    my ($error_count, $total_size) = aggregate_task_statistics($tasklist);

    my $failed = ($error_count || $err);

    my $status_text = $failed ? 'backup failed' : 'backup successful';

    if ($err) {
        if ($err =~ /\n/) {
            $status_text .= ": multiple problems";
        } else {
            $status_text .= ": $err";
            $err = undef;
        }
    }

    my $text_log_part = "$cmdline\n\n";
    $text_log_part .= $detail_pre . "\n" if defined($detail_pre);
    $text_log_part .= read_backup_task_logs($tasklist);
    $text_log_part .= $detail_post if defined($detail_post);

    if (length($text_log_part) > MAX_LOG_SIZE) {
        # Let's limit the maximum length of included logs
        $text_log_part = "Log output was too long to be sent. " . "See Task History for details!\n";
    }

    my $template_data = PVE::Notify::common_template_data();
    $template_data->{error} = $err;
    $template_data->{"guest-table"} = build_guest_table($tasklist);
    $template_data->{logs} = $text_log_part;
    $template_data->{"status-text"} = $status_text;
    $template_data->{"total-size"} = $total_size;
    $template_data->{"total-time"} = $total_time;

    my $fields = {
        type => "vzdump",
        # Hostname (without domain part)
        hostname => PVE::INotify::nodename(),
    };
    # Add backup-job metadata field in case this is a backup job.
    $fields->{'job-id'} = $job_id if $job_id;

    my $severity = $failed ? "error" : "info";
    my $email_configured = $mailto && scalar(@$mailto);

    if (($mode eq 'auto' && $email_configured) || $mode eq 'legacy-sendmail') {
        if ($email_configured && ($policy eq "always" || ($policy eq "failure" && $failed))) {
            # Start out with an empty config. Might still contain
            # built-ins, so we need to disable/remove them.
            my $notification_config = Proxmox::RS::Notify->parse_config('', '');

            # Remove built-in matchers, since we only want to send an
            # email to the specified recipients and nobody else.
            for my $matcher (@{ $notification_config->get_matchers() }) {
                $notification_config->delete_matcher($matcher->{name});
            }

            # <, >, @ are not allowed in endpoint names, but that is only
            # verified once the config is serialized. That means that
            # we can rely on that fact that no other endpoint with this name exists.
            my $endpoint_name = "<" . join(",", @$mailto) . ">";
            $notification_config->add_sendmail_endpoint(
                $endpoint_name,
                $mailto,
                undef,
                undef,
                "vzdump backup tool",
            );

            my $endpoints = [$endpoint_name];

            # Add a matcher that matches all notifications, set our
            # newly created target as a target.
            $notification_config->add_matcher(
                "<matcher-$endpoint_name>", $endpoints,
            );

            PVE::Notify::notify(
                $severity, "vzdump", $template_data, $fields, $notification_config,
            );
        }
    } else {
        # We use the 'new' system, or we are set to 'auto' and
        # no email addresses were configured.
        PVE::Notify::notify(
            $severity, "vzdump", $template_data, $fields,
        );
    }
}

sub new {
    my ($class, $cmdline, $opts, $skiplist) = @_;

    mkpath $logdir;

    check_bin('cp');
    check_bin('df');
    check_bin('sendmail');
    check_bin('rsync');
    check_bin('tar');
    check_bin('mount');
    check_bin('umount');
    check_bin('cstream');
    check_bin('ionice');

    if ($opts->{mode} && $opts->{mode} eq 'snapshot') {
        check_bin('lvcreate');
        check_bin('lvs');
        check_bin('lvremove');
    }

    my $defaults = read_vzdump_defaults();

    foreach my $k (keys %$defaults) {
        next if $k eq 'exclude-path' || $k eq 'prune-backups'; # dealt with separately
        if ($k eq 'dumpdir' || $k eq 'storage') {
            $opts->{$k} = $defaults->{$k}
                if !defined($opts->{dumpdir})
                && !defined($opts->{storage});
        } elsif (!defined($opts->{$k})) {
            $opts->{$k} = $defaults->{$k};
        } elsif ($k eq 'performance') {
            $opts->{$k} = merge_performance($opts->{$k}, $defaults->{$k});
        }
    }

    $opts->{dumpdir} =~ s|/+$|| if ($opts->{dumpdir});
    $opts->{tmpdir} =~ s|/+$|| if ($opts->{tmpdir});

    $skiplist = [] if !$skiplist;
    my $self = bless {
        cmdline => $cmdline,
        opts => $opts,
        skiplist => $skiplist,
    }, $class;

    my $findexcl = $self->{findexcl} = [];
    if ($defaults->{'exclude-path'}) {
        push @$findexcl, @{ $defaults->{'exclude-path'} };
    }

    if ($opts->{'exclude-path'}) {
        push @$findexcl, @{ $opts->{'exclude-path'} };
    }

    if ($opts->{stdexcludes}) {
        push @$findexcl, '/tmp/?*', '/var/tmp/?*', '/var/run/?*.pid',;
    }

    foreach my $p (@plugins) {
        my $pd = $p->new($self);

        push @{ $self->{plugins} }, $pd;
    }

    if (defined($opts->{storage}) && $opts->{stdout}) {
        die "cannot use options 'storage' and 'stdout' at the same time\n";
    } elsif (defined($opts->{storage}) && defined($opts->{dumpdir})) {
        die "cannot use options 'storage' and 'dumpdir' at the same time\n";
    }

    if (my $storage = get_storage_param($opts)) {
        $opts->{storage} = $storage;
    }

    # Enforced by the API too, but these options might come in via defaults. Drop them if necessary.
    if (!$opts->{storage}) {
        delete $opts->{$_} for qw(notes-template protected);
    }

    my $errors = '';
    my $add_error = sub {
        my ($error) = @_;
        $errors .= "\n" if $errors;
        chomp($error);
        $errors .= $error;
    };

    eval {
        $self->{job_init_log} = '';
        open my $job_init_fd, '>', \$self->{job_init_log};
        $self->run_hook_script('job-init', undef, $job_init_fd);
        close $job_init_fd;

        PVE::Cluster::cfs_update(); # Pick up possible changes made by the hook script.
    };
    $add_error->($@) if $@;

    if ($opts->{storage}) {
        my $storage_cfg = PVE::Storage::config();
        eval { PVE::Storage::activate_storage($storage_cfg, $opts->{storage}) };
        $add_error->("could not activate storage '$opts->{storage}': $@") if $@;

        my $info = eval { storage_info($opts->{storage}) };
        if (my $err = $@) {
            $add_error->("could not get storage information for '$opts->{storage}': $err");
        } else {
            $opts->{dumpdir} = $info->{dumpdir};
            $opts->{scfg} = $info->{scfg};
            $opts->{pbs} = $info->{pbs};
            $opts->{'prune-backups'} //= $info->{'prune-backups'};
            $self->{'backup-provider'} = $info->{'backup-provider'} if $info->{'backup-provider'};
        }
    } elsif ($opts->{dumpdir}) {
        $add_error->("dumpdir '$opts->{dumpdir}' does not exist")
            if !-d $opts->{dumpdir};
    } else {
        die "internal error";
    }

    $opts->{'prune-backups'} //= $defaults->{'prune-backups'};

    # avoid triggering any remove code path if keep-all is set
    $opts->{remove} = 0 if $opts->{'prune-backups'}->{'keep-all'};

    if ($opts->{tmpdir} && !-d $opts->{tmpdir}) {
        $add_error->("tmpdir '$opts->{tmpdir}' does not exist");
    }

    if ($errors) {
        eval { $self->send_notification([], 0, $errors); };
        debugmsg('err', $@) if $@;
        die "$errors\n";
    }

    return $self;
}

sub get_mount_info {
    my ($dir) = @_;

    # Note: df 'available' can be negative, and percentage set to '-'

    my $cmd = ['df', '-P', '-T', '-B', '1', $dir];

    my $res;

    my $parser = sub {
        my $line = shift;
        if (
            my ($fsid, $fstype, undef, $mp) =
            $line =~ m!(\S+.*)\s+(\S+)\s+\d+\s+\-?\d+\s+\d+\s+(\d+%|-)\s+(/.*)$!
        ) {
            $res = {
                device => $fsid,
                fstype => $fstype,
                mountpoint => $mp,
            };
        }
    };

    eval {
        PVE::Tools::run_command($cmd, errfunc => sub { }, outfunc => $parser);
    };
    warn $@ if $@;

    return $res;
}

sub getlock {
    my ($self, $upid) = @_;

    my $fh;

    my $maxwait = $self->{opts}->{lockwait} || $self->{lockwait};

    die "missing UPID" if !$upid; # should not happen

    my $SERVER_FLCK;
    if (!open($SERVER_FLCK, '>>', "$lockfile")) {
        debugmsg('err', "can't open lock on file '$lockfile' - $!", undef, 1);
        die "can't open lock on file '$lockfile' - $!";
    }

    if (!flock($SERVER_FLCK, LOCK_EX | LOCK_NB)) {
        if (!$maxwait) {
            debugmsg('err', "can't acquire lock '$lockfile' (wait = 0)", undef, 1);
            die "can't acquire lock '$lockfile' (wait = 0)";
        }

        debugmsg('info', "trying to get global lock - waiting...", undef, 1);
        eval {
            alarm($maxwait * 60);

            local $SIG{ALRM} = sub { alarm(0); die "got timeout\n"; };

            if (!flock($SERVER_FLCK, LOCK_EX)) {
                my $err = $!;
                close($SERVER_FLCK);
                alarm(0);
                die "$err\n";
            }
            alarm(0);
        };
        alarm(0);

        my $err = $@;

        if ($err) {
            debugmsg('err', "can't acquire lock '$lockfile' - $err", undef, 1);
            die "can't acquire lock '$lockfile' - $err";
        }

        debugmsg('info', "got global lock", undef, 1);
    }

    PVE::Tools::file_set_contents($pidfile, $upid);

    return $SERVER_FLCK;
}

sub run_hook_script {
    my ($self, $phase, $task, $logfd) = @_;

    my $opts = $self->{opts};

    my $script = $opts->{script};
    return if !$script;

    die "Error: The hook script '$script' does not exist.\n" if !-f $script;
    die "Error: The hook script '$script' is not executable.\n" if !-x $script;

    my $cmd = [$script, $phase];

    if ($task) {
        push @$cmd, $task->{mode};
        push @$cmd, $task->{vmid};
    }

    local %ENV;
    # set immutable opts directly (so they are available in all phases)
    $ENV{STOREID} = $opts->{storage} if $opts->{storage};
    $ENV{DUMPDIR} = $opts->{dumpdir} if $opts->{dumpdir};

    foreach my $ek (qw(vmtype hostname target logfile)) {
        $ENV{ uc($ek) } = $task->{$ek} if $task->{$ek};
    }

    run_command($logfd, $cmd);
}

sub compressor_info {
    my ($opts) = @_;
    my $opt_compress = $opts->{compress};

    if (!$opt_compress || $opt_compress eq '0') {
        return undef;
    } elsif ($opt_compress eq '1' || $opt_compress eq 'lzo') {
        return ('lzop', 'lzo');
    } elsif ($opt_compress eq 'gzip') {
        if ($opts->{pigz} > 0) {
            my $pigz_threads = $opts->{pigz};
            if ($pigz_threads == 1) {
                my $cpuinfo = PVE::ProcFSTools::read_cpuinfo();
                $pigz_threads = int(($cpuinfo->{cpus} + 1) / 2);
            }
            return ("pigz -p ${pigz_threads} --rsyncable", 'gz');
        } else {
            return ('gzip --rsyncable', 'gz');
        }
    } elsif ($opt_compress eq 'zstd') {
        my $zstd_threads = $opts->{zstd} // 1;
        if ($zstd_threads == 0) {
            my $cpuinfo = PVE::ProcFSTools::read_cpuinfo();
            $zstd_threads = int(($cpuinfo->{cpus} + 1) / 2);
        }
        return ("zstd --threads=${zstd_threads}", 'zst');
    } else {
        die "internal error - unknown compression option '$opt_compress'";
    }
}

sub get_backup_file_list {
    my ($dir, $bkname) = @_;

    my $bklist = [];
    foreach my $fn (<$dir/${bkname}-*>) {
        my $archive_info = eval { PVE::Storage::archive_info($fn) } // {};
        if ($archive_info->{is_std_name}) {
            my $path = "$dir/$archive_info->{filename}";
            my $backup = {
                'path' => $path,
                'ctime' => $archive_info->{ctime},
            };
            $backup->{mark} = "protected"
                if -e PVE::Storage::protection_file_path($path);
            push @{$bklist}, $backup;
        }
    }

    return $bklist;
}

sub exec_backup_task {
    my ($self, $task) = @_;

    my $opts = $self->{opts};

    my $cfg = PVE::Storage::config();
    my $vmid = $task->{vmid};
    my $plugin = $task->{plugin};

    $task->{backup_time} = time();

    my $pbs_group_name;
    my $pbs_snapshot_name;

    my $vmstarttime = time();

    my $logfd;

    my $cleanup = {};

    my $log_vm_online_again = sub {
        return if !defined($task->{vmstoptime});
        $task->{vmconttime} //= time();
        my $delay = $task->{vmconttime} - $task->{vmstoptime};
        $delay = '<1' if $delay < 1;
        debugmsg('info', "guest is online again after $delay seconds", $logfd);
    };

    eval {
        die "unable to find VM '$vmid'\n" if !$plugin;

        my $vmtype = $plugin->type();

        if ($self->{opts}->{pbs}) {
            if ($vmtype eq 'lxc') {
                $pbs_group_name = "ct/$vmid";
            } elsif ($vmtype eq 'qemu') {
                $pbs_group_name = "vm/$vmid";
            } else {
                die "pbs backup not implemented for plugin type '$vmtype'\n";
            }
            my $btime = strftime("%FT%TZ", gmtime($task->{backup_time}));
            $pbs_snapshot_name = "$pbs_group_name/$btime";
        }

        # for now we deny backups of a running ha managed service in *stop* mode
        # as it interferes with the HA stack (started services should not stop).
        if (
            $opts->{mode} eq 'stop'
            && PVE::HA::Config::vm_is_ha_managed($vmid, 'started')
        ) {
            die "Cannot execute a backup with stop mode on a HA managed and"
                . " enabled Service. Use snapshot mode or disable the Service.\n";
        }

        my $tmplog = "$logdir/$vmtype-$vmid.log";

        my $bkname = "vzdump-$vmtype-$vmid";
        my $basename =
            $bkname . strftime("-%Y_%m_%d-%H_%M_%S", localtime($task->{backup_time}));

        my $prune_options = $opts->{'prune-backups'};

        my $backup_limit = 0;
        if (!$prune_options->{'keep-all'}) {
            foreach my $keep (values %{$prune_options}) {
                $backup_limit += $keep;
            }
        }

        if (($backup_limit && !$opts->{remove}) || $opts->{protected}) {
            my $count;
            my $protected_count;
            if (my $storeid = $opts->{storage}) {
                my @backups = grep {
                    !$_->{subtype} || $_->{subtype} eq $vmtype
                } PVE::Storage::volume_list($cfg, $storeid, $vmid, 'backup')->@*;

                $count = grep { !$_->{protected} } @backups;
                $protected_count = scalar(@backups) - $count;
            } else {
                $count = grep { !$_->{mark} || $_->{mark} ne "protected" }
                    get_backup_file_list($opts->{dumpdir}, $bkname)->@*;
            }

            if ($opts->{protected}) {
                my $max_protected = PVE::Storage::get_max_protected_backups(
                    $opts->{scfg}, $opts->{storage},
                );
                if ($max_protected > -1 && $protected_count >= $max_protected) {
                    die
                        "The number of protected backups per guest is limited to $max_protected "
                        . "on storage '$opts->{storage}'\n";
                }
            } elsif ($count >= $backup_limit) {
                die
                    "There is a max backup limit of $backup_limit enforced by the target storage "
                    . "or the vzdump parameters. Either increase the limit or delete old backups.\n";
            }
        }

        if (!$self->{opts}->{pbs} && !$self->{'backup-provider'}) {
            $task->{logfile} = "$opts->{dumpdir}/$basename.log";
        }

        my $ext = $vmtype eq 'qemu' ? '.vma' : '.tar';
        my ($comp, $comp_ext) = compressor_info($opts);
        if ($comp && $comp_ext) {
            $ext .= ".${comp_ext}";
        }

        if ($self->{'backup-provider'}) {
            die "unable to pipe backup to stdout\n" if $opts->{stdout};
            # the archive name $task->{target} is returned by the start hook a bit later
        } elsif ($self->{opts}->{pbs}) {
            die "unable to pipe backup to stdout\n" if $opts->{stdout};
            $task->{target} = $pbs_snapshot_name;
        } else {
            if ($opts->{stdout}) {
                $task->{target} = '-';
            } else {
                $task->{target} = $task->{tmptar} = "$opts->{dumpdir}/$basename$ext";
                $task->{tmptar} =~ s/\.[^\.]+$/\.dat/;
                unlink $task->{tmptar};
            }
        }

        $task->{vmtype} = $vmtype;

        my $pid = $$;
        if ($opts->{tmpdir}) {
            $task->{tmpdir} = "$opts->{tmpdir}/vzdumptmp${pid}_$vmid/";
        } elsif ($self->{opts}->{pbs} || $self->{'backup-provider'}) {
            $task->{tmpdir} = "/var/tmp/vzdumptmp${pid}_$vmid";
        } else {
            # dumpdir is posix? then use it as temporary dir
            my $info = get_mount_info($opts->{dumpdir});
            if (
                $vmtype eq 'qemu'
                || grep ($_ eq $info->{fstype}, @posix_filesystems)
            ) {
                $task->{tmpdir} = "$opts->{dumpdir}/$basename.tmp";
            } else {
                $task->{tmpdir} = "/var/tmp/vzdumptmp${pid}_$vmid";
                debugmsg(
                    'info',
                    "filesystem type on dumpdir is '$info->{fstype}' -"
                        . "using $task->{tmpdir} for temporary files",
                    $logfd,
                );
            }
        }

        rmtree $task->{tmpdir};
        mkdir $task->{tmpdir};
        -d $task->{tmpdir}
            || die "unable to create temporary directory '$task->{tmpdir}'";

        $logfd = IO::File->new(">$tmplog")
            || die "unable to create log file '$tmplog'";

        $task->{dumpdir} = $opts->{dumpdir};
        $task->{storeid} = $opts->{storage};
        $task->{scfg} = $opts->{scfg};
        $task->{tmplog} = $tmplog;

        unlink $task->{logfile} if defined($task->{logfile});

        debugmsg('info', "Starting Backup of VM $vmid ($vmtype)", $logfd, 1);
        debugmsg('info', "Backup started at " . strftime("%F %H:%M:%S", localtime()));

        $plugin->set_logfd($logfd);

        # test is VM is running
        my ($running, $status_text) = $plugin->vm_status($vmid);

        debugmsg('info', "status = ${status_text}", $logfd);

        # lock VM (prevent config changes)
        $plugin->lock_vm($vmid);

        $cleanup->{unlock} = 1;

        # prepare

        my $mode = $running ? $task->{mode} : 'stop';

        if ($mode eq 'snapshot') {
            my %saved_task = %$task;
            eval { $plugin->prepare($task, $vmid, $mode); };
            if (my $err = $@) {
                die $err if $err !~ m/^mode failure/;
                debugmsg('info', $err, $logfd);
                debugmsg('info', "trying 'suspend' mode instead", $logfd);
                $mode = 'suspend'; # so prepare is called again below
                %$task = %saved_task;
            }
        }

        $cleanup->{prepared} = 1;

        $task->{mode} = $mode;

        debugmsg('info', "backup mode: $mode", $logfd);
        debugmsg('info', "bandwidth limit: $opts->{bwlimit} KiB/s", $logfd) if $opts->{bwlimit};
        debugmsg('info', "ionice priority: $opts->{ionice}", $logfd);

        my $backup_provider_init = sub {
            my $init_result =
                $self->{'backup-provider'}->backup_init($vmid, $vmtype, $task->{backup_time});
            die "backup init failed: did not receive a valid result from the backup provider\n"
                if !defined($init_result) || ref($init_result) ne 'HASH';
            my $archive_name = $init_result->{'archive-name'};
            die "backup init failed: did not receive an archive name from backup provider\n"
                if !defined($archive_name) || length($archive_name) == 0;
            die "backup init failed: illegal characters in archive name '$archive_name'\n"
                if $archive_name !~ m!^(${PVE::Storage::SAFE_CHAR_CLASS_RE}|/|:)+$!;
            $task->{target} = $archive_name;
        };

        if ($mode eq 'stop') {
            $plugin->prepare($task, $vmid, $mode);

            $backup_provider_init->() if $self->{'backup-provider'};
            $self->run_hook_script('backup-start', $task, $logfd);

            if ($running) {
                debugmsg('info', "stopping virtual guest", $logfd);
                $task->{vmstoptime} = time();
                $self->run_hook_script('pre-stop', $task, $logfd);
                $plugin->stop_vm($task, $vmid);
                $cleanup->{restart} = 1;
            }

        } elsif ($mode eq 'suspend') {
            $plugin->prepare($task, $vmid, $mode);

            $backup_provider_init->() if $self->{'backup-provider'};
            $self->run_hook_script('backup-start', $task, $logfd);

            if ($vmtype eq 'lxc') {
                # pre-suspend rsync
                $plugin->copy_data_phase1($task, $vmid);
            }

            debugmsg('info', "suspending guest", $logfd);
            $task->{vmstoptime} = time();
            $self->run_hook_script('pre-stop', $task, $logfd);
            $plugin->suspend_vm($task, $vmid);
            $cleanup->{resume} = 1;

            if ($vmtype eq 'lxc') {
                # post-suspend rsync
                $plugin->copy_data_phase2($task, $vmid);

                debugmsg('info', "resuming guest", $logfd);
                $cleanup->{resume} = 0;
                $self->run_hook_script('pre-restart', $task, $logfd);
                $plugin->resume_vm($task, $vmid);
                $self->run_hook_script('post-restart', $task, $logfd);
                $log_vm_online_again->();
            }

        } elsif ($mode eq 'snapshot') {
            $backup_provider_init->() if $self->{'backup-provider'};
            $self->run_hook_script('backup-start', $task, $logfd);

            my $snapshot_count = $task->{snapshot_count} || 0;

            $self->run_hook_script('pre-stop', $task, $logfd);

            if ($snapshot_count > 1) {
                debugmsg('info', "suspend vm to make snapshot", $logfd);
                $task->{vmstoptime} = time();
                $plugin->suspend_vm($task, $vmid);
                $cleanup->{resume} = 1;
            }

            $plugin->snapshot($task, $vmid);

            $self->run_hook_script('pre-restart', $task, $logfd);

            if ($snapshot_count > 1) {
                debugmsg('info', "resume vm", $logfd);
                $cleanup->{resume} = 0;
                $plugin->resume_vm($task, $vmid);
                $log_vm_online_again->();
            }

            $self->run_hook_script('post-restart', $task, $logfd);

        } else {
            die "internal error - unknown mode '$mode'\n";
        }

        # assemble archive image
        $plugin->assemble($task, $vmid);

        # produce archive

        if ($opts->{stdout}) {
            debugmsg('info', "sending archive to stdout", $logfd);
            $plugin->archive($task, $vmid, $task->{tmptar}, $comp);
            $self->run_hook_script('backup-end', $task, $logfd);
            return;
        }

        my $archive_txt = 'vzdump';
        $archive_txt = 'Proxmox Backup Server' if $self->{opts}->{pbs};
        $archive_txt = $self->{'backup-provider'}->provider_name()
            if $self->{'backup-provider'};
        debugmsg('info', "creating $archive_txt archive '$task->{target}'", $logfd);
        $plugin->archive($task, $vmid, $task->{tmptar}, $comp);

        if ($self->{'backup-provider'} || $self->{opts}->{pbs}) {
            # size is added to task struct in guest vzdump plugins
        } else {
            rename($task->{tmptar}, $task->{target})
                || die "unable to rename '$task->{tmptar}' to '$task->{target}'\n";

            # determine size
            $task->{size} = (-s $task->{target}) || 0;
            my $cs = format_size($task->{size});
            debugmsg('info', "archive file size: $cs", $logfd);
        }

        # Mark as protected before pruning.
        if (my $storeid = $opts->{storage}) {
            my $volname =
                $opts->{pbs} || $self->{'backup-provider'}
                ? $task->{target}
                : basename($task->{target});
            my $volid = "${storeid}:backup/${volname}";

            if ($opts->{'notes-template'} && $opts->{'notes-template'} ne '') {
                debugmsg('info', "adding notes to backup", $logfd);
                my $notes = eval { $generate_notes->($opts->{'notes-template'}, $task); };
                if (my $err = $@) {
                    debugmsg('warn', "unable to add notes - $err", $logfd);
                } else {
                    eval {
                        PVE::Storage::update_volume_attribute($cfg, $volid, 'notes', $notes);
                    };
                    debugmsg('warn', "unable to add notes - $@", $logfd) if $@;
                }
            }

            if ($opts->{protected}) {
                debugmsg('info', "marking backup as protected", $logfd);
                eval { PVE::Storage::update_volume_attribute($cfg, $volid, 'protected', 1) };
                die "unable to set protected flag - $@\n" if $@;
            }
        }

        if ($opts->{remove}) {
            my $keepstr =
                join(', ', map { "$_=$prune_options->{$_}" } sort keys %$prune_options);
            debugmsg('info', "prune older backups with retention: $keepstr", $logfd);
            my $pruned = 0;
            if (!defined($opts->{storage})) {
                my $bklist = get_backup_file_list($opts->{dumpdir}, $bkname);

                PVE::Storage::prune_mark_backup_group($bklist, $prune_options);

                foreach my $prune_entry (@{$bklist}) {
                    next if $prune_entry->{mark} ne 'remove';
                    $pruned++;
                    my $archive_path = $prune_entry->{path};
                    debugmsg('info', "delete old backup '$archive_path'", $logfd);
                    PVE::Storage::archive_remove($archive_path);
                }
            } else {
                my $pruned_list = PVE::Storage::prune_backups(
                    $cfg,
                    $opts->{storage},
                    $prune_options,
                    $vmid,
                    $vmtype,
                    0,
                    sub { debugmsg($_[0], $_[1], $logfd) },
                );
                $pruned = scalar(grep { $_->{mark} eq 'remove' } $pruned_list->@*);
            }
            my $log_pruned_extra = $pruned > 0 ? " not covered by keep-retention policy" : "";
            debugmsg('info', "pruned $pruned backup(s)${log_pruned_extra}", $logfd);
        }

        if ($self->{'backup-provider'}) {
            my $cleanup_result =
                $self->{'backup-provider'}->backup_cleanup($vmid, $vmtype, 1, {});
            $task->{size} = $cleanup_result->{stats}->{'archive-size'};
        }
        $self->run_hook_script('backup-end', $task, $logfd);
    };
    my $err = $@;

    if ($plugin) {
        # clean-up

        if ($cleanup->{unlock}) {
            eval { $plugin->unlock_vm($vmid); };
            warn $@ if $@;
        }

        if ($cleanup->{prepared}) {
            # only call cleanup when necessary (when prepare was executed)
            eval { $plugin->cleanup($task, $vmid) };
            warn $@ if $@;
        }

        eval { $plugin->set_logfd(undef); };
        warn $@ if $@;

        if ($cleanup->{resume} || $cleanup->{restart}) {
            eval {
                $self->run_hook_script('pre-restart', $task, $logfd);
                if ($cleanup->{resume}) {
                    debugmsg('info', "resume vm", $logfd);
                    $plugin->resume_vm($task, $vmid);
                } else {
                    my $running = $plugin->vm_status($vmid);
                    if (!$running) {
                        debugmsg('info', "restarting vm", $logfd);
                        $plugin->start_vm($task, $vmid);
                    }
                }
                $self->run_hook_script('post-restart', $task, $logfd);
            };
            my $err = $@;
            if ($err) {
                warn $err;
            } else {
                $log_vm_online_again->();
            }
        }
    }

    eval { unlink $task->{tmptar} if $task->{tmptar} && -f $task->{tmptar}; };
    warn $@ if $@;

    eval { rmtree $task->{tmpdir} if $task->{tmpdir} && -d $task->{tmpdir}; };
    warn $@ if $@;

    my $delay = $task->{backuptime} = time() - $vmstarttime;

    if ($err) {
        $task->{state} = 'err';
        $task->{msg} = $err;
        debugmsg('err', "Backup of VM $vmid failed - $err", $logfd, 1);
        debugmsg('info', "Failed at " . strftime("%F %H:%M:%S", localtime()));

        if ($self->{'backup-provider'}) {
            eval {
                $self->{'backup-provider'}
                    ->backup_cleanup($vmid, $task->{vmtype}, 0, { error => $err });
            };
            debugmsg('warn', "backup cleanup for external provider failed - $@") if $@;
        }

        eval { $self->run_hook_script('backup-abort', $task, $logfd); };
        debugmsg('warn', $@) if $@; # message already contains command with phase name

    } else {
        $task->{state} = 'ok';
        my $tstr = format_time($delay);
        debugmsg('info', "Finished Backup of VM $vmid ($tstr)", $logfd, 1);
        debugmsg('info', "Backup finished at " . strftime("%F %H:%M:%S", localtime()));
    }

    close($logfd) if $logfd;

    if ($task->{tmplog}) {
        if ($self->{opts}->{pbs}) {
            if ($task->{state} eq 'ok') {
                eval {
                    PVE::Storage::PBSPlugin::run_raw_client_cmd(
                        $opts->{scfg},
                        $opts->{storage},
                        'upload-log',
                        [$pbs_snapshot_name, $task->{tmplog}],
                        errmsg => "uploading backup task log failed",
                        outfunc => sub { },
                    );
                };
                debugmsg('warn', "$@") if $@; # $@ contains already error prefix
            }
        } elsif ($self->{'backup-provider'}) {
            $self->{'backup-provider'}->backup_handle_log_file($vmid, $task->{tmplog});
        } elsif ($task->{logfile}) {
            system {'cp'} 'cp', $task->{tmplog}, $task->{logfile};
        }
    }

    eval { $self->run_hook_script('log-end', $task); };
    debugmsg('warn', $@) if $@; # message already contains command with phase name

    die $err if $err && $err =~ m/^interrupted by signal$/;
}

sub exec_backup {
    my ($self, $rpcenv, $authuser) = @_;

    my $opts = $self->{opts};

    debugmsg('info', "starting new backup job: $self->{cmdline}", undef, 1);

    if (scalar(@{ $self->{skiplist} })) {
        my $skip_string = join(', ', sort { $a <=> $b } @{ $self->{skiplist} });
        debugmsg('info', "skip external VMs: $skip_string");
    }

    my $tasklist = [];
    my $vzdump_plugins = {};
    foreach my $plugin (@{ $self->{plugins} }) {
        my $type = $plugin->type();
        next if exists $vzdump_plugins->{$type};
        $vzdump_plugins->{$type} = $plugin;
    }

    my $vmlist = PVE::Cluster::get_vmlist();
    my $vmids = [sort { $a <=> $b } @{ $opts->{vmids} }];
    foreach my $vmid (@{$vmids}) {
        my $plugin;
        if (defined($vmlist->{ids}->{$vmid})) {
            my $guest_type = $vmlist->{ids}->{$vmid}->{type};
            $plugin = $vzdump_plugins->{$guest_type};
            next if !$rpcenv->check($authuser, "/vms/$vmid", ['VM.Backup'], $opts->{all});
        }
        push @$tasklist,
            {
                mode => $opts->{mode},
                plugin => $plugin,
                state => 'todo',
                vmid => $vmid,
            };
    }

    # Use in-memory files for the outer hook logs to pass them to sendmail.
    my $job_start_log = '';
    my $job_end_log = '';
    open my $job_start_fd, '>', \$job_start_log;
    open my $job_end_fd, '>', \$job_end_log;

    my $starttime = time();
    my $errcount = 0;
    eval {

        $self->{'backup-provider'}->job_init($starttime) if $self->{'backup-provider'};
        $self->run_hook_script('job-start', undef, $job_start_fd);

        foreach my $task (@$tasklist) {
            $self->exec_backup_task($task);
            $errcount += 1 if $task->{state} ne 'ok';
        }

        $self->{'backup-provider'}->job_cleanup() if $self->{'backup-provider'};
        $self->run_hook_script('job-end', undef, $job_end_fd);
    };
    my $err = $@;

    if ($err) {
        if ($self->{'backup-provider'}) {
            eval { $self->{'backup-provider'}->job_cleanup(); };
            $err .= "job cleanup for external provider failed - $@" if $@;
        }

        eval { $self->run_hook_script('job-abort', undef, $job_end_fd); };
        $err .= $@ if $@;
        debugmsg('err', "Backup job failed - $err", undef, 1);
    } else {
        if ($errcount) {
            debugmsg('info', "Backup job finished with errors", undef, 1);
        } else {
            debugmsg('info', "Backup job finished successfully", undef, 1);
        }
    }

    close $job_start_fd;
    close $job_end_fd;

    my $totaltime = time() - $starttime;

    eval {
        # otherwise $self->send_notification() will interpret it as multiple problems
        my $chomped_err = $err;
        chomp($chomped_err) if $chomped_err;

        $self->send_notification(
            $tasklist,
            $totaltime,
            $chomped_err,
            $self->{job_init_log} . $job_start_log,
            $job_end_log,
        );
    };
    debugmsg('err', $@) if $@;

    die $err if $err;

    die "job errors\n" if $errcount;

    unlink $pidfile;
}

sub option_exists {
    my $key = shift;
    return defined($confdesc->{$key});
}

# NOTE it might make sense to merge this and verify_vzdump_parameters(), but one
# needs to adapt command_line() in guest-common's PVE/VZDump/Common.pm and detect
# a second parsing attempt, because verify_vzdump_parameters() is called twice
# during the update_job API call.
sub parse_mailto_exclude_path {
    my ($param) = @_;

    # exclude-path list need to be 0 separated or be an array
    if (defined($param->{'exclude-path'})) {
        my $expaths;
        if (ref($param->{'exclude-path'}) eq 'ARRAY') {
            $expaths = $param->{'exclude-path'};
        } else {
            $expaths = [split(/\0/, $param->{'exclude-path'} || '')];
        }
        $param->{'exclude-path'} = $expaths;
    }

    if (defined($param->{mailto})) {
        my @mailto = PVE::Tools::split_list(extract_param($param, 'mailto'));
        $param->{mailto} = [@mailto];
    }

    return;
}

sub verify_vzdump_parameters {
    my ($param, $check_missing) = @_;

    raise_param_exc({ all => "option conflicts with option 'vmid'" })
        if $param->{all} && $param->{vmid};

    raise_param_exc({ exclude => "option conflicts with option 'vmid'" })
        if $param->{exclude} && $param->{vmid};

    raise_param_exc({ pool => "option conflicts with option 'vmid'" })
        if $param->{pool} && $param->{vmid};

    $parse_prune_backups->($param, 'CLI parameters');
    parse_fleecing($param);
    parse_performance($param);

    if (my $template = $param->{'notes-template'}) {
        eval { $verify_notes_template->($template); };
        raise_param_exc({ 'notes-template' => $@ }) if $@;
    }

    $param->{all} = 1 if (defined($param->{exclude}) && !$param->{pool});

    return if !$check_missing;

    raise_param_exc({ vmid => "property is missing" })
        if !($param->{all} || $param->{stop} || $param->{pool}) && !$param->{vmid};

}

sub stop_running_backups {
    my ($self) = @_;

    my $upid = PVE::Tools::file_read_firstline($pidfile);
    return if !$upid;

    my $task = PVE::Tools::upid_decode($upid);

    if (
        PVE::ProcFSTools::check_process_running($task->{pid}, $task->{pstart})
        && PVE::ProcFSTools::read_proc_starttime($task->{pid}) == $task->{pstart}
    ) {
        kill(15, $task->{pid});
        # wait max 15 seconds to shut down (else, do nothing for now)
        my $i;
        for ($i = 15; $i > 0; $i--) {
            last if !PVE::ProcFSTools::check_process_running(($task->{pid}, $task->{pstart}));
            sleep(1);
        }
        die "stopping backup process $task->{pid} failed\n" if $i == 0;
    }
}

sub get_included_guests {
    my ($job) = @_;

    my $vmids = [];
    my $vmids_per_node = {};

    my $vmlist = PVE::Cluster::get_vmlist();

    if ($job->{pool}) {
        $vmids = PVE::API2Tools::get_resource_pool_guest_members($job->{pool});
    } elsif ($job->{vmid}) {
        $vmids = [split_list($job->{vmid})];
    } elsif ($job->{all}) {
        # all or exclude
        my $exclude = check_vmids(split_list($job->{exclude}));
        my $excludehash = { map { $_ => 1 } @$exclude };

        for my $id (keys %{ $vmlist->{ids} }) {
            next if $excludehash->{$id};
            push @$vmids, $id;
        }
    } else {
        return $vmids_per_node;
    }
    $vmids = check_vmids(@$vmids);

    for my $vmid (@$vmids) {
        if (defined($vmlist->{ids}->{$vmid})) {
            my $node = $vmlist->{ids}->{$vmid}->{node};
            next if (defined $job->{node} && $job->{node} ne $node);

            push @{ $vmids_per_node->{$node} }, $vmid;
        } else {
            push @{ $vmids_per_node->{''} }, $vmid;
        }
    }

    return $vmids_per_node;
}

1;
