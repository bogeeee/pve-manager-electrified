package PVE::Report;

use strict;
use warnings;

use PVE::Tools;

# output the content of all the files of a directory
my sub dir2text {
    my ($target_dir, $regexp) = @_;

    print STDERR "dir2text '${target_dir}${regexp}'...";
    my $text = "# output '${target_dir}${regexp}' file(s)\n";
    PVE::Tools::dir_glob_foreach(
        $target_dir,
        $regexp,
        sub {
            my ($file) = @_;
            return if $file eq '.' || $file eq '..';
            $text .= "\n# cat $target_dir$file\n";
            $text .= PVE::Tools::file_get_contents($target_dir . $file) . "\n";
        },
    );
    return $text;
}

# command -v is the posix equivalent of 'which'
my sub cmd_exists { system("command -v '$_[0]' > /dev/null 2>&1") == 0 }

my $init_report_cmds = sub {
    my $report_def = {
        general => {
            title => 'general system info',
            order => 10,
            cmds => [
                'hostname',
                'date -R',
                'cat /proc/cmdline',
                'pveversion --verbose',
                'cat /etc/hosts',
                'pvesubscription get',
                'cat /etc/apt/sources.list',
                sub { dir2text('/etc/apt/sources.list.d/', '.+\.list') },
                sub { dir2text('/etc/apt/sources.list.d/', '.+\.sources') },
                'apt-cache policy | grep -vP "^ +origin "',
                'apt-mark showhold',
                'lscpu',
                'pvesh get /cluster/resources --type node --output-format=yaml',
            ],
        },
        'system-load' => {
            title => 'overall system load info',
            order => 20,
            cmds => [
                'top -b -c -w512 -n 1 -o TIME | head -n 30', 'head /proc/pressure/*',
            ],
        },
        storage => {
            order => 30,
            cmds => [
                'cat /etc/pve/storage.cfg',
                'pvesm status',
                'cat /etc/fstab',
                'findmnt --ascii',
                'df --human -T',
                'proxmox-boot-tool status',
            ],
        },
        'virtual guests' => {
            order => 40,
            cmds => [
                'qm list',
                sub { dir2text('/etc/pve/qemu-server/', '\d+\.conf') },
                'pct list',
                sub { dir2text('/etc/pve/lxc/', '\d+\.conf') },
            ],
        },
        network => {
            order => 45,
            cmds => [
                'ip -details -statistics address',
                'ip -details -4 route show',
                'ip -details -6 route show',
                'cat /etc/network/interfaces',
                sub { dir2text('/etc/network/interfaces.d/', '.*') },
                'cat /etc/pve/sdn/.running-config',
                sub { dir2text('/etc/pve/sdn/', '.+\.cfg') },
                sub { dir2text('/etc/pve/sdn/', '.+\.json') },
            ],
        },
        firewall => {
            order => 50,
            cmds => [
                sub { dir2text('/etc/pve/firewall/', '.+\.fw') },
                'cat /etc/pve/local/host.fw',
                sub { dir2text('/etc/pve/sdn/firewall/', '.+\.fw') },
                'iptables-save -c | column -t -l4 -o" "',
            ],
        },
        cluster => {
            order => 60,
            cmds => [
                'pvecm nodes',
                'pvecm status',
                'cat /etc/pve/corosync.conf 2>/dev/null',
                'ha-manager status',
                'cat /etc/pve/datacenter.cfg',
            ],
        },
        jobs => {
            order => 65,
            cmds => [
                'cat /etc/pve/jobs.cfg',
            ],
        },
        replication => {
            order => 67,
            cmds => [
                'cat /etc/pve/replication.cfg',
            ],
        },
        hardware => {
            order => 70,
            cmds => [
                'dmidecode -t bios', 'lspci -nnk',
            ],
        },
        'block devices' => {
            order => 80,
            cmds => [
                'lsblk --ascii -M -o +HOTPLUG,ROTA,PHY-SEC,FSTYPE,MODEL,TRAN,WWN',
                'ls -l /dev/disk/by-*/',
                'iscsiadm -m node',
                'iscsiadm -m session',
            ],
        },
        volumes => {
            order => 90,
            cmds => [
                'pvs', 'lvs', 'vgs',
            ],
        },
    };

    if (cmd_exists('zfs')) {
        push @{ $report_def->{volumes}->{cmds} },
            'zpool status',
            'zpool list -v',
            'zfs list',
            'arcstat',
            ;
    }

    if (-e '/etc/ceph/ceph.conf') {
        push @{ $report_def->{volumes}->{cmds} },
            'pveceph status',
            'ceph osd status',
            'ceph df',
            'ceph osd df tree',
            'ceph device ls',
            'cat /etc/ceph/ceph.conf',
            'ceph config dump',
            'pveceph pool ls',
            'ceph versions',
            'ceph health detail',
            ;
    }

    if (cmd_exists('multipath')) {
        push @{ $report_def->{disks}->{cmds} },
            'cat /etc/multipath.conf',
            'cat /etc/multipath/wwids',
            'multipath -ll',
            ;
    }

    return $report_def;
};

sub generate {
    my $def = $init_report_cmds->();

    my $report = '';
    my $record_output = sub {
        $report .= shift . "\n";
    };

    local $ENV{'PATH'} = '/sbin:/bin:/usr/sbin:/usr/bin';
    my $cmd_timeout = 10; # generous timeout

    my $run_cmd_params = {
        outfunc => $record_output,
        errfunc => $record_output,
        timeout => $cmd_timeout,
        noerr => 1, # avoid checking programs exit code
    };

    my $sorter =
        sub { ($def->{ $_[0] }->{order} // 1 << 30) <=> ($def->{ $_[1] }->{order} // 1 << 30) };

    for my $section (sort { $sorter->($a, $b) } keys %$def) {
        my $s = $def->{$section};
        my $title = $s->{title} // "info about $section";

        $report .= "\n==== $title ====\n";
        for my $command (@{ $s->{cmds} }) {
            eval {
                if (ref $command eq 'CODE') {
                    $report .= PVE::Tools::run_with_timeout($cmd_timeout, $command);
                } else {
                    print STDERR "Process " . $command . "...";
                    $report .= "\n# $command\n";
                    PVE::Tools::run_command($command, %$run_cmd_params);
                }
                print STDERR "OK";
            };
            print STDERR "\n";
            $report .= "\nERROR: $@\n" if $@;
        }
    }

    return $report;
}

1;
