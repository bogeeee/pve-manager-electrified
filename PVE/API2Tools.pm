package PVE::API2Tools;

use strict;
use warnings;

use Digest::MD5 qw(md5_hex);
use File::stat;
use Net::IP;
use URI::Escape;
use URI;

use PVE::Cluster;
use PVE::DataCenterConfig; # so we can cfs-read datacenter.cfg
use PVE::Exception qw(raise_param_exc);
use PVE::INotify;
use PVE::RPCEnvironment;
use PVE::SafeSyslog;
use PVE::Storage::Plugin;
use PVE::Tools;

my $hwaddress;
my $hwaddress_st = {};

sub get_hwaddress {
    my $fn = '/etc/ssh/ssh_host_rsa_key.pub';
    my $st = stat($fn);

    if (
        defined($hwaddress)
        && $hwaddress_st->{mtime} == $st->mtime
        && $hwaddress_st->{ino} == $st->ino
        && $hwaddress_st->{dev} == $st->dev
    ) {
        return $hwaddress;
    }

    my $sshkey = PVE::Tools::file_get_contents($fn);
    $hwaddress = uc(md5_hex($sshkey));
    $hwaddress_st->@{ 'mtime', 'ino', 'dev' } = ($st->mtime, $st->ino, $st->dev);

    return $hwaddress;
}

# each rrd key for a resource will only exist once. The key format might be different though. Therefore return on first hit
sub get_rrd_key {
    my ($rrd, $type, $id) = @_;

    my $key = "pve-${type}-9.0/${id}";
    if (defined($rrd->{$key})) {
        return $key;
    }

    # check for old formats: pve2-{type}/{id}. For VMs and CTs the version number is different than for nodes and storages
    if ($type ne "vm" && exists $rrd->{"pve2-${type}/${id}"}) {
        return "pve2-${type}/${id}";
    } elsif ($type eq "vm" && exists $rrd->{"pve2.3-${type}/${id}"}) {
        return "pve2.3-${type}/${id}";
    }
}

sub extract_node_stats {
    my ($node, $members, $rrd, $exclude_stats) = @_;

    my $entry = {
        id => "node/$node",
        node => $node,
        type => "node",
        status => 'unknown',
    };

    my $key = get_rrd_key($rrd, "node", $node);
    if (my $d = $rrd->{$key}) {
        if (
            !$members || # no cluster
            ($members->{$node} && $members->{$node}->{online})
        ) {
            if (!$exclude_stats) {
                $entry->{uptime} = ($d->[0] || 0) + 0;
                $entry->{cpu} = ($d->[5] || 0) + 0;
                $entry->{mem} = ($d->[8] || 0) + 0;
                $entry->{disk} = ($d->[12] || 0) + 0;
            }
            $entry->{status} = 'online';
        }
        $entry->{level} = $d->[1];
        if (!$exclude_stats) {
            $entry->{maxcpu} = ($d->[4] || 0) + 0;
            $entry->{maxmem} = ($d->[7] || 0) + 0;
            $entry->{maxdisk} = ($d->[11] || 0) + 0;
        }
    }

    if (
        $members
        && $members->{$node}
        && !$members->{$node}->{online}
    ) {
        $entry->{status} = 'offline';
    }

    return $entry;
}

sub extract_vm_stats {
    my ($vmid, $data, $rrd) = @_;

    my $entry = {
        id => "$data->{type}/$vmid",
        vmid => $vmid + 0,
        node => $data->{node},
        type => $data->{type},
        status => 'unknown',
    };

    my $d;
    my $key = get_rrd_key($rrd, "vm", $vmid);

    if (my $d = $rrd->{$key}) {

        $entry->{uptime} = ($d->[0] || 0) + 0;
        $entry->{name} = $d->[1];
        $entry->{status} = $d->[2];
        $entry->{template} = $d->[3] + 0;

        $entry->{maxcpu} = ($d->[5] || 0) + 0;
        $entry->{cpu} = ($d->[6] || 0) + 0;
        $entry->{maxmem} = ($d->[7] || 0) + 0;
        $entry->{mem} = ($d->[8] || 0) + 0;
        $entry->{maxdisk} = ($d->[9] || 0) + 0;
        $entry->{disk} = ($d->[10] || 0) + 0;
        $entry->{netin} = ($d->[11] || 0) + 0;
        $entry->{netout} = ($d->[12] || 0) + 0;
        $entry->{diskread} = ($d->[13] || 0) + 0;
        $entry->{diskwrite} = ($d->[14] || 0) + 0;

        if ($key =~ /^pve-vm-/) {
            $entry->{memhost} = ($d->[15] || 0) + 0;
        }
    }

    return $entry;
}

