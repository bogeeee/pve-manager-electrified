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

        my $repo = $param->{'repository'} // 'enterprise';
        my $enterprise_repo = $repo eq 'enterprise';
        my $cdn =
            $enterprise_repo ? 'https://enterprise.proxmox.com' : 'http://download.proxmox.com';

        if (has_valid_subscription()) {
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

        my $available_ceph_releases = PVE::Ceph::Releases::get_all_available_ceph_releases();
        die "unsupported ceph version: $cephver"
            if !exists($available_ceph_releases->{$cephver});

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

            if ($available_ceph_releases->{$cephver}->{unsupported}) {
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
            my @ceph_versions = $apt_cache->{'ceph-common:amd64'}->{'VersionList'}->@*;
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

my $get_storages = sub {
    my ($fs, $is_default) = @_;

    my $cfg = PVE::Storage::config();

    my $storages = $cfg->{ids};
    my $res = {};
    foreach my $storeid (keys %$storages) {
        my $curr = $storages->{$storeid};
        next if $curr->{type} ne 'cephfs';
        my $cur_fs = $curr->{'fs-name'};
        $res->{$storeid} = $storages->{$storeid}
            if (!defined($cur_fs) && $is_default) || (defined($cur_fs) && $fs eq $cur_fs);
    }

    return $res;
};

__PACKAGE__->register_method({
    name => 'destroyfs',
    path => 'destroyfs',
    method => 'DELETE',
    description => "Destroy a Ceph filesystem",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            name => {
                description => "The ceph filesystem name.",
                type => 'string',
            },
            'remove-storages' => {
                description => "Remove all pveceph-managed storages configured for this fs.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
            'remove-pools' => {
                description => "Remove data and metadata pools configured for this fs.",
                type => 'boolean',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rpcenv = PVE::RPCEnvironment::get();
        my $user = $rpcenv->get_user();

        my $fs_name = $param->{name};

        my $fs;
        my $fs_list = PVE::Ceph::Tools::ls_fs();
        for my $entry (@$fs_list) {
            next if $entry->{name} ne $fs_name;
            $fs = $entry;
            last;
        }
        die "no such cephfs '$fs_name'\n" if !$fs;

        my $worker = sub {
            my $rados = PVE::RADOS->new();

            if ($param->{'remove-storages'}) {
                my $defaultfs;
                my $fs_dump = $rados->mon_command({ prefix => "fs dump" });
                for my $fs ($fs_dump->{filesystems}->@*) {
                    next if $fs->{id} != $fs_dump->{default_fscid};
                    $defaultfs = $fs->{mdsmap}->{fs_name};
                }
                warn "no default fs found, maybe not all relevant storages are removed\n"
                    if !defined($defaultfs);

                my $storages = $get_storages->($fs_name, $fs_name eq ($defaultfs // ''));
                for my $storeid (keys %$storages) {
                    my $store = $storages->{$storeid};
                    if (!$store->{disable}) {
                        die "storage '$storeid' is not disabled, make sure to disable "
                            . "and unmount the storage first\n";
                    }
                }

                my $err;
                for my $storeid (keys %$storages) {
                    # skip external clusters, not managed by pveceph
                    next if $storages->{$storeid}->{monhost};
                    eval { PVE::API2::Storage::Config->delete({ storage => $storeid }) };
                    if ($@) {
                        warn "failed to remove storage '$storeid': $@\n";
                        $err = 1;
                    }
                }
                die "failed to remove (some) storages - check log and remove manually!\n"
                    if $err;
            }

            PVE::Ceph::Tools::destroy_fs($fs_name, $rados);

            if ($param->{'remove-pools'}) {
                warn "removing metadata pool '$fs->{metadata_pool}'\n";
                eval { PVE::Ceph::Tools::destroy_pool($fs->{metadata_pool}, $rados) };
                warn "$@\n" if $@;

                foreach my $pool ($fs->{data_pools}->@*) {
                    warn "removing data pool '$pool'\n";
                    eval { PVE::Ceph::Tools::destroy_pool($pool, $rados) };
                    warn "$@\n" if $@;
                }
            }

        };
        return $rpcenv->fork_worker('cephdestroyfs', $fs_name, $user, $worker);
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

our $cmddef = {
    init => ['PVE::API2::Ceph', 'init', [], { node => $nodename }],
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
        destroy => [__PACKAGE__, 'destroyfs', ['name'], { node => $nodename }],
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
