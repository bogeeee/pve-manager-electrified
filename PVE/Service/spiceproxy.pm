package PVE::Service::spiceproxy;

# Note: In theory, all this can be done by 'pveproxy' daemon. But some
# API call still have blocking code, so we use a separate daemon to avoid
# that the console gets blocked.

use strict;
use warnings;

use PVE::SafeSyslog;
use PVE::Daemon;
use PVE::APIServer::Utils;
use PVE::HTTPServer;

use base qw(PVE::Daemon);

my $cmdline = [$0, @ARGV];

my %daemon_options = (
    max_workers => 1, # todo: do we need more?
    restart_on_error => 5,
    stop_wait_time => 15,
    leave_children_open_on_reload => 1,
    setuid => 'www-data',
    setgid => 'www-data',
    pidfile => '/var/run/pveproxy/spiceproxy.pid',
);

my $daemon = __PACKAGE__->new('spiceproxy', $cmdline, %daemon_options);

sub init {
    my ($self) = @_;

    # we use same ALLOW/DENY/POLICY as pveproxy
    my $proxyconf = PVE::APIServer::Utils::read_proxy_config('pveproxy');

    my $accept_lock_fn = "/var/lock/spiceproxy.lck";

    my $lockfh = IO::File->new(">>${accept_lock_fn}")
        || die "unable to open lock file '${accept_lock_fn}' - $!\n";

    my $listen_ip = $proxyconf->{LISTEN_IP};
    my $socket = $self->create_reusable_socket(3128, $listen_ip);

    $self->{server_config} = {
        keep_alive => 0,
        max_conn => 500,
        lockfile => $accept_lock_fn,
        socket => $socket,
        lockfh => $lockfh,
        debug => $self->{debug},
        spiceproxy => 1,
        trusted_env => 0,
        logfile => '/var/log/pveproxy/access.log',
        allow_from => $proxyconf->{ALLOW_FROM},
        deny_from => $proxyconf->{DENY_FROM},
        policy => $proxyconf->{POLICY},
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
