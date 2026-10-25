package PVE::CLI::pveceph;

use strict;
use warnings;

use AptPkg::Cache;
use Data::Dumper;
use Fcntl ':flock';
use File::Path;
use IO::File;
use JSON;
use LWP::UserAgent;

use Proxmox::RS::Subscription;

use PVE::Cluster;
use PVE::INotify;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RPCEnvironment;
use PVE::SafeSyslog;
use PVE::Storage;
use PVE::Tools qw(run_command);

use PVE::Ceph::Releases;
use PVE::Ceph::Services;
use PVE::Ceph::Tools;

use PVE::API2::Ceph;
use PVE::API2::Ceph::FS;
use PVE::API2::Ceph::MDS;
use PVE::API2::Ceph::MGR;
use PVE::API2::Ceph::MON;
use PVE::API2::Ceph::OSD;
use PVE::API2::Cluster::Ceph;

use base qw(PVE::CLIHandler);

my $nodename = PVE::INotify::nodename();

my $upid_exit = sub {
    my $upid = shift;
    my $status = PVE::Tools::upid_read_status($upid);
    exit(PVE::Tools::upid_status_is_error($status) ? -1 : 0);
};

sub setup_environment {
    PVE::RPCEnvironment->setup_default_cli_env();
}

__PACKAGE__->register_method({
    name => 'purge',
    path => 'purge',
    method => 'POST',
    description => "Destroy ceph related data and configuration files.",
    parameters => {
        additionalProperties => 0,
        properties => {
            logs => {
                description => 'Additionally purge Ceph logs, /var/log/ceph.',
                type => 'boolean',
                optional => 1,
            },
            crash => {
                description => 'Additionally purge Ceph crash logs, /var/lib/ceph/crash.',
                type => 'boolean',
                optional => 1,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $message;
        my $pools = [];
        my $monstat = {};
        my $mdsstat = {};
        my $osdstat = [];

        eval {
            my $rados = PVE::RADOS->new();
            $pools = PVE::Ceph::Tools::ls_pools(undef, $rados);
            $monstat = PVE::Ceph::Services::get_services_info('mon', undef, $rados);
            $mdsstat = PVE::Ceph::Services::get_services_info('mds', undef, $rados);
            $osdstat = $rados->mon_command({ prefix => 'osd metadata' });
        };
        warn "Error gathering ceph info, already purged? Message: $@" if $@;

        my $osd = grep { $_->{hostname} eq $nodename } @$osdstat;
        my $mds = grep { $mdsstat->{$_}->{host} eq $nodename } keys %$mdsstat;
        my $mon = grep { $monstat->{$_}->{host} eq $nodename } keys %$monstat;

        # no pools = no data
        $message .= "- remove pools, this will !!DESTROY DATA!!\n" if @$pools;
        $message .= "- remove active OSD on $nodename\n" if $osd;
        $message .= "- remove active MDS on $nodename\n" if $mds;
        $message .= "- remove other MONs, $nodename is not the last MON\n"
            if scalar(keys %$monstat) > 1 && $mon;

        # display all steps at once
        die "Unable to purge Ceph!\n\nTo continue:\n$message" if $message;

        my $services = PVE::Ceph::Services::get_local_services();
        $services->{mon} = $monstat if $mon;
        $services->{crash}->{$nodename} = { direxists => 1 } if $param->{crash};
        $services->{logs}->{$nodename} = { direxists => 1 } if $param->{logs};

        PVE::Ceph::Tools::purge_all_ceph_services($services);
        PVE::Ceph::Tools::purge_all_ceph_files($services);

        return undef;
    },
});

my sub has_valid_subscription {
    my $info = eval { Proxmox::RS::Subscription::read_subscription('/etc/subscription') } // {};
    warn "couldn't check subscription info - $@" if $@;
    return $info->{status} && $info->{status} eq 'active'; # age check?
}

my $available_ceph_release_codenames = PVE::Ceph::Releases::get_available_ceph_release_codenames(1);
my $default_ceph_version = PVE::Ceph::Releases::get_default_ceph_release_codename();

__PACKAGE__->register_method({
    name => 'install',
    path => 'install',
    method => 'POST',
    description => "Install ceph related packages.",
    parameters => {
        additionalProperties => 0,
        properties => {
            version => {
                type => 'string',
                enum => $available_ceph_release_codenames,
                default => $default_ceph_version,
                description => "Ceph version to install.",
                optional => 1,
            },
            repository => {
                type => 'string',
                enum => ['enterprise', 'no-subscription', 'test', 'manual'],
                default => 'enterprise',
                description => "Ceph repository to use. The 'manual' option will not configure"
                    . " any repositories. Use it if the host cannot access the public repositories,"
                    . " for example if Proxmox Offline Mirror is used. A repository that contains"
                    . " the Ceph packages for the version needs to be manually configured before"
                    . " starting the installation!",
                optional => 1,
            },
            'allow-experimental' => {
                type => 'boolean',
                default => 0,
                optional => 1,
                description => "Allow experimental versions. Use with care!",
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $cephver = $param->{version} || $default_ceph_version;

        my $available_ceph_releases = PVE::Ceph::Releases::get_all_available_ceph_releases();
        die "unsupported ceph version: $cephver"
            if !exists($available_ceph_releases->{$cephver});

        my $experimental_release = !!$available_ceph_releases->{$cephver}->{unsupported};

        my $repo = $param->{'repository'} // 'enterprise';
        my $enterprise_repo = $repo eq 'enterprise';
        my $cdn =
            $enterprise_repo ? 'https://enterprise.proxmox.com' : 'http://download.proxmox.com';

        if ($experimental_release && $enterprise_repo) {
            warn "\nWARN: Enterprise repository selected, but Ceph release is still marked as"
                . " experimental, repository might not (yet) be useable!\n\n";

            if (-t STDOUT) {
                print "Do you want to switch to the test repository (Y/n)? ";
                my $answer = <STDIN> // '';
                chomp $answer;
                if (!$answer || $answer =~ m/^\s*y(?:es)?\s*$/i) {
                    $repo = 'test';
                    $enterprise_repo = 0;
                    $cdn = 'http://download.proxmox.com';
                }
            }
        } elsif (has_valid_subscription()) {
            if (!$enterprise_repo) {
                warn "\nNOTE: The node has an active subscription but a non-production Ceph"
                    . " repository selected.\n\n";
            }
        } elsif ($enterprise_repo) {
            warn "\nWARN: Enterprise repository selected, but no active subscription!\n\n";
        } elsif ($repo eq 'no-subscription') {
            warn "\nHINT: The no-subscription repository is not the best choice for production"
                . " setups.\n"
                . "Proxmox recommends using the enterprise repository with a valid subscription.\n";
        } elsif ($repo eq 'manual') {
            warn "\nHINT: The manual repository option expects that the Ceph repository is"
                . " already correctly configured. For example, when used in combination with"
                . " Proxmox Offline Mirror.\n";
        } else {
            warn "\nWARN: The test repository should only be used for test setups or after"
                . " consulting the official Proxmox support!\n\n";
        }

        my $repo_source = <<"EOF";
Types: deb
URIs: ${cdn}/debian/ceph-${cephver}
Suites: trixie
Components: ${repo}
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF

        my $rendered_release =
            $available_ceph_releases->{$cephver}->{release} . ' ' . ucfirst($cephver);
        if (-t STDOUT && !$param->{version}) {
            print "This will install Ceph ${rendered_release} - continue (y/N)? ";

            my $answer = <STDIN>;
            my $continue = defined($answer) && $answer =~ m/^\s*y(?:es)?\s*$/i;

            die "Aborting installation as requested\n" if !$continue;
        }

        if ($repo ne "manual") {
            PVE::Tools::file_set_contents("/etc/apt/sources.list.d/ceph.sources", $repo_source);

            if ($experimental_release) {
                if ($param->{'allow-experimental'}) {
                    warn
                        "NOTE: installing experimental/tech-preview Ceph release ${rendered_release}!\n";
                } elsif (-t STDOUT) {
                    print "Ceph ${rendered_release} is currently considered a technology"
                        . " preview for Proxmox VE - continue (y/N)? ";
                    my $answer = <STDIN>;
                    my $continue = defined($answer) && $answer =~ m/^\s*y(?:es)?\s*$/i;

                    die "Aborting installation as requested\n" if !$continue;
                } else {
                    die "Refusing to install tech-preview Ceph release ${rendered_release}"
                        . " without 'allow-experimental' parameter!\n";
                }
            }
        }

        local $ENV{DEBIAN_FRONTEND} = 'noninteractive';
        print "update available package list\n";
        eval {
            run_command(
                ['apt-get', '-q', 'update'],
                outfunc => sub { },
                errfunc => sub { print STDERR "$_[0]\n" },
            );
        };

        if ($repo eq "manual") {
            my $apt_cache = AptPkg::Cache->new() || die "unable to initialize AptPkg::Cache\n";
            my $arch = PVE::Tools::get_host_dpkg_arch();
            my @ceph_versions = $apt_cache->{"ceph-common:$arch"}->{'VersionList'}->@*;
            my $latest_available = $ceph_versions[0]->{'VerStr'};
            my $selected_version =
                PVE::Ceph::Releases::get_ceph_release_info($cephver)->{'release'};

            if ($latest_available !~ "^$selected_version") {
                die "Selected Ceph version '${selected_version}' does not match the available"
                    . " version in the repository '${latest_available}' \n";
            }

            my $pkg_infos = $ceph_versions[0]->{'FileList'}->[0]->{'File'};
            print "\nUsing the following manual repository:\n"
                . "Site:\t\t $pkg_infos->{'Site'}\n"
                . "Component:\t $pkg_infos->{'Component'}\n\n";

        }

        my @apt_install =
            qw(apt-get --no-install-recommends -o Dpkg::Options::=--force-confnew install --);
        my @ceph_packages = qw(
            ceph
            ceph-common
            ceph-fuse
            ceph-mds
            ceph-volume
            gdisk
            nvme-cli
        );

        print "start installation\n";

        # this flag helps to determine when apt is actually done installing (vs. partial extracting)
        my $install_flag_fn = PVE::Ceph::Tools::ceph_install_flag_file();
        open(my $install_flag, '>', $install_flag_fn)
            or die "could not create install flag - $!\n";
        close $install_flag;

        if (system(@apt_install, @ceph_packages) != 0) {
            unlink $install_flag_fn or warn "could not remove Ceph installation flag - $!";
            die "apt failed during ceph installation ($?)\n";
        }

        print "\ninstalled Ceph ${rendered_release} successfully!\n";
        # done: drop flag file so that the PVE::Ceph::Tools check returns Ok now.
        unlink $install_flag_fn or warn "could not remove Ceph installation flag - $!";

        print "\nreloading API to load new Ceph RADOS library...\n";
        run_command([
            'systemctl', 'try-reload-or-restart', 'pvedaemon.service', 'pveproxy.service',
        ]);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'status',
    path => 'status',
    method => 'GET',
    description => "Get Ceph Status.",
    parameters => {
        additionalProperties => 0,
    },
    returns => { type => 'null' },
    code => sub {
        PVE::Ceph::Tools::check_ceph_inited();

        run_command(
            ['ceph', '-s'],
            outfunc => sub { print "$_[0]\n" },
            errfunc => sub { print STDERR "$_[0]\n" },
            timeout => 15,
        );
        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'osd-details',
    path => 'osd-details',
    method => 'GET',
    description => "Get OSD details.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            osdid => {
                description => "ID of the OSD",
                type => 'string',
            },
            verbose => {
                description => "Print verbose information, same as json-pretty output format.",
                type => 'boolean',
                default => 0,
                optional => 1,
            },
        },
    },
    returns => { type => 'object' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $res = PVE::API2::Ceph::OSD->osddetails({
            osdid => $param->{osdid},
            node => $param->{node},
        });

        for my $dev ($res->{devices}->@*) {
            $dev->{"lv-info"} = PVE::API2::Ceph::OSD->osdvolume({
                osdid => $param->{osdid},
                node => $param->{node},
                type => $dev->{device},
            });
        }
        $res->{verbose} = 1 if $param->{verbose};
        return $res;
    },
});

my $format_osddetails = sub {
    my ($data, $schema, $options) = @_;

    $options->{"output-format"} //= "text";

    if ($data->{verbose}) {
        $options->{"output-format"} = "json-pretty";
        delete $data->{verbose};
    }

    if ($options->{"output-format"} eq "text") {
        for my $dev ($data->{devices}->@*) {
            my ($disk, $type, $device) = $dev->@{ 'physical_device', 'type', 'device' };
            my ($lv_size, $lv_ctime) = $dev->{'lv-info'}->@{ 'lv_size', 'creation_time' };

            $data->{osd}->{$device} =
                "Disk: $disk, Type: $type, LV Size: $lv_size, LV Creation Time: $lv_ctime";
        }
        PVE::CLIFormatter::print_api_result($data->{osd}, $schema, undef, $options);
    } else {
        PVE::CLIFormatter::print_api_result($data, $schema, undef, $options);
    }
};

my sub wrapped_lines {
    my ($text, $first_width, $next_width) = @_;
    $next_width //= $first_width;
    my $lines = [''];
    for my $word (split(/\s+/, $text)) {
        my $width = $#$lines ? $next_width : $first_width;
        if (length($lines->[-1]) + length($word) + 1 > $width) {
            push @$lines, $word;
        } else {
            $lines->[-1] .= (length($lines->[-1]) ? ' ' : '') . $word;
        }
    }
    return $lines;
}

my sub print_wrapped_bullet {
    my ($text) = @_;

    # 92 plus the four-space continuation indent stays inside the 100 columns the rest of
    # the 'pveceph auth status' output uses
    my $lines = wrapped_lines($text, 92);
    print "  * $lines->[0]\n";
    print "    $_\n" for $lines->@[1 .. $#$lines];
}

my sub print_wrapped_values {
    my ($label, $values) = @_;
    my $prefix = "  $label: ";
    my $indent = ' ' x length($prefix);
    my $width = 100 - length($prefix);
    my $lines = [''];
    for my $value (@$values) {
        my $separator = length($lines->[-1]) ? ', ' : '';
        if (length($lines->[-1]) + length($separator) + length($value) > $width) {
            push @$lines, $value;
        } else {
            $lines->[-1] .= "$separator$value";
        }
    }
    print "$prefix$lines->[0]\n";
    print "$indent$_\n" for $lines->@[1 .. $#$lines];
}

# Long entity lists are unhelpful in a terminal; the JSON output has all of them.
my $AUTH_STATUS_ENTITY_LIMIT = 24;

sub format_auth_status {
    my ($data, $schema, $options) = @_;

    $options->{'output-format'} //= 'text';
    if ($options->{'output-format'} ne 'text') {
        PVE::CLIFormatter::print_api_result($data, $schema, undef, $options);
        return;
    }

    print "Cephx key cipher status\n";

    my $entities = $data->{entities} // {};
    my $details = $entities->{details} // {};
    my $attention = {};
    my %ciphers;
    my $has_pending = 0;
    for my $class (qw(service client)) {
        my $by_cipher = $entities->{$class} // {};
        for my $cipher (keys %$by_cipher) {
            for my $entity ($by_cipher->{$cipher}->@*) {
                my $detail = $details->{$entity} // {};
                $ciphers{$cipher} = 1;
                $has_pending ||= defined($detail->{'pending-cipher'});
                next if $cipher eq 'aes256k' && !defined($detail->{'pending-cipher'});
                $attention->{$entity} = { 'current-cipher' => $cipher, %$detail };
            }
        }
    }
    # Homogeneous inventories need counts, not repeated names. Partial reads and mixed or
    # staged keys still need named exceptions, without implying a migration direction.
    $attention = {}
        if $entities->{complete}
        && $entities->{'pending-keys-known'}
        && !$has_pending
        && scalar(keys %ciphers) == 1
        && !$ciphers{unknown};
    my @attention = sort {
        defined($attention->{$b}->{'pending-cipher'}) <=>
            defined($attention->{$a}->{'pending-cipher'})
            || ($attention->{$b}->{'current-cipher'} eq 'unknown')
            <=> ($attention->{$a}->{'current-cipher'} eq 'unknown')
            || $a cmp $b
    } keys %$attention;
    if (@attention || !$entities->{complete}) {
        printf(
            "\nKeys needing attention (%d listed %s)\n",
            scalar(@attention),
            @attention == 1 ? 'identity' : 'identities',
        );
    }
    print "  full inventory unavailable; the listed keys may be incomplete\n"
        if !$entities->{complete};
    my $shown = @attention > $AUTH_STATUS_ENTITY_LIMIT ? $AUTH_STATUS_ENTITY_LIMIT : @attention;
    for my $entity (@attention[0 .. $shown - 1]) {
        my $detail = $attention->{$entity};
        my $current = $detail->{'current-cipher'} // 'unknown';
        printf(
            "  %s: current %s%s, pending %s\n",
            $entity,
            $current,
            $current ne 'aes256k' && $current ne 'unknown' ? ' (old)' : '',
            $detail->{'pending-cipher'}
                // ($entities->{'pending-keys-known'} ? 'none' : 'unknown'),
        );
    }
    printf("  ... %d more identities needing attention; see the full JSON inventory below\n",
        @attention - $shown)
        if @attention > $shown;

    my $nodes = $data->{nodes} // {};
    my $old_kernels = grep {
        defined($_->{'supports-aes256k'}) && !$_->{'supports-aes256k'}
    } values %$nodes;
    my $unknown_kernels = !scalar(keys %$nodes)
        || grep { !defined($_->{'supports-aes256k'}) } values %$nodes;

    print "\nNext step\n";
    if ($old_kernels || $unknown_kernels) {
        my $issue = $old_kernels ? ($unknown_kernels ? 'old or unknown' : 'old') : 'unknown';
        my $summary =
            scalar(keys %$nodes)
            ? "Some reported node kernels are $issue."
            : 'No node kernel versions were reported.';
        print_wrapped_bullet("$summary Verify uname -r on affected nodes; kernel"
            . " RBD/CephFS clients need a running kernel 7.0 or newer before key rotation."
            . " This does not block userspace-only keys.");
    }
    for my $line (($data->{conclusion} // [])->@*) {
        # Keep suggested commands intact so they can be copied without joining wrapped lines.
        if ($line =~ m{^(?:/usr/share/pve-manager/migrations/|pveceph auth status$)}) {
            print "  $line\n";
        } else {
            print_wrapped_bullet($line);
        }
    }

    print "\nListed current keys (Ceph identities, not guests, mounts, or sessions)\n";
    printf(
        "  source: %s%s\n",
        $entities->{source} // 'unknown',
        $entities->{complete} ? '' : ' (partial inventory)',
    );
    for my $class (qw(service client)) {
        my $by_cipher = $entities->{$class} // {};
        my @counts = map { scalar($by_cipher->{$_}->@*) . " $_" } sort keys %$by_cipher;
        push @counts, $entities->{complete} ? 'none' : 'unknown, none named' if !@counts;
        print_wrapped_values($class, \@counts);
    }
    printf("  pending keys: %s\n",
        $entities->{'pending-keys-known'} ? ($entities->{'pending-keys'} // 0) : 'unknown');
    print "  Full key inventories:\n  pveceph auth status --output-format json-pretty\n";

    my $checks = $data->{checks} // {};
    print "\nCephx health checks\n";
    print "  unknown: health checks could not be read\n" if !$data->{'checks-known'};
    print "  none active\n" if $data->{'checks-known'} && !scalar(keys %$checks);
    for my $name (sort keys %$checks) {
        my $check = $checks->{$name};
        printf(
            "  [%-4s] %s: %s%s\n",
            ($check->{severity} // 'unknown') =~ s/^HEALTH_//r,
            $name,
            $check->{message} // '',
            $check->{muted} ? ' (muted)' : '',
        );
    }

    my $monmap = $data->{monmap} // {};
    print "\nCipher settings (mon dump)\n";
    my $settings = {
        auth_service_cipher => 'service tickets',
        auth_preferred_cipher => 'default for new keys',
        auth_allowed_ciphers => 'permitted for authentication',
    };
    for my $key (qw(auth_service_cipher auth_allowed_ciphers auth_preferred_cipher)) {
        my $value = $monmap->{$key} // 'unknown';
        printf("  %s: %s (%s)\n",
            $key,
            ref($value) eq 'ARRAY' ? join(', ', @$value) : $value,
            $settings->{$key});
    }
    if ($checks->{AUTH_INSECURE_KEYS_CREATABLE}) {
        print "  The default for new keys does not restrict which key types may be created.\n";
    }

    my $quorum = $data->{quorum} // {};
    my $members = $quorum->{members} // [];
    print "\nMonitor quorum\n";
    print_wrapped_values('members', scalar(@$members) ? $members : ['unknown']);
    my $quorum_capable = $quorum->{'supports-aes256k'};
    printf(
        "  aes256k capable: %s (from %s)\n",
        defined($quorum_capable) ? ($quorum_capable ? 'yes' : 'no') : 'unknown',
        $quorum->{'feature-source'} // 'unknown',
    );

    my $daemons = $data->{daemons} // {};
    my $versions = {};
    for my $type (qw(mon mgr osd mds)) {
        for my $entry (($daemons->{$type} // [])->@*) {
            my $supported = $entry->{'supports-aes256k'};
            my $version = $entry->{'version-short'} // $entry->{version};
            my $label = "$version - "
                . (
                    !defined($supported) ? 'aes256k support unknown'
                    : $supported ? 'supports aes256k'
                    : 'too old, upgrade/restart required'
                );
            push $versions->{$label}->@*, "$entry->{count} $type";
        }
    }
    print "\nReported daemon versions\n";
    print "  unknown\n" if !scalar(keys %$versions);
    print_wrapped_values($_, $versions->{$_}) for sort keys %$versions;

    print "\nReported node kernels (kernel RBD/CephFS clients need 7.0 or newer)\n";
    print "  unknown\n" if !scalar(keys %$nodes);
    for my $node (sort keys %$nodes) {
        my $supported = $nodes->{$node}->{'supports-aes256k'};
        my $source = $nodes->{$node}->{source} // 'no kernel report';
        $source = 'at Ceph daemon start' if $source eq 'ceph daemon metadata';
        printf(
            "  %s: %s (%s)%s\n",
            $node,
            $nodes->{$node}->{kernel} // 'unknown',
            $source,
            !defined($supported) ? ' - compatibility unknown'
            : $supported ? ''
            : ' - too old for aes256k kernel clients',
        );
    }
    print
        "\nClient refresh, including disconnected clients and external copies, is not verified here.\n";
}

__PACKAGE__->register_method({
    name => 'auth_status',
    path => 'auth-status',
    method => 'GET',
    description =>
        "Show current and pending cephx key ciphers and aes256k migration prerequisites.",
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    parameters => {
        additionalProperties => 0,
        properties => {},
    },
    returns => {
        type => 'object',
        description => "Whatever could be collected. Anything a Ceph release from before the"
            . " aes256k cipher does not report is left out rather than guessed at.",
        properties => {
            quorum => {
                type => 'object',
                description => "Whether the monitor quorum can do aes256k at all, which gates"
                    . " every migration step.",
                additionalProperties => 1,
                properties => {
                    'supports-aes256k' => {
                        type => 'boolean',
                        description => "Every monitor in the quorum advertises the cipher."
                            . " Absent if the quorum features could not be read, as only they"
                            . " decide this.",
                        optional => 1,
                    },
                },
            },
            monmap => {
                type => 'object',
                description => "The cipher settings from 'ceph mon dump', under their Ceph"
                    . " names. Empty if unavailable or absent on this release.",
                additionalProperties => 1,
            },
            daemons => {
                type => 'object',
                description => "Running daemon versions per service type, with whether each"
                    . " supports aes256k.",
                additionalProperties => 1,
            },
            'daemons-without-aes256k' => {
                type => 'array',
                description => "Daemon groups that still need a restart onto a newer binary.",
                items => { type => 'string' },
            },
            entities => {
                type => 'object',
                description => "Cephx entities grouped into service and client class and then"
                    . " by cipher. Never contains any key material.",
                additionalProperties => 1,
            },
            nodes => {
                type => 'object',
                description => "Kernel release per node from local uname or remote Ceph daemon"
                    . " metadata recorded at daemon start. Kernel Ceph clients need kernel 7.0 for aes256k.",
                additionalProperties => 1,
            },
            'checks-known' => {
                type => 'boolean',
                description => "Whether the Ceph health checks could be read.",
            },
            checks => {
                type => 'object',
                description => "The active AUTH_* health checks, with whether they block a"
                    . " rolling restart.",
                additionalProperties => 1,
            },
            conclusion => {
                type => 'array',
                description => "What is left to do, in plain words.",
                items => { type => 'string' },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        # nine mon commands on one handle, and PVE::RADOS kills its helper process on the
        # first timeout, which would leave every later command failing and the whole report
        # reading as "nothing could be collected"
        my $rados = PVE::Ceph::Services::ResilientRados->new(
            timeout => PVE::Ceph::Tools::get_config('long_rados_timeout'),
        );

        return PVE::Ceph::Services::get_cephx_auth_status($rados);
    },
});

our $cmddef = {
    init => ['PVE::API2::Ceph', 'init', [], { node => $nodename }],
    auth => {
        status => [
            __PACKAGE__,
            'auth_status',
            [],
            {},
            \&format_auth_status,
            $PVE::RESTHandler::standard_output_options,
        ],
    },
    pool => {
        ls => [
            'PVE::API2::Ceph::Pool',
            'lspools',
            [],
            { node => $nodename },
            sub {
                my ($data, $schema, $options) = @_;
                PVE::CLIFormatter::print_api_result(
                    $data,
                    $schema,
                    [
                        'pool_name',
                        'size',
                        'min_size',
                        'pg_num',
                        'pg_num_min',
                        'pg_num_final',
                        'pg_autoscale_mode',
                        'target_size',
                        'target_size_ratio',
                        'crush_rule_name',
                        'percent_used',
                        'bytes_used',
                    ],
                    $options,
                );
            },
            $PVE::RESTHandler::standard_output_options,
        ],
        create => ['PVE::API2::Ceph::Pool', 'createpool', ['name'], { node => $nodename }],
        destroy => ['PVE::API2::Ceph::Pool', 'destroypool', ['name'], { node => $nodename }],
        set => ['PVE::API2::Ceph::Pool', 'setpool', ['name'], { node => $nodename }],
        get => [
            'PVE::API2::Ceph::Pool',
            'getpool',
            ['name'],
            { node => $nodename },
            sub {
                my ($data, $schema, $options) = @_;
                PVE::CLIFormatter::print_api_result($data, $schema, undef, $options);
            },
            $PVE::RESTHandler::standard_output_options,
        ],
    },
    lspools => { alias => 'pool ls' },
    createpool => { alias => 'pool create' },
    destroypool => { alias => 'pool destroy' },
    fs => {
        create => ['PVE::API2::Ceph::FS', 'createfs', [], { node => $nodename }],
        destroy => ['PVE::API2::Ceph::FS', 'destroyfs', ['name'], { node => $nodename }],
    },
    osd => {
        create =>
            ['PVE::API2::Ceph::OSD', 'createosd', ['dev'], { node => $nodename }, $upid_exit],
        destroy =>
            ['PVE::API2::Ceph::OSD', 'destroyosd', ['osdid'], { node => $nodename }, $upid_exit],
        details => [
            __PACKAGE__,
            'osd-details',
            ['osdid'],
            { node => $nodename },
            $format_osddetails,
            $PVE::RESTHandler::standard_output_options,
        ],
    },
    createosd => { alias => 'osd create' },
    destroyosd => { alias => 'osd destroy' },
    mon => {
        create => ['PVE::API2::Ceph::MON', 'createmon', [], { node => $nodename }, $upid_exit],
        destroy =>
            ['PVE::API2::Ceph::MON', 'destroymon', ['monid'], { node => $nodename }, $upid_exit],
    },
    createmon => { alias => 'mon create' },
    destroymon => { alias => 'mon destroy' },
    mgr => {
        create => ['PVE::API2::Ceph::MGR', 'createmgr', [], { node => $nodename }, $upid_exit],
        destroy =>
            ['PVE::API2::Ceph::MGR', 'destroymgr', ['id'], { node => $nodename }, $upid_exit],
    },
    createmgr => { alias => 'mgr create' },
    destroymgr => { alias => 'mgr destroy' },
    mds => {
        create => ['PVE::API2::Ceph::MDS', 'createmds', [], { node => $nodename }, $upid_exit],
        destroy =>
            ['PVE::API2::Ceph::MDS', 'destroymds', ['name'], { node => $nodename }, $upid_exit],
    },
    start => ['PVE::API2::Ceph', 'start', [], { node => $nodename }, $upid_exit],
    stop => ['PVE::API2::Ceph', 'stop', [], { node => $nodename }, $upid_exit],
    install => [__PACKAGE__, 'install', []],
    purge => [__PACKAGE__, 'purge', []],
    status => [__PACKAGE__, 'status', []],
};

1;
