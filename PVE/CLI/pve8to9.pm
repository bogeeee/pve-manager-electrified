package PVE::CLI::pve8to9;

use strict;
use warnings;

use Cwd ();

use PVE::API2::APT;
use PVE::API2::Ceph;
use PVE::API2::LXC;
use PVE::API2::Qemu;
use PVE::API2::Certificates;
use PVE::API2::Cluster::Ceph;

use PVE::AccessControl;
use PVE::Ceph::Tools;
use PVE::Cluster;
use PVE::Corosync;
use PVE::INotify;
use PVE::Jobs;
use PVE::JSONSchema;
use PVE::Network;
use PVE::NodeConfig;
use PVE::RPCEnvironment;
use PVE::Storage;
use PVE::Storage::Plugin;
use PVE::Tools qw(run_command split_list file_get_contents trim);
use PVE::QemuConfig;
use PVE::QemuServer;
use PVE::QemuServer::Machine;
use PVE::QemuServer::Network;
use PVE::VZDump::Common;
use PVE::LXC;
use PVE::LXC::Config;
use PVE::LXC::Setup;

use Term::ANSIColor;

use PVE::CLIHandler;

use base qw(PVE::CLIHandler);

my $nodename = PVE::INotify::nodename();

my $upgraded = 0; # set in check_pve_packages

my $full_checks = !!0; # set by CLI --full parameter

sub setup_environment {
    PVE::RPCEnvironment->setup_default_cli_env();
}

my $new_suite = 'trixie';
my $old_suite = 'bookworm';
my $older_suites = {
    bullseye => 1,
    buster => 1,
    stretch => 1,
    jessie => 1,
};

my ($min_pve_major, $min_pve_minor, $min_pve_pkgrel) = (8, 4, 0);

my $ceph_release2code = {
    '12' => 'Luminous',
    '13' => 'Mimic',
    '14' => 'Nautilus',
    '15' => 'Octopus',
    '16' => 'Pacific',
    '17' => 'Quincy',
    '18' => 'Reef',
    '19' => 'Squid',
    '20' => 'Tentacle',
};
my $ceph_supported_release = 19; # the version we support for upgrading (i.e., available on both)
my $ceph_supported_code_name = $ceph_release2code->{"$ceph_supported_release"}
    or die "inconsistent source code, could not map expected ceph version to code name!";

my $forced_legacy_cgroup = 0;

my $counters = {
    pass => 0,
    skip => 0,
    notice => 0,
    warn => 0,
    fail => 0,
};

my $level2color = {
    pass => 'green',
    notice => 'bold',
    warn => 'yellow',
    fail => 'bold red',
};

my $log_line = sub {
    my ($level, $line) = @_;

    $counters->{$level}++ if defined($level) && defined($counters->{$level});

    my $color = $level2color->{$level} // '';
    print color($color) if $color && $color ne '';

    print uc($level), ': ' if defined($level);
    print "$line\n";

    print color('reset');
};

sub log_pass { $log_line->('pass', @_); }
sub log_info { $log_line->('info', @_); }
sub log_skip { $log_line->('skip', @_); }
sub log_notice { $log_line->('notice', @_); }
sub log_warn { $log_line->('warn', @_); }
sub log_fail { $log_line->('fail', @_); }

my $print_header_first = 1;

sub print_header {
    my ($h) = @_;
    print "\n" if !$print_header_first;
    print "= $h =\n\n";
    $print_header_first = 0;
}

my $get_systemd_unit_state = sub {
    my ($unit, $suppress_stderr) = @_;

    my $state;
    my $filter_output = sub {
        $state = shift;
        chomp $state;
    };

    my %extra = (outfunc => $filter_output, noerr => 1);
    $extra{errfunc} = sub { }
        if $suppress_stderr;

    eval {
        run_command(['systemctl', 'is-enabled', "$unit"], %extra);
        return if !defined($state) || $state eq 'not-found';
        run_command(['systemctl', 'is-active', "$unit"], %extra);
    };

    return $state // 'unknown';
};
my $log_systemd_unit_state = sub {
    my ($unit, $no_fail_on_inactive) = @_;

    my $log_method = \&log_warn;

    my $state = $get_systemd_unit_state->($unit);
    if ($state eq 'active') {
        $log_method = \&log_pass;
    } elsif ($state eq 'inactive') {
        $log_method = $no_fail_on_inactive ? \&log_warn : \&log_fail;
    } elsif ($state eq 'failed') {
        $log_method = \&log_fail;
    }

    $log_method->("systemd unit '$unit' is in state '$state'");
};

my $versions;
my $get_pkg = sub {
    my ($pkg) = @_;

    $versions = eval { PVE::API2::APT->versions({ node => $nodename }) } if !defined($versions);

    if (!defined($versions)) {
        my $msg = "unable to retrieve package version information";
        $msg .= "- $@" if $@;
        log_fail("$msg");
        return undef;
    }

    my $pkgs = [grep { $_->{Package} eq $pkg } @$versions];
    if (!defined $pkgs || $pkgs == 0) {
        log_fail("unable to determine installed $pkg version.");
        return undef;
    } else {
        return $pkgs->[0];
    }
};

sub check_pve_packages {
    print_header("CHECKING VERSION INFORMATION FOR PVE PACKAGES");

    print "Checking for package updates..\n";
    my $updates = eval { PVE::API2::APT->list_updates({ node => $nodename }); };
    if (!defined($updates)) {
        log_warn("$@") if $@;
        log_fail("unable to retrieve list of package updates!");
    } elsif (@$updates > 0) {
        my $pkgs = join(', ', map { $_->{Package} } @$updates);
        log_warn("updates for the following packages are available:\n  $pkgs");
    } else {
        log_pass("all packages up-to-date");
    }

    print "\nChecking proxmox-ve package version..\n";
    if (defined(my $proxmox_ve = $get_pkg->('proxmox-ve'))) {
        # TODO: update to native version for pve8to9
        my $min_pve_ver = "$min_pve_major.$min_pve_minor-$min_pve_pkgrel";

        my ($maj, $min, $pkgrel) = $proxmox_ve->{OldVersion} =~ m/^(\d+)\.(\d+)[.-](\d+)/;

        if ($maj > $min_pve_major) {
            log_pass("already upgraded to Proxmox VE " . ($min_pve_major + 1));
            $upgraded = 1;
        } elsif ($maj >= $min_pve_major && $min >= $min_pve_minor && $pkgrel >= $min_pve_pkgrel) {
            log_pass("proxmox-ve package has version >= $min_pve_ver");
        } else {
            log_fail("proxmox-ve package is too old, please upgrade to >= $min_pve_ver!");
        }

        # FIXME: better differentiate between 6.14 from bookworm or trixie
        my $kinstalled = 'proxmox-kernel-6.14';
        if (!$upgraded) {
            $kinstalled = 'pve-kernel-6.8';
        }

        my $kernel_version_is_expected = sub {
            my ($version) = @_;

            return $version =~ m/^(?:6\.(?:2|5|8|11|14))/ if !$upgraded;

            if ($version =~ m/^6\.(?:1[4-9]|1\d\d+)[^~]*$/) { # TODO: recheck, or even still needed?
                return 1;
            } elsif ($version =~ m/^(\d+).(\d+)[^~]*-pve$/) {
                return $1 >= 6 && $2 >= 14;
            }
            return 0;
        };

        print "\nChecking running kernel version..\n";
        my $kernel_ver = $proxmox_ve->{RunningKernel};
        if (!defined($kernel_ver)) {
            log_fail("unable to determine running kernel version.");
        } elsif ($kernel_version_is_expected->($kernel_ver)) {
            if ($upgraded) {
                log_pass("running new kernel '$kernel_ver' after upgrade.");
            } else {
                log_pass("running kernel '$kernel_ver' is considered suitable for upgrade.");
            }
        } elsif ($get_pkg->($kinstalled)) {
            # with 6.2 kernel being available in both we might want to fine-tune the check?
            log_warn(
                "a suitable kernel ($kinstalled) is installed, but an unsuitable ($kernel_ver) is booted, missing reboot?!"
            );
        } else {
            log_warn("unexpected running and installed kernel '$kernel_ver'.");
        }

        if ($upgraded && $kernel_version_is_expected->($kernel_ver)) {
            my $outdated_kernel_meta_pkgs = [];
            for my $kernel_meta_version ('6.2', '6.5', '6.8', '6.11') {
                my $pkg = "pve-kernel-${kernel_meta_version}";
                if ($get_pkg->($pkg)) {
                    push @$outdated_kernel_meta_pkgs, $pkg;
                }
            }
            if (scalar(@$outdated_kernel_meta_pkgs) > 0) {
                log_info(
                    "Found outdated kernel meta-packages, taking up extra space on boot partitions.\n"
                        . "      After a successful upgrade, you can remove them using this command:\n"
                        . "      apt remove "
                        . join(' ', $outdated_kernel_meta_pkgs->@*));
            }
        }
    } else {
        log_fail("proxmox-ve package not found!");
    }
}

