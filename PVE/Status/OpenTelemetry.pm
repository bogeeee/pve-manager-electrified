package PVE::Status::OpenTelemetry;

use strict;
use warnings;

use Compress::Zlib;
use Encode;
use HTTP::Request;
use JSON;
use LWP::UserAgent;
use MIME::Base64 qw(decode_base64);

use PVE::Cluster;
use PVE::Status::Plugin;
use PVE::Tools qw(extract_param);

use base qw(PVE::Status::Plugin);

sub type {
    return 'opentelemetry';
}

sub properties {
    return {
        'otel-protocol' => {
            type => 'string',
            enum => ['http', 'https'],
            description => 'HTTP protocol',
            default => 'https',
        },
        'otel-path' => {
            type => 'string',
            description => 'OTLP endpoint path',
            default => '/v1/metrics',
            optional => 1,
        },
        'otel-timeout' => {
            type => 'integer',
            description => 'HTTP request timeout in seconds',
            default => 5,
            minimum => 1,
            maximum => 10,
        },
        'otel-headers' => {
            type => 'string',
            description => 'Custom HTTP headers (JSON format, base64 encoded)',
            optional => 1,
            maxLength => 1024,
        },
        'otel-verify-ssl' => {
            type => 'boolean',
            description => 'Verify SSL certificates',
            default => 1,
        },
        'otel-max-body-size' => {
            type => 'integer',
            description => 'Maximum request body size in bytes',
            default => 10_000_000,
            minimum => 1024,
        },
        'otel-resource-attributes' => {
            type => 'string',
            description => 'Additional resource attributes as JSON, base64 encoded',
            optional => 1,
            maxLength => 1024,
        },
        'otel-compression' => {
            type => 'string',
            enum => ['none', 'gzip'],
            description => 'Compression algorithm for requests',
            default => 'gzip',
            optional => 1,
        },
    };
}

sub options {
    return {
        server => { optional => 0 },
        port => { optional => 1 },
        disable => { optional => 1 },
        'otel-protocol' => { optional => 1 },
        'otel-path' => { optional => 1 },
        'otel-timeout' => { optional => 1 },
        'otel-headers' => { optional => 1 },
        'otel-verify-ssl' => { optional => 1 },
        'otel-max-body-size' => { optional => 1 },
        'otel-resource-attributes' => { optional => 1 },
        'otel-compression' => { optional => 1 },
    };
}

sub _connect {
    my ($class, $cfg, $id) = @_;

    my $connection = {
        id => $id,
        cfg => $cfg,
        metrics => [],
        stats => {
            total_metrics => 0,
            successful_batches => 0,
            failed_batches => 0,
        },
    };

    return $connection;
}

sub _disconnect {
    my ($class, $connection) = @_;
    # No persistent connection to cleanup
}

sub _get_otlp_url {
    my ($class, $cfg) = @_;
    my $proto = $cfg->{'otel-protocol'} || 'https';
    my $port = $cfg->{port} || ($proto eq 'https' ? 4318 : 4317);
    my $path = $cfg->{'otel-path'} || '/v1/metrics';

    return "${proto}://$cfg->{server}:${port}${path}";
}

sub _decode_base64_json {
    my ($class, $encoded_str) = @_;
    return '' unless defined $encoded_str && $encoded_str ne '';

    my $decoded_str = decode_base64($encoded_str);
    die "base64 decode failed" if !defined $decoded_str;

    return $decoded_str;
}

sub _parse_headers {
    my ($class, $headers_str) = @_;
    return {} unless defined $headers_str && $headers_str ne '';

    my $decoded_str = $class->_decode_base64_json($headers_str);

    my $headers = {};
    eval {
        my $json = JSON->new->decode($decoded_str);
        die "headers must be a JSON hash" if ref($json) ne 'HASH';
        $headers = $json;
    };
    if ($@) {
        warn "Failed to parse headers '$headers_str' - $@";
    }
    return $headers;
}

