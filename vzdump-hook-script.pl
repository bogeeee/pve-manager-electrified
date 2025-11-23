#!/usr/bin/perl -w

# Example hook script for vzdump (--script option)
# This can also be added as a line in /etc/vzdump.conf
# e.g. 'script: /usr/local/bin/vzdump-hook-script.pl'

use strict;

print "HOOK: " . join(' ', @ARGV) . "\n";

my $phase = shift;

if (
    $phase eq 'job-init'
    || $phase eq 'job-start'
    || $phase eq 'job-end'
    || $phase eq 'job-abort'
) {

    # undef for Proxmox Backup Server storages
    # undef in phase 'job-init' except when --dumpdir is used directly
    my $dumpdir = $ENV{DUMPDIR};

    # undef when --dumpdir is used directly
    my $storeid = $ENV{STOREID};

    print "HOOK-ENV: ";
    print "dumpdir=$dumpdir;" if defined($dumpdir);
    print "storeid=$storeid;" if defined($storeid);
    print "\n";

    # example: wake up remote storage node and enable storage
    if ($phase eq 'job-init') {
        #system("wakeonlan AA:BB:CC:DD:EE:FF");
        #sleep(30);
        #system ("/sbin/pvesm set $storeid --disable 0") == 0 ||
        #    die "enabling storage $storeid failed";
    }

    # do what you want

} elsif (
    $phase eq 'backup-start'
    || $phase eq 'backup-end'
    || $phase eq 'backup-abort'
    || $phase eq 'log-end'
    || $phase eq 'pre-stop'
    || $phase eq 'pre-restart'
    || $phase eq 'post-restart'
) {

    my $mode = shift; # stop/suspend/snapshot

    my $vmid = shift;

    my $vmtype = $ENV{VMTYPE}; # lxc/qemu

    # undef for Proxmox Backup Server storages
    my $dumpdir = $ENV{DUMPDIR};

    # undef when --dumpdir is used directly
    my $storeid = $ENV{STOREID};

    my $hostname = $ENV{HOSTNAME};

    # target is only available in phase 'backup-end'
    my $target = $ENV{TARGET};

    # logfile is only available in phase 'log-end'
    # undef for Proxmox Backup Server storages
    my $logfile = $ENV{LOGFILE};

    print "HOOK-ENV: ";
    for my $var (qw(vmtype dumpdir storeid hostname target logfile)) {
        print "$var=$ENV{uc($var)};" if defined($ENV{ uc($var) });
    }
    print "\n";

    # example: copy resulting backup file to another host using scp
    if ($phase eq 'backup-end') {
        #system ("scp $target backup-host:/backup-dir") == 0 ||
        #    die "copy tar file to backup-host failed";
    }

    # example: copy resulting log file to another host using scp
    if ($phase eq 'log-end') {
        #system ("scp $logfile backup-host:/backup-dir") == 0 ||
        #    die "copy log file to backup-host failed";
    }

} else {

    die "got unknown phase '$phase'";

}

exit(0);