sub extract_storage_stats {
    my ($storeid, $scfg, $node, $rrd) = @_;

    my $content = PVE::Storage::Plugin::content_hash_to_string($scfg->{content});

    my $entry = {
        id => "storage/$node/$storeid",
        storage => $storeid,
        node => $node,
        type => 'storage',
        plugintype => $scfg->{type},
        status => 'unknown',
        shared => $scfg->{shared} || 0,
        content => $content,
    };

    my $key = get_rrd_key($rrd, "storage", "${node}/${storeid}");
    if (my $d = $rrd->{$key}) {
        $entry->{maxdisk} = ($d->[1] || 0) + 0;
        $entry->{disk} = ($d->[2] || 0) + 0;
        $entry->{status} = 'available';
    }

    return $entry;
}

sub parse_http_proxy {
    my ($proxyenv) = @_;

    my $uri = URI->new($proxyenv);

    my $scheme = $uri->scheme;
    my $host = $uri->host;
    my $port = $uri->port || 3128;

    my ($username, $password);

    if (defined(my $p_auth = $uri->userinfo())) {
        ($username, $password) = map URI::Escape::uri_unescape($_), split(":", $p_auth, 2);
    }

    return ("$host:$port", $username, $password);
}

sub run_spiceterm {
    my ($authpath, $permissions, $vmid, $node, $proxy, $title, $shcmd) = @_;

    my $rpcenv = PVE::RPCEnvironment::get();

    my $authuser = $rpcenv->get_user();

    my $nodename = PVE::INotify::nodename();
    my $family = PVE::Tools::get_host_address_family($nodename);
    my $port = PVE::Tools::next_spice_port($family);

    my ($ticket, undef, $remote_viewer_config) =
        PVE::AccessControl::remote_viewer_config($authuser, $vmid, $node, $proxy, $title, $port);

    my $timeout = 40;

    my $cmd = [
        '/usr/bin/spiceterm',
        '--port',
        $port,
        '--addr',
        'localhost',
        '--timeout',
        $timeout,
        '--authpath',
        $authpath,
        '--permissions',
        $permissions,
    ];

    my $dcconf = PVE::Cluster::cfs_read_file('datacenter.cfg');
    push @$cmd, '--keymap', $dcconf->{keyboard} if $dcconf->{keyboard};

    push @$cmd, '--', @$shcmd;

    my $realcmd = sub {
        my $upid = shift;

        syslog('info', "starting spiceterm $upid - $title\n");

        my $cmdstr = join(' ', @$cmd);
        syslog('info', "launch command: $cmdstr");

        eval {
            foreach my $k (keys %ENV) {
                next
                    if $k eq 'PATH'
                    || $k eq 'TERM'
                    || $k eq 'USER'
                    || $k eq 'HOME'
                    || $k eq 'LANG'
                    || $k eq 'LANGUAGE';
                delete $ENV{$k};
            }
            $ENV{PWD} = '/';
            $ENV{SPICE_TICKET} = $ticket;

            PVE::Tools::run_command($cmd, errmsg => 'spiceterm failed\n', keeplocale => 1);
        };
        if (my $err = $@) {
            syslog('err', $err);
        }

        return;
    };

    if ($vmid) {
        $rpcenv->fork_worker('spiceproxy', $vmid, $authuser, $realcmd);
    } else {
        $rpcenv->fork_worker('spiceshell', undef, $authuser, $realcmd);
    }

    PVE::Tools::wait_for_vnc_port($port);

    return $remote_viewer_config;
}

sub resolve_proxyto {
    my ($rpcenv, $proxyto_callback, $proxyto, $uri_param) = @_;

    my $node;
    if ($proxyto_callback) {
        $node = $proxyto_callback->($rpcenv, $proxyto, $uri_param);
        die "internal error - proxyto_callback returned nothing\n"
            if !$node;
    } else {
        $node = $uri_param->{$proxyto};
        raise_param_exc({ $proxyto => "proxyto parameter does not exist" })
            if !$node;
    }
    return $node;
}

sub get_resource_pool_guest_members {
    my ($pool) = @_;

    my $usercfg = PVE::Cluster::cfs_read_file("user.cfg");

    my $vmlist = PVE::Cluster::get_vmlist() || {};
    my $idlist = $vmlist->{ids} || {};

    my $data = $usercfg->{pools}->{$pool};

    die "pool '$pool' does not exist\n" if !$data;

    my $pool_members = [grep { $idlist->{$_} } keys %{ $data->{vms} }];

    return $pool_members;
}

1;
