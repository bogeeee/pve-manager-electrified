package PVE::Status::InfluxDB;

use strict;
use warnings;

use POSIX qw(isnan isinf);
use Scalar::Util 'looks_like_number';
use IO::Socket::IP;
use IO::Socket::SSL qw(SSL_VERIFY_NONE);
use LWP::UserAgent;
use HTTP::Request;

use PVE::SafeSyslog;

use PVE::Status::Plugin;

use base('PVE::Status::Plugin');

sub type {
    return 'influxdb';
}

sub properties {
    return {
        organization => {
            description =>
                "The InfluxDB organization. Only necessary when using the http v2 api."
                . " Has no meaning when using v2 compatibility api.",
            type => 'string',
            optional => 1,
        },
        bucket => {
            description => "The InfluxDB bucket/db. Only necessary when using the http v2 api.",
            type => 'string',
            optional => 1,
        },
        token => {
            description =>
                "The InfluxDB access token. Only necessary when using the http v2 api."
                . " If the v2 compatibility api is used, use 'user:password' instead.",
            type => 'string',
            optional => 1,
        },
        'api-path-prefix' => {
            description => "An API path prefix inserted between '<host>:<port>/' and '/api2/'."
                . " Can be useful if the InfluxDB service runs behind a reverse proxy.",
            type => 'string',
            optional => 1,
        },
        influxdbproto => {
            type => 'string',
            enum => ['udp', 'http', 'https'],
            default => 'udp',
            optional => 1,
        },
        'max-body-size' => {
            description =>
                "InfluxDB max-body-size in bytes. Requests are batched up to this size.",
            type => 'integer',
            minimum => 1,
            default => 25_000_000,
        },
        'verify-certificate' => {
            description => "Set to 0 to disable certificate verification for https endpoints.",
            type => 'boolean',
            optional => 1,
            default => 1,
        },
    };
}

sub options {
    return {
        server => {},
        port => {},
        mtu => { optional => 1 },
        disable => { optional => 1 },
        organization => { optional => 1 },
        bucket => { optional => 1 },
        token => { optional => 1 },
        influxdbproto => { optional => 1 },
        timeout => { optional => 1 },
        'max-body-size' => { optional => 1 },
        'api-path-prefix' => { optional => 1 },
        'verify-certificate' => { optional => 1 },
    };
}

my $set_ssl_opts = sub {
    my ($cfg, $ua) = @_;

    my $cert_verify = $cfg->{'verify-certificate'} // 1;
    if (!$cert_verify) {
        $ua->ssl_opts(
            verify_hostname => 0,
            SSL_verify_mode => SSL_VERIFY_NONE,
        );
    }

    return;
};

# Plugin implementation
sub update_node_status {
    my ($class, $txn, $node, $data, $ctime) = @_;

    $ctime *= 1000000000;

    build_influxdb_payload($class, $txn, $data, $ctime, "object=nodes,host=$node");
}

sub update_qemu_status {
    my ($class, $txn, $vmid, $data, $ctime, $nodename) = @_;

    $ctime *= 1000000000;

    my $object = "object=qemu,vmid=$vmid,nodename=$nodename";
    if ($data->{name} && $data->{name} ne '') {
        $object .= ",host=$data->{name}";
    }
    $object =~ s/\s/\\ /g;

    # VMID is already added in base $object above, so exclude it from being re-added
    build_influxdb_payload($class, $txn, $data, $ctime, $object, { 'vmid' => 1 });
}

sub update_lxc_status {
    my ($class, $txn, $vmid, $data, $ctime, $nodename) = @_;

    $ctime *= 1000000000;

    my $object = "object=lxc,vmid=$vmid,nodename=$nodename";
    if ($data->{name} && $data->{name} ne '') {
        $object .= ",host=$data->{name}";
    }
    $object =~ s/\s/\\ /g;

    # VMID is already added in base $object above, so exclude it from being re-added
    build_influxdb_payload($class, $txn, $data, $ctime, $object, { 'vmid' => 1 });
}