sub _parse_resource_attributes {
    my ($class, $json_str) = @_;
    return [] unless defined $json_str && $json_str ne '';

    my $decoded_str = $class->_decode_base64_json($json_str);

    my $attributes = [];
    eval {
        # Ensure the JSON string is properly decoded as UTF-8
        my $utf8_json =
            utf8::is_utf8($decoded_str)
            ? $decoded_str
            : Encode::decode('utf-8', $decoded_str);
        my $parsed = JSON->new->utf8(0)->decode($utf8_json);
        die "resource attributes must be a JSON hash" if ref($parsed) ne 'HASH';
        for my $key (keys %$parsed) {
            push @$attributes,
                {
                    key => $key,
                    value => { stringValue => $parsed->{$key} },
                };
        }
    };
    if ($@) {
        warn "Failed to parse resource attributes '$json_str' - $@";
    }
    return $attributes;
}

sub _compress_json {
    my ($class, $data) = @_;

    my $json_str = JSON->new->utf8->encode($data);
    my $compressed = Compress::Zlib::memGzip($json_str);

    die "gzip compression failed: $Compress::Zlib::gzerrno" if !defined $compressed;

    return $compressed;
}

sub _build_otlp_metrics {
    my ($class, $metrics_data, $cfg) = @_;

    my $cluster_name = 'single-node';
    eval {
        my $clinfo = PVE::Cluster::get_clinfo();
        if ($clinfo && $clinfo->{cluster} && $clinfo->{cluster}->{name}) {
            $cluster_name = $clinfo->{cluster}->{name};
        }
    };
    # If reading fails, use default cluster name

    my $node_name = PVE::INotify::nodename();
    my $pve_version = PVE::pvecfg::version_text();

    return {
        resourceMetrics => [{
            resource => {
                attributes => [
                    {
                        key => 'service.name',
                        value => { stringValue => 'proxmox-ve' },
                    },
                    {
                        key => 'service.version',
                        value => { stringValue => $pve_version },
                    },
                    {
                        key => 'proxmox.cluster',
                        value => { stringValue => $cluster_name },
                    },
                    {
                        key => 'proxmox.node',
                        value => { stringValue => $node_name },
                    },
                    @{ $class->_parse_resource_attributes($cfg->{'otel-resource-attributes'}) },
                ],
            },
            scopeMetrics => [{
                scope => {},
                metrics => $metrics_data,
            }],
        }],
    };
}

# Classify metric type (counter vs gauge) and determine suffix
sub _classify_metric_type {
    my ($class, $key, $metric_prefix) = @_;

    # Counter type (cumulative values) - need _total suffix
    if (
        $key =~ /^(transmit|receive|netin|netout|diskread|diskwrite)$/
        || $key =~ /_operations$/
        || $key =~ /_merged$/
        || $key =~ /^(rd_|wr_|read|write|sent|recv|tx|rx|packets|errors|dropped|collisions)/
        || ($metric_prefix =~ /_cpustat$/
            && $key =~ /^(user|system|idle|nice|steal|guest|irq|softirq|iowait|wait)$/)
        || $metric_prefix =~ /_network$/
    ) {
        return ('counter', '_total');
    }

    # Gauge type (instantaneous values) - no suffix
    return ('gauge', '');
}

