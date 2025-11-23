package PVE::CertCache;

use strict;
use warnings;

use Net::SSLeay;

use PVE::Cluster;
use PVE::SafeSyslog;

# X509 Certificate cache helper

my $cert_cache_nodes = {};
my $cert_cache_timestamp = time();
my $cert_cache_fingerprints = {};

sub update_cert_cache {
    my ($update_node, $clear) = @_;

    syslog('info', "Clearing outdated entries from certificate cache")
        if $clear;

    $cert_cache_timestamp = time() if !defined($update_node);

    my $node_list = defined($update_node) ? [$update_node] : [keys %$cert_cache_nodes];

    foreach my $node (@$node_list) {
        my $clear_old = sub {
            if (my $old_fp = $cert_cache_nodes->{$node}) {
                # distrust old fingerprint
                delete $cert_cache_fingerprints->{$old_fp};
                # ensure reload on next proxied request
                delete $cert_cache_nodes->{$node};
            }
        };

        my $fp = eval { PVE::Cluster::get_node_fingerprint($node) };
        if (my $err = $@) {
            warn "$err\n";
            &$clear_old() if $clear;
            next;
        }

        my $old_fp = $cert_cache_nodes->{$node};
        $cert_cache_fingerprints->{$fp} = 1;
        $cert_cache_nodes->{$node} = $fp;

        if (defined($old_fp) && $fp ne $old_fp) {
            delete $cert_cache_fingerprints->{$old_fp};
        }
    }
}

# load and cache cert fingerprint once
sub initialize_cert_cache {
    my ($node) = @_;

    update_cert_cache($node)
        if defined($node) && !defined($cert_cache_nodes->{$node});
}

sub check_cert_fingerprint {
    my ($cert) = @_;

    # clear cache every 30 minutes at least
    update_cert_cache(undef, 1) if time() - $cert_cache_timestamp >= 60 * 30;

    # get fingerprint of server certificate
    my $fp = Net::SSLeay::X509_get_fingerprint($cert, 'sha256');
    return 0 if !defined($fp) || $fp eq ''; # error

    my $check = sub {
        for my $expected (keys %$cert_cache_fingerprints) {
            return 1 if $fp eq $expected;
        }
        return 0;
    };

    return 1 if &$check();

    # clear cache and retry at most once every minute
    if (time() - $cert_cache_timestamp >= 60) {
        syslog(
            'info',
            "Could not verify remote node certificate '$fp' with list of pinned certificates, refreshing cache",
        );
        update_cert_cache();
        return &$check();
    }

    return 0;
}

1;