sub check_rbd_storage_keyring {
    my ($cfg, $dry_run) = @_;

    my $pve_managed = [];
    my $already_good = [];
    my $update = [];

    log_info("Checking whether all external RBD storages have the 'keyring' option configured");

    my ($any_rbd_storage, $any_external_rbd_storage) = (0, 0);
    for my $storeid (sort keys $cfg->{ids}->%*) {
        eval {
            my $scfg = PVE::Storage::storage_config($cfg, $storeid);

            return if $scfg->{type} ne 'rbd'; # return from eval
            $any_rbd_storage = 1;

            if (!defined($scfg->{monhost})) {
                push $pve_managed->@*, $storeid;
                return; # return from eval
            }
            $any_external_rbd_storage = 1;

            my $ceph_storage_keyring = "/etc/pve/priv/ceph/${storeid}.keyring";
            my $ceph_storage_config = "/etc/pve/priv/ceph/${storeid}.conf";

            my $ceph_config = {};

            if (-e $ceph_storage_config) {
                my $content = PVE::Tools::file_get_contents($ceph_storage_config);
                $ceph_config =
                    PVE::CephConfig::parse_ceph_config($ceph_storage_config, $content);

                if (my $keyring_path = $ceph_config->{global}->{keyring}) {
                    if ($keyring_path eq $ceph_storage_keyring) {
                        push $already_good->@*, $storeid;
                    } else {
                        log_warn(
                            "storage $storeid: keyring option configured ($keyring_path), but"
                                . " different from the expected value ($ceph_storage_keyring),"
                                . " check manually!");
                    }

                    return; # return from eval
                }
            }

            if (!-e $ceph_storage_keyring) {
                log_notice("skipping storage $storeid: keyring file $ceph_storage_keyring does"
                    . " not exist");
                return; # return from eval
            }

            if ($dry_run) {
                push $update->@*, $storeid;
                return; # return from eval
            }

            $ceph_config->{global}->{keyring} = $ceph_storage_keyring;

            my $contents =
                PVE::CephConfig::write_ceph_config($ceph_storage_config, $ceph_config);
            PVE::Tools::file_set_contents($ceph_storage_config, $contents, 0600);

            push $update->@*, $storeid;
        };
        my $err = $@;
        if ($err) {
            log_fail("could not ensure that 'keyring' option is set for storage '$storeid': $err");
        }
    }

    if (!$any_rbd_storage) {
        log_skip("No RBD storage configured.");
        return;
    }

    if (scalar($pve_managed->@*)) {
        my $storeid_txt = join(', ', $pve_managed->@*);
        # pass test if there is no external
        if ($any_external_rbd_storage) {
            log_info(
                "The following RBD storages are PVE-managed, nothing to do for them:\n\t$storeid_txt"
            );
        } else {
            log_skip("Only PVE-managed RBD storages are configured, so nothing to do");
        }
    }

    if (scalar($already_good->@*)) {
        my $storeid_txt = join(', ', $already_good->@*);
        log_pass(
            "The following externally managed RBD storages already have the 'keyring' option"
                . " configured correctly:\n\t$storeid_txt");
    }

    if (scalar($update->@*)) {
        my $storeid_txt = join(', ', $update->@*);
        if ($dry_run) {
            log_notice(
                "Starting with PVE 9, externally managed RBD storages require that the 'keyring'"
                    . " option is configured in the storage's Ceph configuration.\nYou can run the"
                    . " following command to automatically set the option:\n\n"
                    . "\t/usr/share/pve-manager/migrations/pve-rbd-storage-configure-keyring\n");
            log_fail(
                "The Ceph configuration of the following externally managed RBD storages needs to"
                    . " be updated:\n\t$storeid_txt");

        } else {
            log_pass(
                "The Ceph configuration of the following externally managed RBD storages has"
                    . " been updated:\n\t$storeid_txt");
        }
    }
}

sub check_storage_health {
    print_header("CHECKING CONFIGURED STORAGES");
    my $cfg = PVE::Storage::config();

    my $ctime = time();

    my $info = PVE::Storage::storage_info($cfg);

    for my $storeid (sort keys %$info) {
        my $d = $info->{$storeid};
        if ($d->{enabled}) {
            if ($d->{active}) {
                log_pass("storage '$storeid' enabled and active.");
            } else {
                log_warn("storage '$storeid' enabled but not active!");
            }
        } else {
            log_skip("storage '$storeid' disabled.");
        }
    }

    check_storage_content();
    eval { check_storage_content_dirs() };
    log_fail("failed to check storage content directories - $@") if $@;

    check_glusterfs_storage_usage();

    check_rbd_storage_keyring($cfg, 1);
}

sub check_cluster_corosync {
    print_header("CHECKING CLUSTER HEALTH/SETTINGS");

    if (!PVE::Corosync::check_conf_exists(1)) {
        log_skip("standalone node.");
        return;
    }

    $log_systemd_unit_state->('pve-cluster.service');
    $log_systemd_unit_state->('corosync.service');

    if (PVE::Cluster::check_cfs_quorum(1)) {
        log_pass("Cluster Filesystem is quorate.");
    } else {
        log_fail("Cluster Filesystem readonly, lost quorum?!");
    }

    my $conf = PVE::Cluster::cfs_read_file('corosync.conf');
    my $conf_nodelist = PVE::Corosync::nodelist($conf);
    my $node_votes = 0;

    print "\nAnalzying quorum settings and state..\n";
    if (!defined($conf_nodelist)) {
        log_fail("unable to retrieve nodelist from corosync.conf");
    } else {
        if (grep { $conf_nodelist->{$_}->{quorum_votes} != 1 } keys %$conf_nodelist) {
            log_warn("non-default quorum_votes distribution detected!");
        } map {
            $node_votes += $conf_nodelist->{$_}->{quorum_votes} // 0
        } keys %$conf_nodelist;
    }

    my ($expected_votes, $total_votes);
    my $filter_output = sub {
        my $line = shift;
        ($expected_votes) = $line =~ /^Expected votes:\s*(\d+)\s*$/
            if !defined($expected_votes);
        ($total_votes) = $line =~ /^Total votes:\s*(\d+)\s*$/
            if !defined($total_votes);
    };
    eval { run_command(['corosync-quorumtool', '-s'], outfunc => $filter_output, noerr => 1); };

    if (!defined($expected_votes)) {
        log_fail("unable to get expected number of votes, assuming 0.");
        $expected_votes = 0;
    }
    if (!defined($total_votes)) {
        log_fail("unable to get expected number of votes, assuming 0.");
        $total_votes = 0;
    }

    my $cfs_nodelist = PVE::Cluster::get_clinfo()->{nodelist};
    my $offline_nodes = grep { $cfs_nodelist->{$_}->{online} != 1 } keys %$cfs_nodelist;
    if ($offline_nodes > 0) {
        log_fail("$offline_nodes nodes are offline!");
    }

    my $qdevice_votes = 0;
    if (my $qdevice_setup = $conf->{main}->{quorum}->{device}) {
        $qdevice_votes = $qdevice_setup->{votes} // 1;
    }

    log_info("configured votes - nodes: $node_votes");
    log_info("configured votes - qdevice: $qdevice_votes");
    log_info("current expected votes: $expected_votes");
    log_info("current total votes: $total_votes");

    log_warn("expected votes set to non-standard value '$expected_votes'.")
        if $expected_votes != $node_votes + $qdevice_votes;
    log_warn("total votes < expected votes: $total_votes/$expected_votes!")
        if $total_votes < $expected_votes;

    my $conf_nodelist_count = scalar(keys %$conf_nodelist);
    my $cfs_nodelist_count = scalar(keys %$cfs_nodelist);
    log_warn("cluster consists of less than three quorum-providing nodes!")
        if $conf_nodelist_count < 3 && $conf_nodelist_count + $qdevice_votes < 3;

    log_fail(
        "corosync.conf ($conf_nodelist_count) and pmxcfs ($cfs_nodelist_count) don't agree about size of nodelist."
    ) if $conf_nodelist_count != $cfs_nodelist_count;

    print "\nChecking nodelist entries..\n";
    my $nodelist_pass = 1;
    for my $cs_node (sort keys %$conf_nodelist) {
        my $entry = $conf_nodelist->{$cs_node};
        if (!defined($entry->{name})) {
            $nodelist_pass = 0;
            log_fail("$cs_node: no name entry in corosync.conf.");
        }
        if (!defined($entry->{nodeid})) {
            $nodelist_pass = 0;
            log_fail("$cs_node: no nodeid configured in corosync.conf.");
        }
        my $gotLinks = 0;
        for my $link (0 .. 7) {
            $gotLinks++ if defined($entry->{"ring${link}_addr"});
        }
        if ($gotLinks <= 0) {
            $nodelist_pass = 0;
            log_fail("$cs_node: no ringX_addr (0 <= X <= 7) link defined in corosync.conf.");
        }

        my $verify_ring_ip = sub {
            my $key = shift;
            if (defined(my $ring = $entry->{$key})) {
                my ($resolved_ip, undef) =
                    PVE::Corosync::resolve_hostname_like_corosync($ring, $conf);
                if (defined($resolved_ip)) {
                    if ($resolved_ip ne $ring) {
                        $nodelist_pass = 0;
                        log_warn("$cs_node: $key '$ring' resolves to '$resolved_ip'.\n"
                            . " Consider replacing it with the currently resolved IP address.");
                    }
                } else {
                    $nodelist_pass = 0;
                    log_fail(
                        "$cs_node: unable to resolve $key '$ring' to an IP address according to Corosync's"
                            . " resolve strategy - cluster will potentially fail with Corosync 3.x/kronosnet!"
                    );
                }
            }
        };
        for my $link (0 .. 7) {
            $verify_ring_ip->("ring${link}_addr");
        }
    }
    log_pass("nodelist settings OK") if $nodelist_pass;

    print "\nChecking totem settings..\n";
    my $totem = $conf->{main}->{totem};
    my $totem_pass = 1;

    my $transport = $totem->{transport};
    if (defined($transport)) {
        if ($transport ne 'knet') {
            $totem_pass = 0;
            log_fail(
                "Corosync transport explicitly set to '$transport' instead of implicit default!");
        }
    }

    # TODO: are those values still up-to-date?
    if (
        (!defined($totem->{secauth}) || $totem->{secauth} ne 'on')
        && (!defined($totem->{crypto_cipher}) || $totem->{crypto_cipher} eq 'none')
    ) {
        $totem_pass = 0;
        log_fail(
            "Corosync authentication/encryption is not explicitly enabled (secauth / crypto_cipher / crypto_hash)!"
        );
    } elsif (defined($totem->{crypto_cipher}) && $totem->{crypto_cipher} eq '3des') {
        $totem_pass = 0;
        log_fail("Corosync encryption cipher set to '3des', no longer supported in Corosync 3.x!")
            ; # FIXME: can be removed?
    }

    log_pass("totem settings OK") if $totem_pass;
    print "\n";
    log_info("run 'pvecm status' to get detailed cluster status..");

    if (defined(my $corosync = $get_pkg->('corosync'))) {
        if ($corosync->{OldVersion} =~ m/^2\./) {
            log_fail("\ncorosync 2.x installed, cluster-wide upgrade to 3.x needed!");
        } elsif ($corosync->{OldVersion} !~ m/^3\./) {
            log_fail("\nunexpected corosync version installed: $corosync->{OldVersion}!");
        }
    }
}