sub _convert_node_metrics_recursive {
    my ($class, $data, $ctime, $metric_prefix, $attributes) = @_;

    my @metrics = ();

    # Skip non-metric fields
    my $skip_fields = {
        name => 1,
        tags => 1,
        vmid => 1,
        type => 1,
        status => 1,
        template => 1,
        pid => 1,
        agent => 1,
        serial => 1,
        ctime => 1,
        nics => 1, # Skip nics - handled separately with device labels
        storages => 1, # Skip storages - handled separately with storage labels
    };

    # Unit mapping for common metrics
    my $unit_mapping = {
        # Memory and storage (bytes)
        mem => 'bytes',
        memory => 'bytes',
        swap => 'bytes',
        disk => 'bytes',
        size => 'bytes',
        used => 'bytes',
        free => 'bytes',
        total => 'bytes',
        avail => 'bytes',
        available => 'bytes',
        arcsize => 'bytes',
        blocks => 'bytes',
        bavail => 'bytes',
        bfree => 'bytes',

        # Network (bytes)
        net => 'bytes',
        receive => 'bytes',
        transmit => 'bytes',
        netin => 'bytes',
        netout => 'bytes',
        diskread => 'bytes',
        diskwrite => 'bytes',

        # CPU and time
        cpu => 'percent',
        wait => 'seconds',
        iowait => 'seconds',
        user => 'seconds',
        system => 'seconds',
        idle => 'seconds',
        nice => 'seconds',
        steal => 'seconds',
        guest => 'seconds',
        irq => 'seconds',
        softirq => 'seconds',
        uptime => 'seconds',

        # Time measurements (nanoseconds)
        time_ns => 'seconds',
        total_time_ns => 'seconds',

        # Load average (dimensionless)
        avg => '1',
        avg1 => '1',
        avg5 => '1',
        avg15 => '1',

        # Counters and ratios (dimensionless)
        cpus => '1',
        operations => '1',
        merged => '1',
        ratio => '1',
        count => '1',

        # File system (files are counted, not sized)
        files => '1',
        ffree => '1',
        fused => '1',
        favail => '1',

        # Percentages (dimensionless 0-100 scale)
        per => 'percent',
        fper => 'percent',
        percent => 'percent',

        # Boolean-like flags (dimensionless)
        enabled => '1',
        shared => '1',
        active => '1',
    };

    for my $key (sort keys %$data) {
        next if $skip_fields->{$key};
        my $value = $data->{$key};
        next if !defined($value);

        # Classify metric type and get suffix
        my ($metric_type, $suffix) = $class->_classify_metric_type($key, $metric_prefix);
        my $metric_name = "${metric_prefix}_${key}${suffix}";

        if (ref($value) eq 'HASH') {
            # Recursive call for nested hashes
            push @metrics,
                $class->_convert_node_metrics_recursive(
                    $value, $ctime, "${metric_prefix}_${key}", $attributes,
                );
        } elsif (
            !ref($value)
            && $value ne ''
            && $value =~ /^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$/
        ) {
            # Numeric value - create metric
            my $unit = '1'; # default unit

            # Try to determine unit based on key name
            for my $pattern (keys %$unit_mapping) {
                if ($key =~ /\Q$pattern\E/) {
                    $unit = $unit_mapping->{$pattern};
                    last;
                }
            }

            # Determine if it's an integer or double
            my $data_point = {
                timeUnixNano => $ctime * 1_000_000_000,
                attributes => $attributes,
            };

            if ($value =~ /\./ || $value =~ /[eE]/) {
                $data_point->{asDouble} = $value + 0; # Convert to number
            } else {
                $data_point->{asInt} = int($value);
            }

            # Create metric with appropriate type
            my $metric = {
                name => $metric_name,
                unit => $unit,
            };

            if ($metric_type eq 'counter') {
                $metric->{sum} = {
                    dataPoints => [$data_point],
                    aggregationTemporality => 2, # AGGREGATION_TEMPORALITY_CUMULATIVE
                    isMonotonic => \1 # JSON boolean true
                };
            } else {
                $metric->{gauge} = { dataPoints => [$data_point] };
            }

            push @metrics, $metric;
        }
    }

    return @metrics;
}

sub update_node_status {
    my ($class, $txn, $node, $data, $ctime) = @_;

    my @metrics = ();
    my $base_attributes = [{ key => 'node', value => { stringValue => $node } }];

    # Convert all node metrics recursively
    push @metrics,
        $class->_convert_node_metrics_recursive($data, $ctime, 'proxmox_node', $base_attributes);

    # Handle special cases that need different attributes
    # Network metrics with device labels
    if (defined $data->{nics}) {
        for my $iface (keys %{ $data->{nics} }) {
            my $nic_attributes = [
                { key => 'node', value => { stringValue => $node } },
                { key => 'device', value => { stringValue => $iface } },
            ];

            # Use recursive processing for network metrics with device-specific attributes
            push @metrics,
                $class->_convert_node_metrics_recursive(
                    $data->{nics}->{$iface},
                    $ctime,
                    'proxmox_node_network',
                    $nic_attributes,
                );
        }
    }

    # Storage metrics with storage labels
    if (defined $data->{storages}) {
        for my $storage (keys %{ $data->{storages} }) {
            my $storage_attributes = [
                { key => 'node', value => { stringValue => $node } },
                { key => 'storage', value => { stringValue => $storage } },
            ];

            # Use recursive processing for storage metrics with storage-specific attributes
            push @metrics,
                $class->_convert_node_metrics_recursive(
                    $data->{storages}->{$storage},
                    $ctime,
                    'proxmox_node_storage',
                    $storage_attributes,
                );
        }
    }

    push @{ $txn->{metrics} }, @metrics;
}

