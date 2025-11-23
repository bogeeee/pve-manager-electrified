package PVE::API2::Services;

use strict;
use warnings;

use PVE::Tools;
use PVE::SafeSyslog;
use PVE::Cluster;
use PVE::INotify;
use PVE::Exception qw(raise_param_exc);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::JSONSchema qw(get_standard_option);
use PVE::AccessControl;
use IO::File;

use base qw(PVE::RESTHandler);

my $service_name_list = [
    'chrony',
    'corosync',
    'cron',
    'ksmtuned',
    'lxcfs',
    'postfix',
    'proxmox-firewall',
    'pve-cluster',
    'pve-firewall',
    'pve-ha-crm',
    'pve-ha-lrm',
    'pve-lxc-syscalld',
    'pvedaemon',
    'pvefw-logger',
    'pveproxy',
    'pvescheduler',
    'pvestatd',
    'qmeventd',
    'spiceproxy',
    'sshd',
    'syslog',
    'systemd-journald',
    'systemd-timesyncd',
];
my $essential_services = {
    pveproxy => 1,
    pvedaemon => 1,
    'pve-cluster' => 1,
};

# since postfix package 3.1.0-3.1 the postfix unit is only here to
# manage subinstances, of which the  default is called "-".
# This is where we look for the daemon status
my $unit_extra_names = {};

my $get_full_service_state = sub {
    my ($service) = @_;

    $service = $unit_extra_names->{$service} if $unit_extra_names->{$service};

    my $res;
    my $parser = sub {
        my $line = shift;
        if ($line =~ m/^([^=\s]+)=(.*)$/) {
            $res->{$1} = $2;
        }
    };

    PVE::Tools::run_command(['systemctl', 'show', $service], outfunc => $parser);

    return $res;
};

my $static_service_list;

sub get_service_list {

    return $static_service_list if $static_service_list;

    my $list = {};
    foreach my $name (@$service_name_list) {
        my $ss = eval { $get_full_service_state->($name) };
        warn $@ if $@;
        next if !$ss;
        next if !defined($ss->{Description});
        $list->{$name} = { name => $name, desc => $ss->{Description} };
    }

    $static_service_list = $list;

    return $static_service_list;
}

my $service_prop_desc = {
    description => "Service ID",
    type => 'string',
    enum => $service_name_list,
};

my $service_cmd = sub {
    my ($service, $cmd) = @_;

    my $initd_cmd;

    die "unknown service command '$cmd'\n"
        if $cmd !~ m/^(start|stop|restart|reload|try-reload-or-restart)$/;

    if ($essential_services->{$service} && $cmd eq 'stop') {
        die "invalid service cmd '$service $cmd': refusing to stop essential service!\n";
    }

    PVE::Tools::run_command(['systemctl', $cmd, $service]);
};

my $service_state = sub {
    my ($service) = @_;

    my $res = { state => 'unknown' };

    my $ss = eval { $get_full_service_state->($service) };
    if (my $err = $@) {
        return $res;
    }
    my $state = $ss->{SubState} || 'unknown';
    if ($state eq 'dead' && $ss->{Type} && $ss->{Type} eq 'oneshot' && $ss->{Result}) {
        $res->{state} = $ss->{Result};
    } else {
        $res->{state} = $ss->{SubState} || 'unknown';
    }

    if ($ss->{LoadState} eq 'not-found') {
        $res->{'unit-state'} = 'not-found'; # not installed
    } else {
        $res->{'unit-state'} = $ss->{UnitFileState} || 'unknown';
    }
    $res->{'active-state'} = $ss->{ActiveState} || 'unknown';

    return $res;
};