sub check_ceph {
    print_header("CHECKING HYPER-CONVERGED CEPH STATUS");

    if (PVE::Ceph::Tools::check_ceph_inited(1)) {
        log_info("hyper-converged ceph setup detected!");
    } else {
        log_skip("no hyper-converged ceph setup detected!");
        return;
    }

    log_info("getting Ceph status/health information..");
    my $ceph_status = eval { PVE::API2::Ceph->status({ node => $nodename }); };
    my $noout = eval { PVE::API2::Cluster::Ceph->get_flag({ flag => "noout" }); };
    if ($@) {
        log_fail("failed to get 'noout' flag status - $@");
    }

    my $noout_wanted = 1;

    if (!$ceph_status || !$ceph_status->{health}) {
        log_fail("unable to determine Ceph status!");
    } else {
        my $ceph_health = $ceph_status->{health}->{status};
        if (!$ceph_health) {
            log_fail("unable to determine Ceph health!");
        } elsif ($ceph_health eq 'HEALTH_OK') {
            log_pass("Ceph health reported as 'HEALTH_OK'.");
        } elsif (
            $ceph_health eq 'HEALTH_WARN'
            && $noout
            && (keys %{ $ceph_status->{health}->{checks} } == 1)
        ) {
            log_pass(
                "Ceph health reported as 'HEALTH_WARN' with a single failing check and 'noout' flag set."
            );
        } else {
            log_warn(
                "Ceph health reported as '$ceph_health'.\n      Use the PVE dashboard or 'ceph -s'"
                    . " to determine the specific issues and try to resolve them.");
        }
    }

    # TODO: check OSD min-required version, if to low it breaks stuff!

    log_info("checking local Ceph version..");
    if (my $release = eval { PVE::Ceph::Tools::get_local_version(1) }) {
        my $code_name = $ceph_release2code->{"$release"} || 'unknown';
        if ($release == $ceph_supported_release) {
            log_pass(
                "found expected Ceph $ceph_supported_release $ceph_supported_code_name release.");
        } elsif ($release > $ceph_supported_release) {
            log_warn(
                "found newer Ceph release $release $code_name as the expected $ceph_supported_release"
                    . " $ceph_supported_code_name, installed third party repos?!");
        } else {
            log_fail("Hyper-converged Ceph $release $code_name is to old for upgrade!\n"
                . "      Upgrade Ceph first to $ceph_supported_code_name following our how-to:\n"
                . "      <https://pve.proxmox.com/wiki/Category:Ceph_Upgrade>");
        }
    } else {
        log_fail("unable to determine local Ceph version!");
    }

    log_info("getting Ceph daemon versions..");
    my $ceph_versions = eval { PVE::Ceph::Tools::get_cluster_versions(undef, 1); };
    if (!$ceph_versions) {
        log_fail("unable to determine Ceph daemon versions!");
    } else {
        my $services = [
            { 'key' => 'mon', 'name' => 'monitor' },
            { 'key' => 'mgr', 'name' => 'manager' },
            { 'key' => 'mds', 'name' => 'MDS' },
            { 'key' => 'osd', 'name' => 'OSD' },
        ];

        my $ceph_versions_simple = {};
        my $ceph_versions_commits = {};
        for my $type (keys %$ceph_versions) {
            for my $full_version (keys $ceph_versions->{$type}->%*) {
                if ($full_version =~ m/^(.*) \((.*)\).*\(.*\)$/) {
                    # String is in the form of
                    # ceph version 17.2.6 (810db68029296377607028a6c6da1ec06f5a2b27) quincy (stable)
                    # only check the first part, e.g. 'ceph version 17.2.6', the commit hash can
                    # be different
                    $ceph_versions_simple->{$type}->{$1} = 1;
                    $ceph_versions_commits->{$type}->{$2} = 1;
                }
            }
        }

        for my $service (@$services) {
            my ($name, $key) = $service->@{ 'name', 'key' };
            if (my $service_versions = $ceph_versions_simple->{$key}) {
                if (keys %$service_versions == 0) {
                    log_skip("no running instances detected for daemon type $name.");
                } elsif (keys %$service_versions == 1) {
                    log_pass("single running version detected for daemon type $name.");
                } else {
                    log_warn("multiple running versions detected for daemon type $name!");
                }
            } else {
                log_skip("unable to determine versions of running Ceph $name instances.");
            }
            my $service_commits = $ceph_versions_commits->{$key};
            log_info(
                "different builds of same version detected for an $name. Are you in the middle of the upgrade?"
            ) if $service_commits && keys %$service_commits > 1;
        }

        my $overall_versions = $ceph_versions->{overall};
        if (!$overall_versions) {
            log_warn("unable to determine overall Ceph daemon versions!");
        } elsif (keys %$overall_versions == 1) {
            log_pass("single running overall version detected for all Ceph daemon types.");
            $noout_wanted = !$upgraded; # off post-upgrade, on pre-upgrade
        } elsif (keys $ceph_versions_simple->{overall}->%* != 1) {
            log_warn(
                "overall version mismatch detected, check 'ceph versions' output for details!");
        }
    }

    if ($noout) {
        if ($noout_wanted) {
            log_pass("'noout' flag set to prevent rebalancing during cluster-wide upgrades.");
        } else {
            log_warn("'noout' flag set, Ceph cluster upgrade seems finished.");
        }
    } elsif ($noout_wanted) {
        log_warn("'noout' flag not set - recommended to prevent rebalancing during upgrades.");
    }

    log_info("checking Ceph config..");
    my $conf = PVE::Cluster::cfs_read_file('ceph.conf');
    if (%$conf) {
        my $global = $conf->{global};

        my $global_monhost = $global->{mon_host} // $global->{"mon host"} // $global->{"mon-host"};
        if (!defined($global_monhost)) {
            log_warn(
                "No 'mon_host' entry found in ceph config.\n  It's recommended to add mon_host with"
                    . " all monitor addresses (without ports) to the global section.");
        }

        my $ipv6 = $global->{ms_bind_ipv6} // $global->{"ms bind ipv6"}
            // $global->{"ms-bind-ipv6"};
        if ($ipv6) {
            my $ipv4 = $global->{ms_bind_ipv4} // $global->{"ms bind ipv4"}
                // $global->{"ms-bind-ipv4"};
            if ($ipv6 eq 'true' && (!defined($ipv4) || $ipv4 ne 'false')) {
                log_warn(
                    "'ms_bind_ipv6' is enabled but 'ms_bind_ipv4' is not disabled.\n  Make sure to"
                        . " disable 'ms_bind_ipv4' for ipv6 only clusters, or add an ipv4 network to public/cluster network."
                );
            }
        }

        if (defined($global->{keyring})) {
            log_warn(
                "[global] config section contains 'keyring' option, which will prevent services from"
                    . " starting with Nautilus.\n Move 'keyring' option to [client] section instead."
            );
        }

    } else {
        log_warn("Empty ceph config found");
    }

    my $local_ceph_ver = PVE::Ceph::Tools::get_local_version(1);
    if (defined($local_ceph_ver)) {
        if ($local_ceph_ver <= 14) {
            log_fail("local Ceph version too low, at least Octopus required..");
        }
    } else {
        log_fail("unable to determine local Ceph version.");
    }
}

sub check_backup_retention_settings {
    log_info("Checking backup retention settings..");

    my $pass = 1;

    my $maxfiles_msg =
        "parameter 'maxfiles' was deprecated with PVE 7.x and is getting dropped with PVE 9.";

    eval {
        my $confdesc = PVE::VZDump::Common::get_confdesc();
        # vzdump.conf by itself doesn't need to honor any 'requires'
        delete $confdesc->{$_}->{requires} for keys $confdesc->%*;

        my $fn = "/etc/vzdump.conf";
        my $raw = PVE::Tools::file_get_contents($fn);

        my $conf_schema = { type => 'object', properties => $confdesc };
        my $param = PVE::JSONSchema::parse_config($conf_schema, $fn, $raw);

        if (defined($param->{maxfiles})) {
            $pass = 0;
            log_fail("$fn - $maxfiles_msg");
        }
    };
    if (my $err = $@) {
        $pass = 0;
        log_fail("unable to parse node's VZDump configuration - $err");
    }

    my $storage_cfg = PVE::Storage::config();

    for my $storeid (keys $storage_cfg->{ids}->%*) {
        my $scfg = $storage_cfg->{ids}->{$storeid};

        if (defined($scfg->{maxfiles})) {
            $pass = 0;
            log_fail("storage '$storeid' - $maxfiles_msg");
        }
    }

    eval {
        my $vzdump_cron = PVE::Cluster::cfs_read_file('vzdump.cron');

        # only warn once, there might be many jobs...
        if (scalar(grep { defined($_->{maxfiles}) } $vzdump_cron->{jobs}->@*)) {
            $pass = 0;
            log_fail("/etc/pve/vzdump.cron - $maxfiles_msg");
        }
    };
    if (my $err = $@) {
        $pass = 0;
        log_fail("unable to parse node's VZDump configuration - $err");
    }

    log_pass("no backup retention problems found.") if $pass;
}

sub check_cifs_credential_location {
    log_info("checking CIFS credential location..");

    my $regex = qr/^(.*)\.cred$/;

    my $found;

    PVE::Tools::dir_glob_foreach(
        '/etc/pve/priv/',
        $regex,
        sub {
            my ($filename) = @_;

            my ($basename) = $filename =~ $regex;

            log_warn("CIFS credentials '/etc/pve/priv/$filename' will be moved to"
                . " '/etc/pve/priv/storage/$basename.pw' during the update");

            $found = 1;
        },
    );

    log_pass("no CIFS credentials at outdated location found.") if !$found;
}

sub check_custom_pool_roles {
    log_info("Checking permission system changes..");

    if (!-f "/etc/pve/user.cfg") {
        log_skip("user.cfg does not exist");
        return;
    }

    my $raw = eval { PVE::Tools::file_get_contents('/etc/pve/user.cfg'); };
    if ($@) {
        log_fail("Failed to read '/etc/pve/user.cfg' - $@");
        return;
    }

    my $roles = {};
    while ($raw =~ /^\s*(.+?)\s*$/gm) {
        my $line = $1;
        my @data;

        for my $d (split(/:/, $line)) {
            $d =~ s/^\s+//;
            $d =~ s/\s+$//;
            push @data, $d;
        }

        my $et = shift @data;
        if ($et eq 'role') {
            my ($role, $privlist) = @data;
            if (!PVE::AccessControl::verify_rolename($role, 1)) {
                warn "user config - ignore role '$role' - invalid characters in role name\n";
                next;
            }

            $roles->{$role} = {} if !$roles->{$role};
            for my $priv (split_list($privlist)) {
                $roles->{$role}->{$priv} = 1;
            }
        }
    }

    log_info("Checking custom role IDs");
    my ($custom_roles, $need_handling) = (0, 0);
    for my $role (sort keys %{$roles}) {
        next if PVE::AccessControl::role_is_special($role);
        $custom_roles++;

        $need_handling++ if $roles->{$role}->{'VM.Monitor'};
    }
    if ($need_handling > 0) {
        log_notice(
            "Proxmox VE 9 replaced the ambiguously named 'VM.Monitor' privilege with 'Sys.Audit'"
                . " for QEMU HMP monitor access and new dedicated 'VM.GuestAgent.*' privileges"
                . " for access to a VM's guest agent.\n\tThe guest agent sub-privileges are 'Audit'"
                . " for all informational commands, 'FileRead' and 'FileWrite' for file-read and"
                . " file-write, 'FileSystemMgmt' for filesystem freeze, thaw and trim, and"
                . " 'Unrestricted' for everything, including command execution. Operations that"
                . " affect the VM runstate require 'VM.PowerMgmt' or 'VM.GuestAgent.Unrestricted'");
        log_fail(
            "$need_handling custom role(s) use the to-be-dropped 'VM.Monitor' privilege and need"
                . " to be adapted after the upgrade");
    } elsif ($custom_roles > 0) {
        log_pass("none of the $custom_roles custom roles need handling");
    } else {
        log_pass("no custom roles defined");
    }
}

