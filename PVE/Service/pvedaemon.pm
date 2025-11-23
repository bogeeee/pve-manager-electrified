package PVE::Service::pvedaemon;

use strict;
use warnings;

use PVE::SafeSyslog;
use PVE::Daemon;
use PVE::API2;
use PVE::APIServer::Formatter::Standard;
use PVE::APIServer::Formatter::HTML;
use PVE::HTTPServer;

use base qw(PVE::Daemon);

my $cmdline = [$0, @ARGV];

my %daemon_options = (
    max_workers => 3, # may be overridden in init
    restart_on_error => 5,
    stop_wait_time => 15,
    leave_children_open_on_reload => 1,
);

my $daemon = __PACKAGE__->new('pvedaemon', $cmdline, %daemon_options);

sub init {
    my ($self) = @_;

    # all options other than MAX_WORKERS are ignored
    my $proxyconf = PVE::APIServer::Utils::read_proxy_config($self->{name});
    $self->{max_workers} = $proxyconf->{MAX_WORKERS} if $proxyconf->{MAX_WORKERS};

    my $accept_lock_fn = "/var/lock/pvedaemon.lck";

    my $lockfh = IO::File->new(">>${accept_lock_fn}")
        || die "unable to open lock file '${accept_lock_fn}' - $!\n";

    my $socket = $self->create_reusable_socket(85, '127.0.0.1');

    $self->{server_config} = {
        keep_alive => 100,
        max_conn => 500,
        max_requests => 1000,
        lockfile => $accept_lock_fn,
        socket => $socket,
        lockfh => $lockfh,
        debug => $self->{debug},
        trusted_env => 1,
    };
}

sub run {
    my ($self) = @_;

    my $server = PVE::HTTPServer->new(%{ $self->{server_config} });
    $server->run();
}

$daemon->register_start_command();
$daemon->register_restart_command(1);
$daemon->register_stop_command();
$daemon->register_status_command();

our $cmddef = {
    start => [__PACKAGE__, 'start', []],
    restart => [__PACKAGE__, 'restart', []],
    stop => [__PACKAGE__, 'stop', []],
    status => [__PACKAGE__, 'status', [], undef, sub { print shift . "\n"; }],
};

1;
