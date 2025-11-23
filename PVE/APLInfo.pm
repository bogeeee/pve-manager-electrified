package PVE::APLInfo;

use strict;
use warnings;

use IO::File;
use LWP::UserAgent;
use POSIX qw(strftime);

use PVE::SafeSyslog;
use PVE::Storage;
use PVE::Tools qw(run_command);
use PVE::pvecfg;

my $LOGFILE = "/var/log/pveam.log";
my $APL_INFO_DIRECTORY = "/var/lib/pve-manager/apl-info";

sub logmsg {
    my ($logfd, $msg) = @_;

    chomp $msg;

    my $tstr = strftime("%F %H:%M:%S", localtime);

    foreach my $line (split(/\n/, $msg)) {
        print $logfd "$tstr $line\n";
    }
}

sub read_aplinfo_from_fh {
    my ($fh, $list, $source, $update) = @_;

    local $/ = "";

    while (my $rec = <$fh>) {
        chomp $rec;

        my $res = {};

        while ($rec) {

            if ($rec =~ s/^Description:\s*([^\n]*)(\n\s+.*)*$//si) {
                $res->{headline} = $1;
                my $long = $2 || '';
                $long =~ s/\n\s+/ /g;
                $long =~ s/^\s+//g;
                $long =~ s/\s+$//g;
                $res->{description} = $long;
            } elsif ($rec =~ s/^Version:\s*(.*\S)\s*\n//i) {
                my $version = $1;
                if ($version =~ m/^(\d[a-zA-Z0-9\.\+\-\:\~]*)(-(\d+))?$/) {
                    $res->{version} = $version;
                } else {
                    my $msg = "unable to parse appliance record: version = '$version'\n";
                    $update ? die $msg : warn $msg;
                }
            } elsif ($rec =~ s/^Type:\s*(.*\S)\s*\n//i) {
                my $type = $1;
                if ($type =~ m/^(openvz|lxc)$/) {
                    $res->{type} = $type;
                } else {
                    my $msg = "unable to parse appliance record: unknown type '$type'\n";
                    $update ? die $msg : warn $msg;
                }
            } elsif ($rec =~ s/^([^:]+):\s*(.*\S)\s*\n//) {
                $res->{ lc $1 } = $2;
            } else {
                my $msg = "unable to parse appliance record: $rec\n";
                $update ? die $msg : warn $msg;
                $res = {};
                last;
            }
        }

        if ($res->{'package'} eq 'pve-web-news' && $res->{description}) {
            $list->{'all'}->{ $res->{'package'} } = $res;
            next;
        }

        $res->{section} = 'unknown' if !$res->{section};

        if (
            $res->{'package'}
            && $res->{type}
            && $res->{os}
            && $res->{version}
            && $res->{infopage}
        ) {
            my $template;
            if ($res->{location}) {
                $template = $res->{location};
                $template =~ s|.*/([^/]+$PVE::Storage::VZTMPL_EXT_RE_1)$|$1|;
                if ($res->{location} !~ m|^([a-zA-Z]+)\://|) {
                    # relative location (no http:// prefix)
                    $res->{location} = "$source/$res->{location}";
                }
            } else {
                my $arch = $res->{architecture} || 'i386';
                $template = "$res->{os}-$res->{package}_$res->{version}_$arch.tar.gz";
                $template =~ s/$res->{os}-$res->{os}-/$res->{os}-/;
                $res->{location} = "$source/$res->{section}/$template";
            }
            $res->{source} = $source;
            $res->{template} = $template;
            $list->{ $res->{section} }->{$template} = $res;
            $list->{'all'}->{$template} = $res;
        } else {
            my $msg = "found incomplete appliance records\n";
            $update ? die $msg : warn $msg;
        }
    }
}

sub read_aplinfo {
    my ($filename, $list, $source, $update) = @_;

    my $fh = IO::File->new("<$filename")
        || die "unable to open file '$filename' - $!\n";

    eval { read_aplinfo_from_fh($fh, $list, $source, $update); };
    my $err = $@;

    close($fh);

    die $err if $err;

    return $list;
}