my sub check_qemu_machine_versions {
    log_info("Checking VM configurations for outdated machine versions");

    # QEMU 11.2 is expected to be the last release in Proxmox VE 9, so machine version 6.0 is the
    # smallest that is supported until the end of the Proxmox VE 9 release cycle.
    my @baseline = (6, 0);

    my $old_configured = [];
    my $old_hibernated = [];
    my $old_online_snapshot = {};
    my $old_offline_snapshot = {};

    my $vms = PVE::QemuServer::config_list();
    for my $vmid (sort { $a <=> $b } keys $vms->%*) {
        my $conf = PVE::QemuConfig->load_config($vmid);

        # first, actually configured machine version
        my $machine_type = PVE::QemuServer::Machine::get_vm_machine($conf, undef, $conf->{arch});
        if (
            PVE::QemuServer::Machine::extract_version($machine_type) # no version means latest
            && !PVE::QemuServer::Machine::is_machine_version_at_least($machine_type, @baseline)
        ) {
            push $old_configured->@*, $vmid;
        }

        # second, if hibernated, running machine version
        if ($conf->{vmstate}) {
            my $machine_type = PVE::QemuServer::Machine::get_vm_machine(
                $conf,
                $conf->{runningmachine},
                $conf->{arch},
            );
            if (
                PVE::QemuServer::Machine::extract_version($machine_type) # no version means latest
                && !PVE::QemuServer::Machine::is_machine_version_at_least(
                    $machine_type, @baseline,
                )
            ) {
                push $old_hibernated->@*, $vmid;
            }
        }

        # third, snapshots using old machine versions
        if (defined($conf->{snapshots})) {
            for my $snap (keys $conf->{snapshots}->%*) {
                my $snap_conf = $conf->{snapshots}->{$snap};

                my $machine_type = PVE::QemuServer::Machine::get_vm_machine(
                    $snap_conf,
                    $snap_conf->{runningmachine},
                    $snap_conf->{arch},
                );
                if ( # no version means latest
                    PVE::QemuServer::Machine::extract_version($machine_type)
                    && !PVE::QemuServer::Machine::is_machine_version_at_least(
                        $machine_type, @baseline,
                    )
                ) {
                    if ($snap_conf->{vmstate}) {
                        push $old_online_snapshot->{$vmid}->@*, $snap;
                    } else {
                        push $old_offline_snapshot->{$vmid}->@*, $snap;
                    }
                }
            }
        }
    }

    if (
        !scalar($old_configured->@*)
        && !scalar($old_hibernated->@*)
        && !scalar(keys $old_offline_snapshot->%*)
        && !scalar(keys $old_online_snapshot->%*)
    ) {
        log_pass("All VM machine versions are recent enough");
        return;
    }

    my $basline_txt = join('.', @baseline);
    my $next_pve_major = ($min_pve_major + 1);

    log_notice(
        "QEMU machine versions older than $basline_txt are expected to be dropped during the"
            . " Proxmox VE $next_pve_major release life cycle. For more information, see:\n"
            . "\thttps://pve.proxmox.com/pve-docs/chapter-qm.html#qm_machine_type\n"
            . "\tand https://pve.proxmox.com/wiki/QEMU_Machine_Version_Upgrade");

    if (scalar($old_configured->@*)) {
        my $vmid_list_txt = join(',', $old_configured->@*);
        log_warn(
            "VMs with the following IDs have an old machine version configured. The machine version"
                . " might need to be updated to be able to start the VM in Proxmox VE"
                . " $next_pve_major:\n\t$vmid_list_txt");
    }

    if (scalar($old_hibernated->@*)) {
        my $vmid_list_txt = join(',', $old_hibernated->@*);
        log_warn(
            "VMs with the following IDs are hibernated with an old machine version and it might not"
                . " be possible to resume them in Proxmox VE $next_pve_major:\n\t$vmid_list_txt");
    }

    if (scalar(keys $old_online_snapshot->%*)) {
        my $vmid_txts = [];
        for my $vmid (sort keys $old_online_snapshot->%*) {
            my $snapshot_list_txt = join(',', $old_online_snapshot->{$vmid}->@*);
            push $vmid_txts->@*, "$vmid: $snapshot_list_txt";
        }
        my $vmid_list_txt = join("; ", $vmid_txts->@*);
        log_warn(
            "VMs with the following IDs have live snapshots with an old machine version and it"
                . " might not be possible to rollback to these snapshots in Proxmox VE"
                . " $next_pve_major:\n\t$vmid_list_txt");
    }

    if (scalar(keys $old_offline_snapshot->%*)) {
        my $vmid_txts = [];
        for my $vmid (sort keys $old_offline_snapshot->%*) {
            my $snapshot_list_txt = join(',', $old_offline_snapshot->{$vmid}->@*);
            push $vmid_txts->@*, "$vmid: $snapshot_list_txt";
        }
        my $vmid_list_txt = join("; ", $vmid_txts->@*);
        log_warn(
            "VMs with the following IDs have snapshots with an old machine version configured."
                . " The machine version might need to be updated after rollback to be able to start"
                . " the VM in Proxmox VE $next_pve_major:\n\t$vmid_list_txt");
    }
}

my sub check_max_length {
    my ($raw, $max_length, $warning) = @_;
    log_warn($warning) if defined($raw) && length($raw) > $max_length;
}

sub check_node_and_guest_configurations {
    log_info("Checking node and guest description/note length..");

    my @affected_nodes = grep {
        my $desc = PVE::NodeConfig::load_config($_)->{desc};
        defined($desc) && length($desc) > 64 * 1024
    } PVE::Cluster::get_nodelist();

    if (scalar(@affected_nodes) > 0) {
        log_warn(
            "Node config description of the following nodes too long for new limit of 64 KiB:\n    "
                . join(', ', @affected_nodes));
    } else {
        log_pass("All node config descriptions fit in the new limit of 64 KiB");
    }
}

sub check_storage_content {
    log_info("Checking storage content type configuration..");

    my $found;
    my $pass = 1;

    my $storage_cfg = PVE::Storage::config();

    for my $storeid (sort keys $storage_cfg->{ids}->%*) {
        my $scfg = $storage_cfg->{ids}->{$storeid};

        next if $scfg->{shared};
        next if !PVE::Storage::storage_check_enabled($storage_cfg, $storeid, undef, 1);

        my $valid_content = PVE::Storage::Plugin::valid_content_types($scfg->{type});

        if (scalar(keys $scfg->{content}->%*) == 0 && !$valid_content->{none}) {
            $pass = 0;
            log_fail("storage '$storeid' does not support configured content type 'none'");
            delete $scfg->{content}->{none}; # scan for guest images below
        }

        next if $scfg->{content}->{images};
        next if $scfg->{content}->{rootdir};

        # Skip 'iscsi(direct)' (and foreign plugins with potentially similar behavior) with 'none',
        # because that means "use LUNs directly" and vdisk_list() in PVE 6.x still lists those.
        # It's enough to *not* skip 'dir', because it is the only other storage that supports 'none'
        # and 'images' or 'rootdir', hence being potentially misconfigured.
        next if $scfg->{type} ne 'dir' && $scfg->{content}->{none};

        eval { PVE::Storage::activate_storage($storage_cfg, $storeid) };
        if (my $err = $@) {
            log_warn("activating '$storeid' failed - $err");
            next;
        }

        my $res = eval { PVE::Storage::vdisk_list($storage_cfg, $storeid); };
        if (my $err = $@) {
            log_warn("listing images on '$storeid' failed - $err");
            next;
        }
        my @volids = map { $_->{volid} } $res->{$storeid}->@*;

        my $number = scalar(@volids);
        if ($number > 0) {
            log_info(
                "storage '$storeid' - neither content type 'images' nor 'rootdir' configured, but"
                    . "found $number guest volume(s)");
        }
    }

    my $check_volid = sub {
        my ($volid, $vmid, $vmtype, $reference) = @_;

        my $guesttext = $vmtype eq 'qemu' ? 'VM' : 'CT';
        my $prefix = "$guesttext $vmid - volume '$volid' ($reference)";

        my ($storeid) = PVE::Storage::parse_volume_id($volid, 1);
        return if !defined($storeid);

        my $scfg = $storage_cfg->{ids}->{$storeid};
        if (!$scfg) {
            $pass = 0;
            log_warn("$prefix - storage does not exist!");
            return;
        }

        # cannot use parse_volname for containers, as it can return 'images'
        # but containers cannot have ISO images attached, so assume 'rootdir'
        my $vtype = 'rootdir';
        if ($vmtype eq 'qemu') {
            ($vtype) = eval { PVE::Storage::parse_volname($storage_cfg, $volid); };
            return if $@;
        }

        if (!$scfg->{content}->{$vtype}) {
            $found = 1;
            $pass = 0;
            log_warn("$prefix - storage does not have content type '$vtype' configured.");
        }
    };

    my $cts = PVE::LXC::config_list();
    for my $vmid (sort { $a <=> $b } keys %$cts) {
        my $conf = PVE::LXC::Config->load_config($vmid);

        my $volhash = {};

        my $check = sub {
            my ($ms, $mountpoint, $reference) = @_;

            my $volid = $mountpoint->{volume};
            return if !$volid || $mountpoint->{type} ne 'volume';

            return if $volhash->{$volid}; # volume might be referenced multiple times

            $volhash->{$volid} = 1;

            $check_volid->($volid, $vmid, 'lxc', $reference);
        };

        my $opts = { include_unused => 1 };
        PVE::LXC::Config->foreach_volume_full($conf, $opts, $check, 'in config');
        for my $snapname (keys $conf->{snapshots}->%*) {
            my $snap = $conf->{snapshots}->{$snapname};
            PVE::LXC::Config->foreach_volume_full($snap, $opts, $check, "in snapshot '$snapname'");
        }
    }

    my $vms = PVE::QemuServer::config_list();
    for my $vmid (sort { $a <=> $b } keys %$vms) {
        my $conf = PVE::QemuConfig->load_config($vmid);

        my $volhash = {};

        my $check = sub {
            my ($key, $drive, $reference) = @_;

            my $volid = $drive->{file};
            return if $volid =~ m|^/|;
            return if $volhash->{$volid}; # volume might be referenced multiple times

            $volhash->{$volid} = 1;
            $check_volid->($volid, $vmid, 'qemu', $reference);
        };

        my $opts = {
            extra_keys => ['vmstate'],
            include_unused => 1,
        };
        # startup from a suspended state works even without 'images' content type on the
        # state storage, so do not check 'vmstate' for $conf
        PVE::QemuConfig->foreach_volume_full($conf, { include_unused => 1 }, $check, 'in config');
        for my $snapname (keys $conf->{snapshots}->%*) {
            my $snap = $conf->{snapshots}->{$snapname};
            PVE::QemuConfig->foreach_volume_full($snap, $opts, $check, "in snapshot '$snapname'");
        }
    }

    if ($found) {
        log_warn("Proxmox VE enforces stricter content type checks since 7.0. The guests above "
            . "might not work until the storage configuration is fixed.");
    }

    if ($pass) {
        log_pass("no storage content problems found");
    }
}

