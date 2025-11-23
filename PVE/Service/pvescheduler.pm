package PVE::Service::pvescheduler;

use strict;
use warnings;

use POSIX qw(WNOHANG);

use PVE::Jobs;
use PVE::SafeSyslog;

use PVE::API2::Replication;

use PVE::Daemon;
use base qw(PVE::Daemon);

my $cmdline = [$0, @ARGV];
my %daemon_options = (stop_wait_time => 180, max_workers => 0);
my $daemon = __PACKAGE__->new('pvescheduler', $cmdline, %daemon_options);

my @JOB_TYPES = qw(replication jobs);

my sub running_job_pids : prototype($) {
    my ($self) = @_;
    my $pids = [map { keys $_->%* } values $self->{jobs}->%*];
    return scalar($pids->@*) ? $pids : undef;
}

my sub finish_jobs : prototype($) {
    my ($self) = @_;
    for my $type (@JOB_TYPES) {
        for my $cpid (keys $self->{jobs}->{$type}->%*) {
            if (my $waitpid = waitpid($cpid, WNOHANG)) {
                delete $self->{jobs}->{$type}->{$cpid} if $waitpid == $cpid || $waitpid == -1;
            }
        }
    }
}

sub hup {
    my ($self) = @_;

    my $old_workers = "";
    for my $type (@JOB_TYPES) {
        my $worker = $self->{jobs}->{$type} // next;
        $old_workers .= "$type:$_;" for keys $worker->%*;
    }
    $ENV{"PVE_DAEMON_WORKER_PIDS"} = $old_workers;
    $self->{got_hup_signal} = 1;
}

sub run {
    my ($self) = @_;

    my $jobs = {};
    $self->{jobs} = $jobs;

    # modelled after PVE::Daemons logic, but with type added to PID
    if (my $wpids = $ENV{PVE_DAEMON_WORKER_PIDS}) {
        print STDERR "got workers from previous daemon run: $wpids\n"; # FIXME: only log on debug?
        for my $pid (split(';', $wpids)) {
            if ($pid =~ m/^(\w+):(\d+)$/) { # check & untaint
                $self->{jobs}->{$1}->{$2} = 1;
            } else {
                warn "could not parse previous pid entry '$pid', ignoring\n";
            }
        }
    }

    my $old_sig_chld = $SIG{CHLD};
    local $SIG{CHLD} = sub {
        local ($@, $!, $?); # do not overwrite error vars
        finish_jobs($self);
        $old_sig_chld->(@_) if $old_sig_chld;
    };

    my $fork = sub {
        my ($type, $sub) = @_;

        # don't fork again if the previous iteration still runs
        # FIXME: some job types may handle this better themself or just not care - make configurable
        return if scalar(keys $self->{jobs}->{$type}->%*);

        my $child = fork();
        if (!defined($child)) {
            die "fork failed: $!\n";
        } elsif ($child == 0) {
            $self->after_fork_cleanup();
            eval { $sub->(); };
            if (my $err = $@) {
                syslog('err', "$type: $err");
            }
            POSIX::_exit(0);
        }

        $jobs->{$type}->{$child} = 1;
    };

    my $first_run = 1;

    my $run_jobs = sub {
        # TODO: actually integrate replication in PVE::Jobs and do not always fork here, we could
        # do the state lookup and check if there's new work scheduled before doing so, e.g., by
        # extending the PVE::Jobs interfacae e.g.;
        # my $scheduled_jobs = PVE::Jobs::get_pending() or return;
        # forked { PVE::Jobs::run_jobs($scheduled_jobs) }

        $fork->(
            'replication',
            sub {
                PVE::API2::Replication::run_jobs(undef, sub { }, 0, 1);
            },
        );

        $fork->(
            'jobs',
            sub {
                PVE::Jobs::run_jobs($first_run);
            },
        );

        $first_run = 0;
    };

    PVE::Jobs::setup_dirs();

    for (my $count = 1000;; $count++) {
        return if $self->{got_hup_signal}; # keep workers running, PVE::Daemon re-execs us on return
        last if $self->{shutdown_request}; # exit main-run loop for shutdown

        $run_jobs->();

        my $sleep_time = 60;
        if ($count >= 1000) {
            # Job schedule has minute precision, so try running near the minute boundary.
            my ($current_seconds) = localtime;
            $sleep_time = (60 - $current_seconds) if (60 - $current_seconds >= 5);
            $count = 0;
        }

        my $slept = 0; # SIGCHLD interrupts sleep, so we need to keep track
        while ($slept < $sleep_time) {
            last if $self->{shutdown_request} || $self->{got_hup_signal};
            $slept += sleep($sleep_time - $slept);
            # TODO: check if there's new work to do, e.g., if a job finished
            # that had a longer runtime than run period
        }
    }

    # NOTE: we only get here on shutdown_request, so we already sent a TERM to all job-types
    my $timeout = 0;
    while (my $pids = running_job_pids($self)) {
        kill 'TERM', $pids->@*; # send TERM to all workers at once, possible thundering herd - FIXME?

        finish_jobs($self);

        # some jobs have a lock timeout of 60s, wait a bit more for graceful termination
        last if $timeout > 75;
        $timeout += sleep(3);
    }

    if (my $pids = running_job_pids($self)) {
        syslog('warn', "unresponsive job-worker, killing now: " . join(', ', $pids->@*));
        kill 'KILL', $pids->@*;
    }
}

sub shutdown {
    my ($self) = @_;

    syslog('info', 'got shutdown request, signal running jobs to stop');

    for my $jobs (values $self->{jobs}->%*) {
        kill 'TERM', keys $jobs->%*;
    }
    $self->{shutdown_request} = 1;
}

$daemon->register_start_command();
$daemon->register_stop_command();
$daemon->register_restart_command(1);
$daemon->register_status_command();

our $cmddef = {
    start => [__PACKAGE__, 'start', []],
    stop => [__PACKAGE__, 'stop', []],
    restart => [__PACKAGE__, 'restart', []],
    status => [__PACKAGE__, 'status', [], undef, sub { print shift . "\n"; }],
};

1;