sub update_storage_status {
    my ($class, $txn, $nodename, $storeid, $data, $ctime) = @_;

    $ctime *= 1000000000;

    my $object = "object=storages,nodename=$nodename,host=$storeid";
    if ($data->{type} && $data->{type} ne '') {
        $object .= ",type=$data->{type}";
    }
    $object =~ s/\s/\\ /g;

    build_influxdb_payload($class, $txn, $data, $ctime, $object);
}

sub _send_batch_size {
    my ($class, $cfg) = @_;
    my $proto = $cfg->{influxdbproto} // 'udp';
    if ($proto ne 'udp') {
        return $cfg->{'max-body-size'} // 25_000_000;
    }

    return $class->SUPER::_send_batch_size($cfg);
}

sub send {
    my ($class, $connection, $data, $cfg) = @_;

    my $proto = $cfg->{influxdbproto} // 'udp';
    if ($proto eq 'udp') {
        return $class->SUPER::send($connection, $data, $cfg);
    } elsif ($proto =~ m/^https?$/) {
        my $ua = LWP::UserAgent->new();
        $set_ssl_opts->($cfg, $ua);
        $ua->timeout($cfg->{timeout} // 1);
        $connection->content($data);
        my $response = $ua->request($connection);

        if (!$response->is_success) {
            my $err = $response->status_line;
            die "$err\n";
        }
    } else {
        die "invalid protocol\n";
    }

    return;
}

sub _disconnect {
    my ($class, $connection, $cfg) = @_;
    my $proto = $cfg->{influxdbproto} // 'udp';
    if ($proto eq 'udp') {
        return $class->SUPER::_disconnect($connection, $cfg);
    }

    return;
}

sub _get_v2url {
    my ($cfg, $api_path) = @_;
    my ($proto, $host, $port) = $cfg->@{qw(influxdbproto server port)};
    my $api_prefix = $cfg->{'api-path-prefix'} // '/';
    if ($api_prefix ne '/' && $api_prefix =~ m!^/*(.+)/*$!) {
        $api_prefix = "/$1/";
    }

    if ($api_path ne 'health') {
        $api_path = "api/v2/${api_path}";
    }

    return "${proto}://${host}:${port}${api_prefix}${api_path}";
}

sub _connect {
    my ($class, $cfg, $id) = @_;

    my $host = $cfg->{server};
    my $port = $cfg->{port};
    my $proto = $cfg->{influxdbproto} // 'udp';

    if ($proto eq 'udp') {
        my $socket = IO::Socket::IP->new(
            PeerAddr => $host,
            PeerPort => $port,
            Proto => 'udp',
        ) || die "couldn't create influxdb socket [$host]:$port - $@\n";

        $socket->blocking(0);

        return $socket;
    } elsif ($proto =~ m/^https?$/) {
        my $token = get_credentials($id, 1);
        my $org = $cfg->{organization} // 'proxmox';
        my $bucket = $cfg->{bucket} // 'proxmox';
        my $url = _get_v2url($cfg, "write?org=${org}&bucket=${bucket}");

        my $req = HTTP::Request->new(POST => $url);
        if (defined($token)) {
            $req->header("Authorization", "Token $token");
        }

        return $req;
    }

    die "cannot connect to InfluxDB: invalid protocol '$proto'\n";
}

sub test_connection {
    my ($class, $cfg, $id) = @_;

    # do not check connection for disabled plugins
    return if $cfg->{disable};

    my $proto = $cfg->{influxdbproto} // 'udp';
    if ($proto eq 'udp') {
        return $class->SUPER::test_connection($cfg, $id);
    } elsif ($proto =~ m/^https?$/) {
        my $url = _get_v2url($cfg, "health");
        my $ua = LWP::UserAgent->new();
        $set_ssl_opts->($cfg, $ua);
        $ua->timeout($cfg->{timeout} // 1);
        # in the initial add connection test, the token may still be in $cfg
        my $token = $cfg->{token} // get_credentials($id, 1);
        if (defined($token)) {
            $ua->default_header("Authorization" => "Token $token");
        }
        my $response = $ua->get($url);

        if (!$response->is_success) {
            my $err = $response->status_line;
            die "$err\n";
        }
    } else {
        die "invalid protocol\n";
    }

    return;
}

sub build_influxdb_payload {
    my ($class, $txn, $data, $ctime, $tags, $excluded, $measurement, $instance) = @_;

    # 'abc' and '123' are both valid hostnames/tags, that confuses influx's type detection
    my $to_quote = { name => 1, tags => 1 };

    my @values = ();

    foreach my $key (sort keys %$data) {
        next if defined($excluded) && $excluded->{$key};
        my $value = $data->{$key};
        next if !defined($value);

        if (!ref($value) && $value ne '') {
            # value is scalar

            if (defined(my $v = prepare_value($value, $to_quote->{$key}))) {
                push @values, "$key=$v";
            }
        } elsif (ref($value) eq 'HASH') {
            # value is a hash

            if (!defined($measurement)) {
                build_influxdb_payload($class, $txn, $value, $ctime, $tags, $excluded, $key);
            } elsif (!defined($instance)) {
                build_influxdb_payload(
                    $class, $txn, $value, $ctime, $tags, $excluded, $measurement, $key,
                );
            } else {
                push @values, get_recursive_values($value);
            }
        }
    }

    if (@values > 0) {
        my $mm = $measurement // 'system';
        my $tagstring = $tags;
        $tagstring .= ",instance=$instance" if defined($instance);
        my $valuestr = join(',', @values);
        $class->add_metric_data($txn, "$mm,$tagstring $valuestr $ctime\n");
    }
}

sub get_recursive_values {
    my ($hash) = @_;

    my @values = ();

    foreach my $key (keys %$hash) {
        my $value = $hash->{$key};
        if (ref($value) eq 'HASH') {
            push(@values, get_recursive_values($value));
        } elsif (!ref($value) && $value ne '') {
            if (defined(my $v = prepare_value($value))) {
                push @values, "$key=$v";
            }
        }
    }

    return @values;
}

sub prepare_value {
    my ($value, $force_quote) = @_;

    # don't treat value like a number if quote is 1
    if (!$force_quote && looks_like_number($value)) {
        if (isnan($value) || isinf($value)) {
            # we cannot send influxdb NaN or Inf
            return undef;
        }

        # influxdb also accepts 1.0e+10, etc.
        return $value;
    }

    # non-numeric values require to be quoted, so escape " with \"
    $value =~ s/\"/\\\"/g;
    $value = "\"$value\"";

    return $value;
}

my $priv_dir = "/etc/pve/priv/metricserver";

sub cred_file_name {
    my ($id) = @_;
    return "${priv_dir}/${id}.pw";
}

sub delete_credentials {
    my ($id) = @_;

    if (my $cred_file = cred_file_name($id)) {
        unlink($cred_file)
            or warn "removing influxdb credentials file '$cred_file' failed: $!\n";
    }

    return;
}

sub set_credentials {
    my ($id, $token) = @_;

    my $cred_file = cred_file_name($id);

    mkdir $priv_dir;

    PVE::Tools::file_set_contents($cred_file, "$token");
}

sub get_credentials {
    my ($id, $silent) = @_;

    my $cred_file = cred_file_name($id);

    my $creds = eval { PVE::Tools::file_get_contents($cred_file) };
    warn "could not load credentials for '$id': $@\n" if $@ && !$silent;

    return $creds;
}

sub on_add_hook {
    my ($class, $id, $opts, $sensitive_opts) = @_;

    my $token = $sensitive_opts->{token};

    if (defined($token)) {
        set_credentials($id, $token);
    } else {
        delete_credentials($id);
    }

    return undef;
}

sub on_update_hook {
    my ($class, $id, $opts, $sensitive_opts) = @_;
    return if !exists($sensitive_opts->{token});

    my $token = $sensitive_opts->{token};
    if (defined($token)) {
        set_credentials($id, $token);
    } else {
        delete_credentials($id);
    }

    return undef;
}

sub on_delete_hook {
    my ($class, $id, $opts) = @_;

    delete_credentials($id);

    return undef;
}

1;