sub update_qemu_status {
    my ($class, $txn, $vmid, $data, $ctime, $nodename) = @_;

    my @metrics = ();
    my $vm_attributes = [
        { key => 'vmid', value => { stringValue => $vmid } },
        { key => 'node', value => { stringValue => $nodename } },
        { key => 'name', value => { stringValue => $data->{name} || '' } },
        { key => 'type', value => { stringValue => 'qemu' } },
    ];

    # Use recursive processing for all VM metrics
    push @metrics,
        $class->_convert_node_metrics_recursive($data, $ctime, 'proxmox_vm', $vm_attributes);

    push @{ $txn->{metrics} }, @metrics;
}

sub update_lxc_status {
    my ($class, $txn, $vmid, $data, $ctime, $nodename) = @_;

    my @metrics = ();
    my $vm_attributes = [
        { key => 'vmid', value => { stringValue => $vmid } },
        { key => 'node', value => { stringValue => $nodename } },
        { key => 'name', value => { stringValue => $data->{name} || '' } },
        { key => 'type', value => { stringValue => 'lxc' } },
    ];

    # Use recursive processing for all LXC metrics
    push @metrics,
        $class->_convert_node_metrics_recursive($data, $ctime, 'proxmox_vm', $vm_attributes);

    push @{ $txn->{metrics} }, @metrics;
}

sub update_storage_status {
    my ($class, $txn, $nodename, $storeid, $data, $ctime) = @_;

    my @metrics = ();
    my $storage_attributes = [
        { key => 'node', value => { stringValue => $nodename } },
        { key => 'storage', value => { stringValue => $storeid } },
    ];

    # Use recursive processing for all storage metrics
    push @metrics,
        $class->_convert_node_metrics_recursive(
            $data, $ctime, 'proxmox_storage', $storage_attributes,
        );

    push @{ $txn->{metrics} }, @metrics;
}

sub flush_data {
    my ($class, $txn) = @_;

    return if !$txn->{connection};
    return if !$txn->{metrics} || !@{ $txn->{metrics} };

    my $metrics = delete $txn->{metrics};
    $txn->{metrics} = [];

    eval {
        $class->_send_metrics_batched($txn->{connection}, $metrics, $txn->{cfg});
        $txn->{stats}->{successful_batches}++;
    };

    if (my $err = $@) {
        $txn->{stats}->{failed_batches}++;
        die "OpenTelemetry export failed '$txn->{id}': $err";
    }
}

sub _send_metrics_batched {
    my ($class, $connection, $metrics, $cfg) = @_;

    my $max_body_size = $cfg->{'otel-max-body-size'} || 10_000_000;
    my $total_metrics = @$metrics;

    # Estimate metrics per batch based on size heuristics
    my $estimated_batch_size = $class->_estimate_batch_size($metrics, $max_body_size, $cfg);

    # If estimated batch size covers all metrics, try sending everything at once
    if ($estimated_batch_size >= $total_metrics) {
        my $otlp_data = $class->_build_otlp_metrics($metrics, $cfg);
        my $serialized_size = $class->_get_serialized_size($otlp_data, $cfg);

        if ($serialized_size <= $max_body_size) {
            $class->send($connection, $otlp_data, $cfg);
            return;
        }
        # If estimation was wrong, fall through to batching
    }

    # Send in batches
    for (my $i = 0; $i < $total_metrics; $i += $estimated_batch_size) {
        my $end_idx = $i + $estimated_batch_size - 1;
        $end_idx = $total_metrics - 1 if $end_idx >= $total_metrics;

        my @batch_metrics = @$metrics[$i .. $end_idx];
        my $batch_otlp = $class->_build_otlp_metrics(\@batch_metrics, $cfg);

        # Verify batch size is within limits
        my $batch_size_bytes = $class->_get_serialized_size($batch_otlp, $cfg);
        if ($batch_size_bytes > $max_body_size) {
            # Fallback: send metrics one by one
            for my $single_metric (@batch_metrics) {
                my $single_otlp = $class->_build_otlp_metrics([$single_metric], $cfg);
                $class->send($connection, $single_otlp, $cfg);
            }
        } else {
            $class->send($connection, $batch_otlp, $cfg);
        }
    }
}