sub check_storage_content_dirs {
    my $storage_cfg = PVE::Storage::config();

    # check that content dirs are pairwise inequal
    my $any_problematic = 0;
    for my $storeid (sort keys $storage_cfg->{ids}->%*) {
        my $scfg = $storage_cfg->{ids}->{$storeid};

        next if !PVE::Storage::storage_check_enabled($storage_cfg, $storeid, undef, 1);
        next if !$scfg->{path} || !$scfg->{content};

        eval { PVE::Storage::activate_storage($storage_cfg, $storeid) };
        if (my $err = $@) {
            log_warn("activating '$storeid' failed - $err");
            next;
        }

        my $resolved_subdirs = {};
        my $plugin = PVE::Storage::Plugin->lookup($scfg->{type});
        for my $vtype (keys $scfg->{content}->%*) {
            my $abs_subdir = Cwd::abs_path($plugin->get_subdir($scfg, $vtype));
            next if !defined($abs_subdir);
            push $resolved_subdirs->{$abs_subdir}->@*, $vtype;
        }
        for my $subdir (keys $resolved_subdirs->%*) {
            if (scalar($resolved_subdirs->{$subdir}->@*) > 1) {
                my $types = join(", ", $resolved_subdirs->{$subdir}->@*);
                log_warn(
                    "storage '$storeid' uses directory $subdir for multiple content types ($types)."
                );
                $any_problematic = 1;
            }
        }
    }
    if ($any_problematic) {
        log_fail(
            "reusing directory for multiple content types (see above) is no longer supported in Proxmox VE 8!"
        );
    } else {
        log_pass("no storage reuses a directory for multiple content types.");
    }
}

sub check_containers_cgroup_compat {
    if ($forced_legacy_cgroup) {
        log_fail("System explicitly configured for legacy hybrid cgroup hierarchy.\n"
            . "     NOTE: support for the hybrid cgroup hierarchy is removed in Proxmox VE 9!");
    }

    my $supports_cgroupv2 = sub {
        my ($conf, $rootdir, $ctid) = @_;

        my $ostype = $conf->{ostype};
        if (!defined($ostype)) {
            log_warn("Found CT ($ctid) without 'ostype' set!");
        } elsif ($ostype eq 'devuan' || $ostype eq 'alpine') {
            return 1; # no systemd, no cgroup problems
        }

        my $lxc_setup = PVE::LXC::Setup->new($conf, $rootdir);
        return $lxc_setup->unified_cgroupv2_support();
    };

    my $log_problem = sub {
        my ($ctid) = @_;
        log_fail(
            "Found at least one CT ($ctid) which does not support running in a unified cgroup v2 layout\n"
                . "    You must upgrade the Containers distros! Skipping further CT compat checks."
        );
    };

    my $cts = eval { PVE::API2::LXC->vmlist({ node => $nodename }) };
    if ($@) {
        log_warn("Failed to retrieve information about this node's CTs - $@");
        return;
    }

    if (!defined($cts) || !scalar(@$cts)) {
        log_skip("No containers on node detected.");
        return;
    }

    my @running_cts = sort { $a <=> $b } grep { $_->{status} eq 'running' } @$cts;
    my @offline_cts = sort { $a <=> $b } grep { $_->{status} ne 'running' } @$cts;

    for my $ct (@running_cts) {
        my $ctid = $ct->{vmid};
        my $pid = eval { PVE::LXC::find_lxc_pid($ctid) };
        if (my $err = $@) {
            log_warn("Failed to get PID for running CT $ctid - $err");
            next;
        }
        my $rootdir = "/proc/$pid/root";
        my $conf = PVE::LXC::Config->load_config($ctid);

        my $ret = eval { $supports_cgroupv2->($conf, $rootdir, $ctid) };
        if (my $err = $@) {
            log_warn("Failed to get cgroup support status for CT $ctid - $err");
            next;
        }
        if (!$ret) {
            $log_problem->($ctid);
            return;
        }
    }

    my $storage_cfg = PVE::Storage::config();
    for my $ct (@offline_cts) {
        my $ctid = $ct->{vmid};
        my ($conf, $rootdir, $ret);
        eval {
            $conf = PVE::LXC::Config->load_config($ctid);
            $rootdir = PVE::LXC::mount_all($ctid, $storage_cfg, $conf);
            $ret = $supports_cgroupv2->($conf, $rootdir, $ctid);
        };
        if (my $err = $@) {
            log_warn("Failed to load config and mount CT $ctid - $err");
            eval { PVE::LXC::umount_all($ctid, $storage_cfg, $conf) };
            next;
        }
        if (!$ret) {
            $log_problem->($ctid);
            eval { PVE::LXC::umount_all($ctid, $storage_cfg, $conf) };
            last;
        }

        eval { PVE::LXC::umount_all($ctid, $storage_cfg, $conf) };
    }
}

sub check_lxcfs_fuse_version {
    log_info("Checking if LXCFS is running with FUSE3 library, if already upgraded..");
    if (!$upgraded) {
        log_skip("not yet upgraded, no need to check the FUSE library version LXCFS uses");
        return;
    }

    my $lxcfs_pid = eval { file_get_contents('/run/lxcfs.pid') };
    if (my $err = $@) {
        log_fail("failed to get LXCFS pid - $err");
        return;
    }
    chomp $lxcfs_pid;

    my $lxcfs_maps = eval { file_get_contents("/proc/${lxcfs_pid}/maps") };
    if (my $err = $@) {
        log_fail("failed to get LXCFS maps - $err");
        return;
    }

    if ($lxcfs_maps =~ /\/libfuse.so.2/s) {
        log_warn(
            "systems seems to be upgraded but LXCFS is still running with FUSE 2 library, not yet rebooted?"
        );
    } elsif ($lxcfs_maps =~ /\/libfuse3.so.3/s) {
        log_pass("systems seems to be upgraded and LXCFS is running with FUSE 3 library");
    }
    return;
}

