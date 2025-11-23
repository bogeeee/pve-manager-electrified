package PVE::Ceph::Releases;

use v5.36;

use PVE::pvecfg;

my sub get_current_pve_major_release {
    my $release_tuples = [split(/\./, PVE::pvecfg::release())];
    return $release_tuples->[0];
}

my $_ceph_release_info;
my sub get_ceph_release_def {
    if (defined($_ceph_release_info)) {
        return $_ceph_release_info;
    }

    # Track all ceph releases (from a initial cut-off) with some metainfo.
    #
    # Schema keys:
    #  - `release`: version number of the stable release, which for ceph normally is `X.2`
    #  - `initial-upstream-release`: the ISO 8601 formatted day when upstream made their initial
    #    stable release.
    #  - `estimated-end-of-upstream-support`: the ISO 8601 formatted day when upstream will go EOL
    #  - `available-for-pve-release`: a hash that denotes for which PVE major release series a ceph
    #    release is available, where available does not necessarily means (already) fully supported
    #  - `current-backend-default`: set to `1` if a release is currently used as default in the
    #    backend, i.e. by pveceph. The wizard from the web UI often uses a newer release, which is
    #    currently tracked manually there.
    #  - `unsupported`: set to `1` to mark a release as (currently) unsupported, which most often
    #    means that upstream either had no stable release yet, or we aren't 100 % finished with QA
    #    of that release yet.
    #
    # NOTE: very old releases got left out from the list, but there's _no_ need to clean-up
    # periodically check https://docs.ceph.com/en/latest/releases/ for all past releases
    my $ceph_release_info = {
        octopus => {
            release => '15.2',
            'initial-upstream-release' => '2020-03-23',
            'estimated-end-of-upstream-support' => '2022-08-09',
            'available-for-pve-release' => {
                6 => 1,
                7 => 1,
            },
        },
        pacific => {
            release => '16.2',
            'initial-upstream-release' => '2021-03-31',
            'estimated-end-of-upstream-support' => '2024-03-04',
            'available-for-pve-release' => {
                7 => 1,
            },
        },
        quincy => {
            release => '17.2',
            'initial-upstream-release' => '2022-04-19',
            'estimated-end-of-upstream-support' => '2024-06-01',
            'available-for-pve-release' => {
                7 => 1,
                8 => 1,
            },
        },
        reef => {
            release => '18.2',
            'initial-upstream-release' => '2023-08-07',
            'estimated-end-of-upstream-support' => '2025-08-01',
            'available-for-pve-release' => {
                8 => 1,
            },
        },
        squid => {
            release => '19.2',
            'current-backend-default' => 1,
            'initial-upstream-release' => '2024-09-27',
            'estimated-end-of-upstream-support' => '2026-09-19',
            'available-for-pve-release' => {
                8 => 1,
                9 => 1,
            },
        },
    };

    my $current_pve_major_release = get_current_pve_major_release();
    for my $codename (sort keys $ceph_release_info->%*) {
        my $ceph_release = $ceph_release_info->{$codename};
        $ceph_release->{codename} = $codename;
        $ceph_release->{'available-for-current-pve-release'} =
            $ceph_release->{'available-for-pve-release'}->{$current_pve_major_release};
    }

    $_ceph_release_info = $ceph_release_info;
}

sub get_ceph_release_info($codename) {
    my $ceph_releases = get_ceph_release_def();
    return $ceph_releases->{$codename};
}

my $_available_ceph_releases;

sub get_all_available_ceph_releases {
    if (!defined($_available_ceph_releases)) {
        my $ceph_releases = get_ceph_release_def();
        $_available_ceph_releases = {};
        for my $codename (sort keys $ceph_releases->%*) {
            if ($ceph_releases->{$codename}->{'available-for-current-pve-release'}) {
                $_available_ceph_releases->{$codename} = $ceph_releases->{$codename};
            }
        }
    }
    return $_available_ceph_releases;
}

sub get_available_ceph_release_codenames($include_unstable_releases = 0) {
    my $available_releases = get_all_available_ceph_releases();

    return $include_unstable_releases
        ? [sort keys $available_releases->%*]
        : [grep { !$available_releases->{$_}->{unsupported} } sort keys $available_releases->%*];
}

my $_default_ceph_release_codename;

sub get_default_ceph_release_codename {
    if (!defined($_default_ceph_release_codename)) {
        my $ceph_releases = get_all_available_ceph_releases();
        my @default_release =
            grep { $ceph_releases->{$_}->{'current-backend-default'} } keys $ceph_releases->%*;
        die "internal error: got multiple ceph releases with 'current-backend-default' set\n"
            if scalar(@default_release) > 1;
        die "internal error: got no ceph releases with 'current-backend-default' set\n"
            if scalar(@default_release) < 1;
        $_default_ceph_release_codename = $default_release[0];
    }
    return $_default_ceph_release_codename;
}

1;