sub _estimate_batch_size {
    my ($class, $metrics, $max_body_size, $cfg) = @_;

    return 1 if @$metrics == 0;

    # Sample first few metrics to estimate size per metric
    my $sample_size = @$metrics > 10 ? 10 : @$metrics;
    my @sample_metrics = @$metrics[0 .. $sample_size - 1];

    my $sample_otlp = $class->_build_otlp_metrics(\@sample_metrics, $cfg);
    my $sample_bytes = $class->_get_serialized_size($sample_otlp, $cfg);

    # Calculate average bytes per metric with overhead
    my $bytes_per_metric = $sample_bytes / $sample_size;

    # Add 20% safety margin for OTLP structure overhead
    $bytes_per_metric *= 1.2;

    # Calculate how many metrics fit in max_body_size
    my $estimated_count = int($max_body_size / $bytes_per_metric);

    # Ensure at least 1 metric per batch, and cap at total metrics
    $estimated_count = 1 if $estimated_count < 1;
    $estimated_count = @$metrics if $estimated_count > @$metrics;

    return $estimated_count;
}

sub _get_serialized_size {
    my ($class, $data, $cfg) = @_;

    my $serialized;
    if (($cfg->{'otel-compression'} // 'gzip') eq 'gzip') {
        $serialized = $class->_compress_json($data);
    } else {
        $serialized = JSON->new->utf8->encode($data);
    }

    return length($serialized);
}

sub send {
    my ($class, $connection, $data, $cfg) = @_;

    my $ua = LWP::UserAgent->new(
        timeout => $cfg->{'otel-timeout'} || 5,
        ssl_opts => { verify_hostname => $cfg->{'otel-verify-ssl'} // 1 },
    );

    my $url = $class->_get_otlp_url($cfg);

    my $request_data;
    my %headers = (
        'Content-Type' => 'application/json',
    );

    # Safely add parsed headers
    my $parsed_headers = $class->_parse_headers($cfg->{'otel-headers'});
    if ($parsed_headers && ref($parsed_headers) eq 'HASH') {
        %headers = (%headers, %$parsed_headers);
    }

    if (($cfg->{'otel-compression'} // 'gzip') eq 'gzip') {
        $request_data = $class->_compress_json($data);
        $headers{'Content-Encoding'} = 'gzip';
    } else {
        $request_data = JSON->new->utf8->encode($data);
    }

    my $req = HTTP::Request->new('POST', $url, [%headers], $request_data);

    my $response = $ua->request($req);
    die "OTLP request failed: " . $response->status_line unless $response->is_success;
}

sub test_connection {
    my ($class, $cfg) = @_;

    my $ua = LWP::UserAgent->new(
        timeout => $cfg->{'otel-timeout'} || 5,
        ssl_opts => { verify_hostname => $cfg->{'otel-verify-ssl'} // 1 },
    );

    my $url = $class->_get_otlp_url($cfg);

    # Send empty metrics payload for testing
    my $test_data = {
        resourceMetrics => [{
            resource => { attributes => [] },
            scopeMetrics => [{
                scope => {},
                metrics => [],
            }],
        }],
    };

    my $request_data;
    my %headers = (
        'Content-Type' => 'application/json',
    );

    # Safely add parsed headers
    my $parsed_headers = $class->_parse_headers($cfg->{'otel-headers'});
    if ($parsed_headers && ref($parsed_headers) eq 'HASH') {
        %headers = (%headers, %$parsed_headers);
    }

    if (($cfg->{'otel-compression'} // 'gzip') eq 'gzip') {
        $request_data = $class->_compress_json($test_data);
        $headers{'Content-Encoding'} = 'gzip';
    } else {
        $request_data = JSON->new->utf8->encode($test_data);
    }

    my $req = HTTP::Request->new('POST', $url, [%headers], $request_data);

    my $response = $ua->request($req);
    die "Connection test failed: " . $response->status_line unless $response->is_success;

    return 1;
}

1;
