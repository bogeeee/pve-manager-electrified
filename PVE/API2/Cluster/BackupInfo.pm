package PVE::API2::Cluster::BackupInfo;

use strict;
use warnings;
use Digest::SHA;

use PVE::SafeSyslog;
use PVE::Tools qw(extract_param);
use PVE::Cluster qw(cfs_lock_file cfs_read_file cfs_write_file);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::JSONSchema;
use PVE::Storage;
use PVE::Exception qw(raise_param_exc);
use PVE::VZDump;
use PVE::VZDump::Common;

use base qw(PVE::RESTHandler);

sub get_included_vmids {
    my $legacy_vzdump_job_cfg = cfs_read_file('vzdump.cron');
    my $legacy_jobs = $legacy_vzdump_job_cfg->{jobs} || [];

    my $jobs = cfs_read_file('jobs.cfg');

    my $all_vmids = {};
    for my $job ($legacy_jobs->@*, grep { $_->{type} eq 'vzdump' } values $jobs->{ids}->%*) {
        my $job_included_guests = PVE::VZDump::get_included_guests($job);
        $all_vmids->{$_} = 1 for map { $_->@* } values %{$job_included_guests};
    }

    return $all_vmids;
}

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Index for backup info related endpoints",
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        description => 'Directory index.',
        items => {
            type => "object",
            properties => {
                subdir => {
                    type => 'string',
                    description => 'API sub-directory endpoint',
                },
            },
        },
        links => [{ rel => 'child', href => "{subdir}" }],
    },
    code => sub {
        return [
            { subdir => 'not-backed-up' },
        ];
    },
});

__PACKAGE__->register_method({
    name => 'get_guests_not_in_backup',
    path => 'not-backed-up',
    method => 'GET',
    protected => 1,
    description => "Shows all guests which are not covered by any backup job.",
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'array',
        description => 'Contains the guest objects.',
        items => {
            type => 'object',
            properties => {
                vmid => {
                    type => 'integer',
                    description => 'VMID of the guest.',
                },
                name => {
                    type => 'string',
                    description => 'Name of the guest',
                    optional => 1,
                },
                type => {
                    type => 'string',
                    description => 'Type of the guest.',
                    enum => ['qemu', 'lxc'],
                },
            },
        },
    },
    code => sub {
        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $included_vmids = get_included_vmids();
        my $vmlist = PVE::Cluster::get_vmlist();

        # remove VMIDs to which the user has no permission to not leak infos like the guest name
        my @allowed_vmids =
            grep { $rpcenv->check($user, "/vms/$_", ['VM.Audit'], 1) } keys $vmlist->{ids}->%*;

        my $result = [];
        for my $vmid (@allowed_vmids) {
            next if $included_vmids->{$vmid};

            my ($type, $node) = $vmlist->{ids}->{$vmid}->@{ 'type', 'node' };

            my ($conf, $name);
            if ($type eq 'qemu') {
                $conf = PVE::QemuConfig->load_config($vmid, $node);
                $name = $conf->{name};
            } elsif ($type eq 'lxc') {
                $conf = PVE::LXC::Config->load_config($vmid, $node);
                $name = $conf->{hostname};
            } else {
                die
                    "Unexpected error: unknown guest type for VMID $vmid, neither QEMU nor LXC\n";
            }

            my $entry = {
                vmid => int($vmid),
                type => $type,
            };
            $entry->{name} = $name if defined($name);

            push @{$result}, $entry;
        }

        return $result;
    },
});

1;