my $service_state_api_return_schema = {
    'active-state' => {
        type => 'string',
        enum => [
            qw(active inactive failed activating deactivating maintenance reloading refreshing unknown)
        ],
        description => 'Current state of the service process (systemd ActiveState).',
    },
    'desc' => {
        type => 'string',
        description => 'Description of the service.',
    },
    'name' => {
        type => 'string',
        description => 'Short identifier for the service (e.g., "pveproxy").',
    },
    'service' => {
        type => 'string',
        description => 'Systemd unit name (e.g., pveproxy).',
    },
    'state' => {
        type => 'string',
        # all systemd service unit substates
        enum => [qw(
            dead
            condition
            start-pre
            start
            start-post
            running
            exited
            reload
            reload-signal
            reload-notify
            mounting
            stop
            stop-watchdog
            stop-sigterm
            stop-sigkill
            stop-post
            final-watchdog
            final-sigterm
            final-sigkill
            failed
            dead-before-auto-restart
            failed-before-auto-restart
            dead-resources-pinned
            auto-restart
            auto-restart-queued
            cleaning
            unknown
        )],
        description => 'Execution status of the service (systemd SubState).',
    },
    'unit-state' => {
        type => 'string',
        enum => [qw(
            enabled
            enabled-runtime
            linked
            linked-runtime
            alias
            masked
            masked-runtime
            static
            disabled
            indirect
            generated
            transient
            bad not-found
            unknown
        )],
        description => 'Whether the service is enabled (systemd UnitFileState).',
    },
};

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Audit']],
    },
    description => "Service list.",
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => $service_state_api_return_schema,
        },
        links => [{ rel => 'child', href => "{service}" }],
    },
    code => sub {
        my ($param) = @_;

        my $service_list = get_service_list();

        my $res = [];
        for my $id (sort keys %{$service_list}) {
            my $state = $service_state->($id);
            push @$res,
                {
                    service => $id,
                    name => $service_list->{$id}->{name},
                    desc => $service_list->{$id}->{desc},
                    %$state,
                };
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'srvcmdidx',
    path => '{service}',
    method => 'GET',
    description => "Directory index",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => $service_prop_desc,
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {
                subdir => { type => 'string' },
            },
        },
        links => [{ rel => 'child', href => "{subdir}" }],
    },
    code => sub {
        my ($param) = @_;

        my $res = [
            { subdir => 'state' },
            { subdir => 'start' },
            { subdir => 'stop' },
            { subdir => 'restart' },
            { subdir => 'reload' },
        ];

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'service_state',
    path => '{service}/state',
    method => 'GET',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Audit']],
    },
    description => "Read service properties",
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => $service_prop_desc,
        },
    },
    returns => {
        type => "object",
        properties => $service_state_api_return_schema,
    },
    code => sub {
        my ($param) = @_;

        my $id = $param->{service};

        my $service_list = get_service_list();

        my $si = $service_list->{$id};

        my $state = $service_state->($id);

        return {
            service => $param->{service},
            name => $si->{name},
            desc => $si->{desc},
            %$state,
        };
    },
});

__PACKAGE__->register_method({
    name => 'service_start',
    path => '{service}/start',
    method => 'POST',
    description => "Start service.",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => $service_prop_desc,
        },
    },
    returns => {
        type => 'string',
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $user = $rpcenv->get_user();

        my $realcmd = sub {
            my $upid = shift;

            syslog('info', "starting service $param->{service}: $upid\n");

            $service_cmd->($param->{service}, 'start');

        };

        return $rpcenv->fork_worker('srvstart', $param->{service}, $user, $realcmd);
    },
});

__PACKAGE__->register_method({
    name => 'service_stop',
    path => '{service}/stop',
    method => 'POST',
    description => "Stop service.",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => $service_prop_desc,
        },
    },
    returns => {
        type => 'string',
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $user = $rpcenv->get_user();

        my $realcmd = sub {
            my $upid = shift;

            syslog('info', "stopping service $param->{service}: $upid\n");

            $service_cmd->($param->{service}, 'stop');

        };

        return $rpcenv->fork_worker('srvstop', $param->{service}, $user, $realcmd);
    },
});

__PACKAGE__->register_method({
    name => 'service_restart',
    path => '{service}/restart',
    method => 'POST',
    description => "Hard restart service. Use reload if you want to reduce interruptions.",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => $service_prop_desc,
        },
    },
    returns => {
        type => 'string',
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $realcmd = sub {
            my $upid = shift;
            syslog('info', "re-starting service $param->{service}: $upid\n");

            $service_cmd->($param->{service}, 'restart');
        };

        return $rpcenv->fork_worker('srvrestart', $param->{service}, $user, $realcmd);
    },
});

__PACKAGE__->register_method({
    name => 'service_reload',
    path => '{service}/reload',
    method => 'POST',
    description => "Reload service. Falls back to restart if service cannot be reloaded.",
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    proxyto => 'node',
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            service => $service_prop_desc,
        },
    },
    returns => {
        type => 'string',
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $realcmd = sub {
            my $upid = shift;
            syslog('info', "reloading service $param->{service}: $upid\n");

            $service_cmd->($param->{service}, 'try-reload-or-restart');

        };

        return $rpcenv->fork_worker('srvreload', $param->{service}, $user, $realcmd);
    },
});