sub url_get {
    my ($ua, $url, $file, $logfh) = @_;

    my $req = HTTP::Request->new(GET => $url);

    logmsg($logfh, "start download $url");
    my $res = $ua->request($req, $file);

    if ($res->is_success) {
        logmsg($logfh, "download finished: " . $res->status_line);
        return 0;
    }

    logmsg($logfh, "download failed: " . $res->status_line);

    return 1;
}

sub download_aplinfo {
    my ($ua, $aplinfo, $logfd) = @_;

    my $aplsrcurl = "$aplinfo->{url}/$aplinfo->{file}.gz";
    my $aplsigurl = "$aplinfo->{url}/$aplinfo->{file}.asc";
    my $host = $aplinfo->{host};

    my $tmp = "$APL_INFO_DIRECTORY/pveam-${host}.tmp.$$";
    my $tmpgz = "$tmp.gz";
    my $sigfn = "$tmp.asc";

    eval {

        if (url_get($ua, $aplsigurl, $sigfn, $logfd) != 0) {
            die "update failed - no signature file '$sigfn'\n";
        }

        if (url_get($ua, $aplsrcurl, $tmpgz, $logfd) != 0) {
            die "update failed - no data file '$aplsrcurl'\n";
        }

        eval { run_command(["gunzip", "-f", $tmpgz]) };
        die "update failed: unable to unpack '$tmpgz'\n" if $@;

        # verify signature
        my $trustedkeyring = "/usr/share/doc/pve-manager/trustedkeys.gpg";
        my $cmd = "/usr/bin/sqv --keyring $trustedkeyring $sigfn $tmp";

        my $logfunc = sub { logmsg($logfd, "signature verification: $_[0]"); };
        eval { run_command($cmd, outfunc => $logfunc, errfunc => $logfunc); };
        die "unable to verify signature - $@\n" if $@;

        # test syntax
        eval { read_aplinfo($tmp, {}, $aplinfo->{url}, 1) };
        die "update failed: $@" if $@;

        rename($tmp, "$APL_INFO_DIRECTORY/$host")
            or die "update failed: unable to store data: $!\n";

        logmsg($logfd, "update successful");
    };

    my $err = $@;

    unlink $tmp;
    unlink $tmpgz;
    unlink $sigfn;

    die $err if $err;
}

sub get_apl_sources {
    my $sources = [
        {
            host => "download.proxmox.com",
            url => "http://download.proxmox.com/images",
            file => 'aplinfo-pve-9.dat',
        },
        {
            host => "releases.turnkeylinux.org",
            url => "https://releases.turnkeylinux.org/pve",
            file => 'aplinfo.dat',
        },
    ];

    return $sources;
}

sub update {
    my ($proxy) = @_;

    my $logfile_size = -s $LOGFILE || 0;
    if ($logfile_size > 1024 * 256) {
        rename($LOGFILE, "$LOGFILE.0") or warn "failed to rotate log file $LOGFILE - $!\n";
    }
    my $logfd = IO::File->new(">>$LOGFILE");
    logmsg($logfd, "starting update");

    my $ua = LWP::UserAgent->new;
    my $release = PVE::pvecfg::release();
    $ua->agent("PVE/$release");

    if ($proxy) {
        $ua->proxy(['http', 'https'], $proxy);
    } else {
        $ua->env_proxy;
    }

    my $sources = get_apl_sources();

    mkdir $APL_INFO_DIRECTORY;

    my @dlerr = ();
    foreach my $info (@$sources) {
        eval { download_aplinfo($ua, $info, $logfd); };
        if (my $err = $@) {
            logmsg($logfd, $err);
            push @dlerr, $info->{url};
        }
    }

    close($logfd);

    return 0 if scalar(@dlerr);

    return 1;
}

sub load_data {

    my $sources = get_apl_sources();

    my $list = {};
    foreach my $info (@$sources) {
        eval {
            my $host = $info->{host};
            read_aplinfo("$APL_INFO_DIRECTORY/$host", $list, $info->{url});
        };
        warn $@ if $@;
    }

    return $list;
}

1;