sub check_apt_repos {
    log_info("Checking if the suite for the Debian security repository is correct..");

    my $found = 0;

    my $dir = '/etc/apt/sources.list.d';
    my $in_dir = 0;

    # TODO: check that (original) debian and Proxmox VE mirrors are present.

    my ($found_suite, $found_suite_where);
    my ($mismatches, $strange_suites);

    my ($found_pve_test_repo, $found_legacy_spelled_pve_test_repo) = (0, 0);
    my $found_pve_test_repo_suite;

    my $check_list_file = sub {
        my ($file) = @_;

        $file = "${dir}/${file}" if $in_dir;

        my $raw = eval { PVE::Tools::file_get_contents($file) };
        return if !defined($raw);
        my @lines = split(/\n/, $raw);

        my $number = 0;
        for my $line (@lines) {
            $number++;

            next if length($line) == 0; # split would result in undef then...

            ($line) = split(/#/, $line);

            next if $line !~ m/^deb[[:space:]]/; # is case sensitive

            my ($url, $suite, $component);
            if ($line =~ m|deb\s+(?:\[[^\]]*\]\s+)?(\w+://\S+)\s+(?:(\S+)(?:\s+(\S+))?)?|i) {
                ($url, $suite, $component) = ($1, $2, $3);
            } else {
                next;
            }
            my $where = "in ${file}:${number}";

            if (defined($component)) {
                if ($component =~ /pve-?test/) {
                    $found_pve_test_repo = 1;
                    # just safe one, mismatched suite check will handle multiple different ones already
                    $found_pve_test_repo_suite = $suite;
                    $found_legacy_spelled_pve_test_repo = 1 if $component eq 'pvetest';
                }
            }

            $suite =~ s/-(?:(?:proposed-)?updates|backports|debug|security)(?:-debug)?$//;
            if ($suite ne $old_suite && $suite ne $new_suite && !$older_suites->{$suite}) {
                push $strange_suites->@*, { suite => $suite, where => $where };
                next;
            }

            if (!defined($found_suite)) {
                $found_suite = $suite;
                $found_suite_where = $where;
            } elsif ($suite ne $found_suite) {
                if (!defined($mismatches)) {
                    $mismatches = [];
                    push $mismatches->@*,
                        { suite => $found_suite, where => $found_suite_where },
                        { suite => $suite, where => $where };
                } else {
                    push $mismatches->@*, { suite => $suite, where => $where };
                }
            }
        }
    };

    $check_list_file->("/etc/apt/sources.list");

    $in_dir = 1;

    PVE::Tools::dir_glob_foreach($dir, '^.*\.list$', $check_list_file);

    if ($strange_suites) {
        my @strange_list = map { "found suite $_->{suite} at $_->{where}" } $strange_suites->@*;
        log_notice(
            "found unusual suites that are neither old '$old_suite' nor new '$new_suite':"
                . "\n    "
                . join("\n    ", @strange_list)
                . "\n  Please ensure these repositories are shipping compatible packages for the upgrade!"
        );
    }
    if (defined($mismatches)) {
        my @mismatch_list = map { "found suite $_->{suite} at $_->{where}" } $mismatches->@*;

        log_fail(
            "Found mixed old and new package repository suites, fix before upgrading! Mismatches:"
                . "\n    "
                . join("\n    ", @mismatch_list)
                . "\n  Configure the same base-suite for all Proxmox and Debian provided repos and ask"
                . " original vendor for any third-party repos."
                . "\n  E.g., for the upgrade to Proxmox VE "
                . ($min_pve_major + 1)
                . " use the '$new_suite' suite.");
    } elsif (defined($strange_suites)) {
        log_notice("found no suite mismatches, but found at least one strange suite");
    } else {
        log_pass("found no suite mismatch");
    }

    if ($found_pve_test_repo) {
        log_info(
            "Found test repo for Proxmox VE, checking compatibility with updated 'pve-test' spelling."
        );
        if ($found_legacy_spelled_pve_test_repo) {
            my $_log = $found_pve_test_repo_suite eq $new_suite ? \&log_fail : \&log_warn;
            $_log->(
                "Found legacy spelling 'pvetest' of the pve-test repo. Change the repo to use"
                    . " 'pve-test' when updating the repos to the '$new_suite' suite for Proxmox VE 9!"
            );
        } elsif ($found_pve_test_repo_suite eq $new_suite) {
            log_pass(
                "Found modern spelling 'pve-test' of the pve-test repo for new suite '$new_suite'."
            );
        } elsif ($found_pve_test_repo_suite eq $old_suite) {
            log_fail(
                "Found modern spelling 'pve-test' but old suite '$old_suite', did you forgot to update the suite?"
            );
        } else {
            # TODO: remove the whole check with PVE 10, one cannot really update to latest 9.4 with
            # an old test repo anyway
            log_fail(
                "Found modern spelling 'pve-test' but unexpected suite '$found_pve_test_repo_suite'"
            );
        }
    }
}

sub check_nvidia_vgpu_service {
    log_info("Checking for existence of NVIDIA vGPU Manager..");

    my $msg = "NVIDIA vGPU Service found, possibly not compatible with newer kernel versions, check"
        . " with their documentation and https://pve.proxmox.com/wiki/Upgrade_from_7_to_8#Known_upgrade_issues.";

    my $state = $get_systemd_unit_state->("nvidia-vgpu-mgr.service", 1);
    if ($state && $state eq 'active') {
        log_warn("Running $msg");
    } elsif ($state && $state ne 'unknown' && $state ne 'not-found') {
        log_warn($msg);
    } else {
        log_pass("No NVIDIA vGPU Service found.");
    }
}

sub check_time_sync {
    my $unit_active =
        sub { return $get_systemd_unit_state->($_[0], 1) eq 'active' ? $_[0] : undef };

    log_info("Checking for supported & active NTP service..");
    if ($unit_active->('systemd-timesyncd.service')) {
        log_warn(
            "systemd-timesyncd is not the best choice for time-keeping on servers, due to only applying"
                . " updates on boot.\n  While not necessary for the upgrade it's recommended to use one of:\n"
                . "    * chrony (Default in new Proxmox VE installations)\n    * ntpsec\n    * openntpd\n"
        );
    } elsif ($unit_active->('ntp.service')) {
        log_info("Debian deprecated and removed the ntp package for Bookworm, but the system"
            . " will automatically migrate to the 'ntpsec' replacement package on upgrade.");
    } elsif (
        my $active_ntp = (
            $unit_active->('chrony.service')
                || $unit_active->('openntpd.service')
                || $unit_active->('ntpsec.service')
        )
    ) {
        log_pass("Detected active time synchronisation unit '$active_ntp'");
    } else {
        log_warn(
            "No (active) time synchronisation daemon (NTP) detected, but synchronized systems are important,"
                . " especially for cluster and/or ceph!");
    }
}

sub check_bootloader {
    log_info("Checking bootloader configuration...");

    my $sd_boot_installed = -f "/usr/share/doc/systemd-boot/changelog.Debian.gz";

    if (!-d '/sys/firmware/efi') {
        if ($sd_boot_installed) {
            log_warn(
                "systemd-boot package installed on legacy-boot system is not necessary, consider removing it"
            );
            return;
        }
        log_skip("System booted in legacy-mode - no need for additional packages");
        return;
    }

    my $boot_ok = 1;
    if (-f "/etc/kernel/proxmox-boot-uuids") {
        if (!$upgraded) {
            my $sd_boot_used = 0;
            eval {
                run_command(
                    ['proxmox-boot-tool', 'status'],
                    outfunc => sub {
                        my ($line) = @_;
                        if ($line =~ m#configured with:.* (uefi|systemd-boot) \(versions:#) {
                            $sd_boot_used = 1;
                        }
                    },
                    errfunc => sub { },
                    noerr => 1,
                );
            };

            if ($sd_boot_used) {
                log_skip("not yet upgraded, systemd-boot still needed for bootctl");
                return;
            }
        }
    } else {
        if (!-f "/usr/share/doc/grub-efi-amd64/changelog.Debian.gz") {
            log_warn("System booted in uefi mode but grub-efi-amd64 meta-package not installed,"
                . " new grub versions will not be installed to /boot/efi! Install grub-efi-amd64."
            );
            $boot_ok = 0;
        }
        if (-f "/boot/efi/EFI/BOOT/BOOTX64.efi") {
            my $update_removable_missing = 1;
            my $exit_code = eval {
                run_command(
                    ['debconf-show', '--db', 'configdb', 'grub-efi-amd64', 'grub-pc'],
                    outfunc => sub {
                        my ($line) = @_;
                        if ($line =~ m|grub2/force_efi_extra_removable: +true$|) {
                            $update_removable_missing = 0;
                        }
                    },
                    noerr => 1,
                );
            };
            if ($update_removable_missing) {
                log_warn(
                    "Removable bootloader found at '/boot/efi/EFI/BOOT/BOOTX64.efi', but GRUB packages"
                        . " not set up to update it!\nRun the following command:\n"
                        . "echo 'grub-efi-amd64 grub2/force_efi_extra_removable boolean true' | debconf-set-selections -v -u\n"
                        . "Then reinstall GRUB with 'apt install --reinstall grub-efi-amd64'");
                $boot_ok = 0;
            }
        }
    }
    if ($sd_boot_installed) {
        log_fail(
            "systemd-boot meta-package installed. This will cause problems on upgrades of other"
                . " boot-related packages. Remove 'systemd-boot' See"
                . " https://pve.proxmox.com/wiki/Upgrade_from_8_to_9#sd-boot-warning for more information."
        );
        $boot_ok = 0;
    }
    if ($boot_ok) {
        log_pass("bootloader packages installed correctly");
        return;
    }
}

sub check_dkms_modules {
    log_info("Check for dkms modules...");

    my $count;
    my $set_count = sub {
        $count = scalar @_;
    };

    my $sig_pipe = $SIG{PIPE};
    $SIG{PIPE} = "DEFAULT";
    my $exit_code = eval {
        run_command(['dkms', 'status', '-k', '`uname -r`'], outfunc => $set_count, noerr => 1);
    };
    $SIG{PIPE} = $sig_pipe;

    if ($exit_code != 0) {
        log_skip("could not get dkms status");
    } elsif (!$count) {
        log_pass("no dkms modules found");
    } else {
        log_warn("dkms modules found, this might cause issues during upgrade.");
    }
}

sub check_legacy_notification_sections {
    log_info("Check for legacy 'filter' or 'group' sections in /etc/pve/notifications.cfg...");

    my $raw = eval { PVE::Tools::file_get_contents("/etc/pve/notifications.cfg") };
    return if !defined($raw);

    my $failed = 0;
    my @lines = split(/\n/, $raw);

    for my $line (@lines) {
        # Any line in a section config is either a comment (starts with #), a
        # section header (starts with the section type, without any leading
        # space) or is a property indented by whitespace. This means we
        # should be able to reliably detect the legacy sections by just
        # checking the start of the line.

        if ($line =~ /^filter/) {
            $failed = 1;
            log_fail("found legacy 'filter' section: $line");
        }

        if ($line =~ /^group/) {
            $failed = 1;
            log_fail("found legacy 'group' section: $line");
        }
    }

    if ($failed) {
        log_fail("Any modification to the notification configuration via the API or Web UI will"
            . " automatically remove these sections. Alternatively, you can remove the offending"
            . " sections from /etc/pve/notifications.cfg by hand.");
    } else {
        log_pass("No legacy 'filter' or 'group' sections found!");
    }
}

sub check_legacy_backup_job_options {
    log_info(
        "Check for legacy 'notification-policy' or 'notification-target' options in /etc/pve/jobs.cfg..."
    );

    my $job_cfg = PVE::Cluster::cfs_read_file('jobs.cfg');

    my $failed = 0;

    for my $jobid (sort keys $job_cfg->{ids}->%*) {
        my $cfg = $job_cfg->{ids}->{$jobid};

        if (defined($cfg->{'notification-policy'})) {
            $failed = 1;
            log_fail("found legacy 'notification-policy' option for job '$jobid'");
        }

        if (defined($cfg->{'notification-target'})) {
            $failed = 1;
            log_fail("found legacy 'notification-target' option for job '$jobid'");
        }
    }

    if ($failed) {
        log_fail(
            "Changing the backup job configuration via the UI will automatically clear these options."
                . "Alternatively, you can remove the offending options from /etc/pve/jobs.cfg by hand"
        );
    } else {
        log_pass("No legacy 'notification-policy' or 'notification-target' options found!");
    }
}

sub query_autoactivated_lvm_guest_volumes {
    my ($cfg, $storeid, $vgname) = @_;

    my $cmd = [
        '/sbin/lvs',
        '--separator',
        ':',
        '--noheadings',
        '--unbuffered',
        '--options',
        "lv_name,autoactivation",
        $vgname,
    ];

    my $autoactivated_lvs;
    eval {
        run_command(
            $cmd,
            outfunc => sub {
                my $line = shift;
                $line = trim($line);

                my ($name, $autoactivation_flag) = split(':', $line);
                return if !$name;

                $autoactivated_lvs->{$name} = $autoactivation_flag eq 'enabled';
            },
        );
    };
    die "could not list LVM logical volumes: $@\n" if $@;

    my $vollist = PVE::Storage::volume_list($cfg, $storeid);

    my $autoactivated_guest_lvs = [];
    for my $volinfo (@$vollist) {
        my $volname = (PVE::Storage::parse_volume_id($volinfo->{volid}))[1];
        push @$autoactivated_guest_lvs, $volname if $autoactivated_lvs->{$volname};
    }

    return $autoactivated_guest_lvs;
}

sub check_lvm_autoactivation {
    my $cfg = PVE::Storage::config();
    my $storage_info = PVE::Storage::storage_info($cfg);

    log_info("Check for LVM autoactivation settings on LVM and LVM-thin storages...");

    my ($needs_fix, $shared_affected) = (0, 0);

    for my $storeid (sort keys %$storage_info) {
        my $scfg = PVE::Storage::storage_config($cfg, $storeid);
        my $type = $scfg->{type};
        next if $type ne 'lvm' && $type ne 'lvmthin';

        my $vgname = $scfg->{vgname};
        die "unexpected empty VG name (storage '$storeid')\n" if !$vgname;

        my $info = $storage_info->{$storeid};
        if (!$info->{enabled} || !$info->{active}) {
            log_skip("storage '$storeid' ($type) is disabled or inactive");
            next;
        }

        my $autoactivated_guest_lvs =
            query_autoactivated_lvm_guest_volumes($cfg, $storeid, $vgname);
        if (scalar(@$autoactivated_guest_lvs) > 0) {
            log_notice("storage '$storeid' has guest volumes with autoactivation enabled");
            $needs_fix = 1;
            $shared_affected = 1 if $info->{shared};
        } else {
            log_pass("all guest volumes on storage '$storeid' have autoactivation disabled");
        }
    }
    if ($needs_fix) {
        # only warn if shared storages are affected, for local ones this is mostly cosmetic.
        my $_log = $shared_affected ? \&log_warn : \&log_notice;
        my $extra =
            $shared_affected
            ? "Some affected volumes are on shared LVM storages, which has known issues (Bugzilla"
            . " #4997). Disabling autoactivation for those is strongly recommended!"
            : "All volumes with autoactivations reside on local storage, where this normally does"
            . " not cause any issues.";
        $_log->(
            "Starting with PVE 9, autoactivation will be disabled for new LVM/LVM-thin guest"
                . " volumes. This system has some volumes that still have autoactivation enabled. "
                . "$extra\nYou can run the following command to disable autoactivation for existing"
                . " LVM/LVM-thin guest volumes:\n\n"
                . "\t/usr/share/pve-manager/migrations/pve-lvm-disable-autoactivation"
                . "\n");
    } else {
        log_pass("No problematic volumes found.");
    }

    return undef;
}

sub check_lvm_thin_check_options {
    log_info("Checking lvm config for thin_check_options...");

    my $section;
    my $detected;
    my $detect_thin_check_override = sub {
        my $line = shift;
        if ($line =~ m/^(\S+) \{/) {
            $section = $1;
            return;
        }
        if ($line =~ m/thin_check_options/ && $line !~ m/--clear-needs-check-flag/) {
            $detected = 1;
            log_fail(
                "detected override for 'thin_check_options' in '$section' section without"
                    . " '--clear-needs-check-flag' option - add the option to your override (most"
                    . " likely in /etc/lvm/lvm.conf)");
        }
    };
    eval {
        run_command(['lvmconfig'], outfunc => $detect_thin_check_override);
        log_pass("Check for correct thin_check_options passed") if !$detected;
    };
    log_fail("unable to run 'lvmconfig' command - $@") if $@;
}

sub check_glusterfs_storage_usage {
    my $cfg = PVE::Storage::config();
    my $storage_info = PVE::Storage::storage_info($cfg);

    log_info("Check for usage of native GlusterFS storage plugin...");

    my $has_glusterfs_storage = 0;

    for my $storeid (sort keys $storage_info->%*) {
        my $scfg = PVE::Storage::storage_config($cfg, $storeid);

        next if $scfg->{type} ne 'glusterfs';

        $has_glusterfs_storage = 1;
        log_fail("found 'glusterfs' storage '$storeid'");
    }

    if ($has_glusterfs_storage) {
        log_fail("Starting with Proxmox VE 9, native GlusterFS support will end. GlusterFS storage"
            . " will therefore cease to work.\n"
            . "This is because the GlusterFS project is no longer properly maintained.\n\n"
            . "You will therefore have to move all GlusterFS volumes to different storage and then"
            . " remove any configured GlusterFS storage before starting the upgrade.\n\n"
            . "Alternatively, you can manually mount your GlusterFS instances via the 'glusterfs'"
            . " command-line tool and use them as directory storage.");
    } else {
        log_pass("No GlusterFS storage found.");
    }

    return undef;
}

sub check_bridge_mtu {
    log_info("Checking for VirtIO devices that would change their MTU...");

    my $vms = PVE::QemuServer::config_list();

    for my $vmid (sort { $a <=> $b } keys %$vms) {
        my $config = PVE::QemuConfig->load_config($vmid);

        for my $opt (sort keys $config->%*) {
            next if $opt !~ m/^net\d+$/;
            my $net = PVE::QemuServer::Network::parse_net($config->{$opt});

            next if $net->{model} ne 'virtio' || defined($net->{mtu});

            my $bridge_mtu = PVE::Network::read_bridge_mtu($net->{bridge});

            log_notice("network interface $opt of vm $vmid will have its mtu forced to $bridge_mtu")
                if $bridge_mtu != 1500;
        }
    }
}

sub check_rrd_migration {
    if (-e "/var/lib/rrdcached/db/pve-node-9.0") {
        log_info("Check post RRD metrics data format update situation...");

        my $old_files = [];
        my $record_old = sub {
            my $file = shift;
            $file =~ s!^/var/lib/rrdcached/db/!!;
            push @$old_files, $file;
        };
        eval {
            run_command(
                [
                    'find',
                    '/var/lib/rrdcached/db',
                    '-path',
                    '*pve2-*',
                    '-type',
                    'f',
                    '!',
                    '-name',
                    '*.old',
                ],
                outfunc => $record_old,
                noerr => 1,
            );
        };

        if (my $count = scalar($old_files->@*)) {
            my $cutoff = 29; # avoid spamming the check output to much for bigger setups
            if (!$full_checks && $count > $cutoff + 1) {
                splice @$old_files, $cutoff + 1;
                push @$old_files,
                    '... omitted printing ' . ($count - $cutoff) . ' additional files';
            }
            log_info("Found '$count' RRD files using the old format.\n"
                . " These are now only used to display historic data. You can delete them if you do not need that.\n"
            );
        } else {
            log_pass("No old RRD metric files found, normally this means all have been migrated.");
        }
    } else {
        log_info("Check space requirements for RRD format upgrade...");
        # multiplier values taken from KiB sizes of old and new RRD files
        my $rrd_usage_multipliers = {
            'pve2-node' => 18.1,
            'pve2-vm' => 20.2,
            'pve2-storage' => 11.14,
        };

        my $total_size_estimate = 0;
        for my $dir (sort keys $rrd_usage_multipliers->%*) {
            my $dir_size = eval { PVE::Tools::du("/var/lib/rrdcached/db/${dir}") };
            next if !defined($dir_size);
            $total_size_estimate += $dir_size * $rrd_usage_multipliers->{$dir};
        }
        my $estimate_gib = $total_size_estimate / 1024. / 1024 / 1024;
        my $estimate_gib_str = sprintf("%.2f", $estimate_gib);

        my $root_free = PVE::Tools::df('/', 10);
        if ($total_size_estimate >= $root_free->{avail} - 1 << 30) {
            my $free_gib = sprintf("%.3f", $root_free->{avail} / 1024 / 1024 / 1024);

            log_fail("Not enough free space for new RRD format!\n"
                . " With the new format the current RRD files are expected to consume about ${estimate_gib_str} GiB plus 1 GiB of safety."
                . " But there is currently only ${free_gib} GiB space on the root file system available.\n"
            );
        } else {
            my $size_str =
                $estimate_gib > 1.0
                ? "$estimate_gib_str GiB"
                : sprintf("%.2f", $estimate_gib * 1024) . " MiB";
            log_pass(
                "Enough free disk space for increased RRD metric granularity requirements, which is roughly $size_str."
            );
        }
    }
}

sub check_virtual_guests {
    print_header("VIRTUAL GUEST CHECKS");

    if (!$upgraded) {
        log_info("Checking for running guests..");
        my $running_guests = 0;

        my $local_vms = eval { PVE::API2::Qemu->vmlist({ node => $nodename }) };
        log_warn("Failed to retrieve information about this node's VMs - $@") if $@;
        $running_guests += grep { $_->{status} eq 'running' } @$local_vms if defined($local_vms);

        my $local_cts = eval { PVE::API2::LXC->vmlist({ node => $nodename }) };
        log_warn("Failed to retrieve information about this node's CTs - $@") if $@;
        $running_guests += grep { $_->{status} eq 'running' } @$local_cts if defined($local_cts);

        if ($running_guests > 0) {
            log_warn(
                "$running_guests running guest(s) detected - consider migrating or stopping them.");
        } else {
            log_pass("no running guest detected.");
        }
    } else {
        log_skip("Skipping check for running guests - already upgraded.");
    }

    check_lxcfs_fuse_version();

    check_bridge_mtu();

    my $affected_guests_long_desc = [];
    my $affected_cts_cgroup_keys = [];

    my $cts = PVE::LXC::config_list();
    for my $vmid (sort { $a <=> $b } keys %$cts) {
        my $conf = PVE::LXC::Config->load_config($vmid);

        my $desc = $conf->{description};
        push @$affected_guests_long_desc, "CT $vmid" if defined($desc) && length($desc) > 8 * 1024;

        my $lxc_raw_conf = $conf->{lxc};
        push @$affected_cts_cgroup_keys, "CT $vmid"
            if (grep (@$_[0] =~ /^lxc\.cgroup\./, @$lxc_raw_conf));
    }
    my $vms = PVE::QemuServer::config_list();
    for my $vmid (sort { $a <=> $b } keys %$vms) {
        my $desc = PVE::QemuConfig->load_config($vmid)->{description};
        push @$affected_guests_long_desc, "VM $vmid" if defined($desc) && length($desc) > 8 * 1024;
    }
    if (scalar($affected_guests_long_desc->@*) > 0) {
        log_warn(
            "Guest config description of the following virtual-guests too long for new limit of 64 KiB:\n"
                . "    "
                . join(", ", $affected_guests_long_desc->@*));
    } else {
        log_pass("All guest config descriptions fit in the new limit of 8 KiB");
    }

    log_info("Checking container configs for deprecated lxc.cgroup entries");

    if (scalar($affected_cts_cgroup_keys->@*) > 0) {
        if ($forced_legacy_cgroup) {
            log_notice(
                "Found legacy 'lxc.cgroup' keys, but system explicitly configured for legacy hybrid cgroup hierarchy."
            );
        } else {
            log_warn(
                "The following CTs have 'lxc.cgroup' keys configured, which will be ignored in the new default unified cgroupv2:\n"
                    . "    "
                    . join(", ", $affected_cts_cgroup_keys->@*) . "\n"
                    . "    Often it can be enough to change to the new 'lxc.cgroup2' prefix after the upgrade to Proxmox VE 7.x"
            );
        }
    } else {
        log_pass("No legacy 'lxc.cgroup' keys found.");
    }

    check_qemu_machine_versions();
}

my $LEGACY_IPAM_DB = "/etc/pve/priv/ipam.db";
my $NEW_IPAM_DB = "/etc/pve/sdn/pve-ipam-state.json";

my $LEGACY_MAC_DB = "/etc/pve/priv/macs.db";
my $NEW_MAC_DB = "/etc/pve/sdn/mac-cache.json";

sub check_legacy_ipam_files {
    log_info("Checking for IPAM DB files that have not yet been migrated.");

    if (-e $LEGACY_IPAM_DB) {
        if (-e $NEW_IPAM_DB) {
            log_notice("Found leftover legacy IPAM DB file in '$LEGACY_IPAM_DB'.\n"
                . "\tThis file can be deleted AFTER upgrading ALL nodes to PVE 8.4+.");
        } else {
            log_fail("Found IPAM DB file in '$LEGACY_IPAM_DB' that has not been migrated!\n"
                . "\tFile needs to be migrated to '$NEW_IPAM_DB' before upgrading. Updating"
                . " pve-network to the newest version should take care of that!\n"
                . "\tIf you do not use SDN or IPAM (anymore), you can move or delete the file."
            );
        }
    } else {
        log_pass("No legacy IPAM DB found.");
    }

    if (-e $LEGACY_MAC_DB) {
        if (-e $NEW_MAC_DB) {
            log_notice("Found leftover legacy MAC DB file in '$LEGACY_MAC_DB'.\n"
                . "\tThis file can be deleted AFTER upgrading ALL nodes to PVE 8.4+");
        } else {
            log_fail("Found MAC DB file in '$LEGACY_MAC_DB' that has not been migrated!\n"
                . "\tFile needs to be migrated to '$NEW_MAC_DB' before upgrading. Updating"
                . " pve-network to the newest version should take care of that!\n"
                . "\tIf you do not use SDN or IPAM (anymore), you can move or delete the file."
            );
        }
    } else {
        log_pass("No legacy MAC DB found.");
    }
}

sub check_legacy_sysctl_conf {
    my $fn = "/etc/sysctl.conf";
    log_info(
        "Checking if the legacy sysctl file '$fn' needs to be migrated to new '/etc/sysctl.d/' path."
    );
    if (!-f $fn) {
        log_pass("Legacy file '$fn' is not present.");
        return;
    } elsif ($upgraded) {
        log_skip("Legacy file '$fn' is present, but system was already upgraded, ignoring.");
        return;
    }
    my $raw = eval { PVE::Tools::file_get_contents($fn); };
    if ($@) {
        log_fail("Failed to read '$fn' - $@");
        return;
    }

    my @lines = split(/\n/, $raw);
    for my $line (@lines) {
        if ($line !~ /^[\s]*(:?$|[#;].*$)/m) {
            log_warn(
                "Deprecated config '$fn' contains settings - move them to a dedicated file in '/etc/sysctl.d/'."
            );
            return;
        }
    }
    log_pass("Legacy file '$fn' exists but does not contain any settings.");
}

sub check_cpu_microcode_package {
    log_info("Checking if matching CPU microcode package is installed.");

    open(my $CPUINFO_FD, '<', '/proc/cpuinfo') or log_fail("failed to open '/proc/cpuinfo' - $!\n");
    return if !defined($CPUINFO_FD);

    my $vendor_id;
    while (my $line = <$CPUINFO_FD>) {
        if ($line =~ /^vendor_id\s*:\s*(GenuineIntel|AuthenticAMD)/) {
            $vendor_id = $1;
        } elsif ($line eq "") {
            last;
        }
    }
    close($CPUINFO_FD);

    if (!defined($vendor_id)) {
        log_warn("failed to parse CPU vendor ID from '/proc/cpuinfo'");
        return;
    }
    my $microcode_pkg;
    if ($vendor_id eq 'AuthenticAMD') {
        $microcode_pkg = 'amd64-microcode';
    } elsif ($vendor_id eq 'GenuineIntel') {
        $microcode_pkg = 'intel-microcode';
    } else {
        log_warn("unexpected CPU vendor ID '$vendor_id'");
        return;
    }

    if (defined($get_pkg->($microcode_pkg))) {
        log_pass("Found matching CPU microcode package '$microcode_pkg' installed.");
    } else {
        log_warn(
            "The matching CPU microcode package '$microcode_pkg' could not be found! Consider"
                . " installing it to receive the latest security and bug fixes for your CPU.\n"
                . "\tapt install $microcode_pkg");
    }
}

sub check_misc {
    print_header("MISCELLANEOUS CHECKS");
    my $ssh_config = eval { PVE::Tools::file_get_contents('/root/.ssh/config') };
    if (defined($ssh_config)) {
        log_fail("Unsupported SSH Cipher configured for root in /root/.ssh/config: $1")
            if $ssh_config =~ /^Ciphers .*(blowfish|arcfour|3des).*$/m;
    } else {
        log_skip("No SSH config file found.");
    }

    log_info("Checking common daemon services..");
    $log_systemd_unit_state->('pveproxy.service');
    $log_systemd_unit_state->('pvedaemon.service');
    $log_systemd_unit_state->('pvescheduler.service');
    $log_systemd_unit_state->('pvestatd.service');

    check_time_sync();

    if (defined(my $root_free = PVE::Tools::df('/', 10))) {
        if ($root_free->{avail} < 5 * 1000 * 1000 * 1000) {
            log_warn("Less than 5 GB free space on root file system, upgrade may fail.");
        } elsif ($root_free->{avail} < 10 * 1000 * 1000 * 1000) {
            log_notice("Less than 10 GB free space on root file system.");
        }
    }

    log_info("Checking if the local node's hostname '$nodename' is resolvable..");
    my $local_ip = eval { PVE::Network::get_ip_from_hostname($nodename) };
    if ($@) {
        log_warn("Failed to resolve hostname '$nodename' to IP - $@");
    } else {
        log_info("Checking if resolved IP is configured on local node..");
        my $cidr = Net::IP::ip_is_ipv6($local_ip) ? "$local_ip/128" : "$local_ip/32";
        my $configured_ips = PVE::Network::get_local_ip_from_cidr($cidr);
        my $ip_count = scalar(@$configured_ips);

        if ($ip_count <= 0) {
            log_fail("Resolved node IP '$local_ip' not configured or active for '$nodename'");
        } elsif ($ip_count > 1) {
            log_warn("Resolved node IP '$local_ip' active on multiple ($ip_count) interfaces!");
        } else {
            log_pass("Resolved node IP '$local_ip' configured and active on single interface.");
        }
    }

    my $udev_rule_file = "/etc/udev/rules.d/70-persistent-net.rules";
    if (-f $udev_rule_file) {
        log_warn(
            "Old udev rules file '$udev_rule_file' for NIC-pinning found - NICs are likely to be"
                . " renamed with newer systemd version. Replace the file with a custom"
                . " systemd.link file.");
    }

    log_info("Check node certificate's RSA key size");
    my $certs = PVE::API2::Certificates->info({ node => $nodename });
    my $certs_check = {
        'rsaEncryption' => {
            minsize => 2048,
            name => 'RSA',
        },
        'id-ecPublicKey' => {
            minsize => 224,
            name => 'ECC',
        },
    };

    my $certs_check_failed = 0;
    for my $cert (@$certs) {
        my ($type, $size, $fn) = $cert->@{qw(public-key-type public-key-bits filename)};

        if (!defined($type) || !defined($size)) {
            log_warn("'$fn': cannot check certificate, failed to get it's type or size!");
        }

        my $check = $certs_check->{$type};
        if (!defined($check)) {
            log_warn("'$fn': certificate's public key type '$type' unknown!");
            next;
        }

        my $min_size = $check->{minsize};
        my $name = $check->{name};
        if ($size < $min_size) {
            log_fail(
                "'$fn', certificate's $check->{name} public key size is less than $min_size bit for $name"
            );
            $certs_check_failed = 1;
        } else {
            log_pass(
                "Certificate '$fn' passed Debian Busters (and newer) security level for TLS connections ($size >= $min_size $name)"
            );
        }
    }

    check_backup_retention_settings();
    check_cifs_credential_location();
    check_custom_pool_roles();
    check_node_and_guest_configurations();
    check_apt_repos();
    check_nvidia_vgpu_service();
    check_bootloader();
    check_dkms_modules();
    check_legacy_notification_sections();
    check_legacy_backup_job_options();
    check_lvm_autoactivation();
    check_lvm_thin_check_options();
    check_rrd_migration();
    check_legacy_ipam_files();
    check_legacy_sysctl_conf();
    check_cpu_microcode_package();
}

my sub colored_if {
    my ($str, $color, $condition) = @_;
    return "" . ($condition ? colored($str, $color) : $str);
}

__PACKAGE__->register_method({
    name => 'checklist',
    path => 'checklist',
    method => 'GET',
    description => 'Check (pre-/post-)upgrade conditions.',
    parameters => {
        additionalProperties => 0,
        properties => {
            full => {
                description => 'perform additional, expensive checks.',
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        $full_checks = !!$param->{full};

        my $kernel_cli = PVE::Tools::file_get_contents('/proc/cmdline');
        if ($kernel_cli =~ /systemd.unified_cgroup_hierarchy=0/) {
            $forced_legacy_cgroup = 1;
        }

        check_pve_packages();
        check_cluster_corosync();
        check_ceph();
        check_storage_health();
        check_virtual_guests();
        check_misc();

        if ($param->{full}) {
            check_containers_cgroup_compat();
        } else {
            log_skip(
                "NOTE: Expensive checks, like CT cgroupv2 compat, not performed without '--full' parameter"
            );
        }

        print_header("SUMMARY");

        my $total = 0;
        $total += $_ for values %$counters;

        print "TOTAL:    $total\n";
        print colored("PASSED:   $counters->{pass}\n", 'green');
        print "SKIPPED:  $counters->{skip}\n";
        print colored_if("WARNINGS: $counters->{warn}\n", 'yellow', $counters->{warn} > 0);
        print colored_if("FAILURES: $counters->{fail}\n", 'bold red', $counters->{fail} > 0);

        if ($counters->{warn} > 0 || $counters->{fail} > 0) {
            my $color = $counters->{fail} > 0 ? 'bold red' : 'yellow';
            print colored("\nATTENTION: Please check the output for detailed information!\n",
                $color);
            print colored(
                "Try to solve the problems one at a time and then run this checklist tool again.\n",
                $color,
            ) if $counters->{fail} > 0;
        }

        return undef;
    },
});

our $cmddef = [__PACKAGE__, 'checklist', [], {}];

1;
