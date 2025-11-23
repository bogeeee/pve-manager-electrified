package PVE::Status::Plugin;

use strict;
use warnings;

use PVE::JSONSchema;
use PVE::Cluster qw(cfs_register_file);
use PVE::SectionConfig;

use base qw(PVE::SectionConfig);

cfs_register_file(
    'status.cfg',
    sub { __PACKAGE__->parse_config(@_); },
    sub { __PACKAGE__->write_config(@_); },
);

my $defaultData = {
    propertyList => {
        id => {
            description => "The ID of the entry.",
            type => 'string',
            format => 'pve-configid',
        },
        type => {
            description => "Plugin type.",
            type => 'string',
            format => 'pve-configid',
        },
        disable => {
            description => "Flag to disable the plugin.",
            type => 'boolean',
            optional => 1,
        },
        server => {
            type => 'string',
            format => 'address',
            description => "server dns name or IP address",
        },
        port => {
            type => 'integer',
            description => "server network port",
            minimum => 1,
            maximum => 64 * 1024,
        },
        mtu => {
            type => 'integer',
            description => "MTU for metrics transmission over UDP",
            default => 1500,
            minimum => 512,
            maximum => 64 * 1024,
            optional => 1,
        },
    },
};

sub private {
    return $defaultData;
}

sub parse_section_header {
    my ($class, $line) = @_;

    if ($line =~ m/^(\S+):\s*(\S+)?\s*$/) {
        my $type = lc($1);
        my $id = $2 // $type;
        my $errmsg = undef; # set if you want to skip whole section
        eval { PVE::JSONSchema::pve_verify_configid($id) };
        $errmsg = $@ if $@;
        my $config = {}; # to return additional attributes
        return ($type, $id, $errmsg, $config);
    }
    return undef;
}

sub _connect {
    my ($class, $cfg, $id) = @_;
    die "please implement inside plugin";
}

sub _disconnect {
    my ($class, $connection, $cfg) = @_;

    $connection->close(); # overwrite if not a simple socket
}

# UDP cannot do more than 64k at once. Overwrite for different protocol limits.
sub _send_batch_size {
    my ($class, $cfg) = @_;

    # default to 1500 MTU, empty IPv6 UDP packet needs 48 bytes overhead
    my $mtu = $cfg->{mtu} // 1500;
    return $mtu - 50; # a bit more than 48byte to allow for safe room
}

# call with the smallest $data chunks possible
sub add_metric_data {
    my ($class, $txn, $data) = @_;
    return if !defined($data);

    my $batch_size = $class->_send_batch_size($txn->{cfg});
    my $data_length = length($data) // 0;
    my $dataq_len = length($txn->{data}) // 0;

    if (($dataq_len + $data_length) >= $batch_size) {
        $class->flush_data($txn);
    }
    $txn->{data} //= '';
    $txn->{data} .= "$data";
}

sub flush_data {
    my ($class, $txn) = @_;

    if (!$txn->{connection}) {
        return if !$txn->{data}; # OK, if data was already sent/flushed
        die "cannot flush metric data, no connection available!\n";
    }
    return if !defined($txn->{data}) || $txn->{data} eq '';

    my $data = delete $txn->{data};
    eval { $class->send($txn->{connection}, $data, $txn->{cfg}) };
    die "metrics send error '$txn->{id}': $@" if $@;
}

sub send {
    my ($class, $connection, $data, $cfg) = @_;

    defined($connection->send($data))
        or die "failed to send metrics: $!\n";
}

sub test_connection {
    my ($class, $cfg, $id) = @_;

    # do not check connection for disabled plugins
    return if $cfg->{disable};

    my $conn = $class->_connect($cfg, $id);
    $class->_disconnect($conn, $cfg);
}

sub update_node_status {
    my ($class, $txn, $node, $data, $ctime) = @_;
    die "please implement inside plugin";
}

sub update_qemu_status {
    my ($class, $txn, $vmid, $data, $ctime, $nodename) = @_;
    die "please implement inside plugin";
}

sub update_lxc_status {
    my ($class, $txn, $vmid, $data, $ctime, $nodename) = @_;
    die "please implement inside plugin";
}

sub update_storage_status {
    my ($class, $txn, $nodename, $storeid, $data, $ctime) = @_;
    die "please implement inside plugin";
}

sub on_add_hook {
    my ($class, $id, $opts, $sensitive_opts) = @_;

    # implement in subclass

    return undef;
}

sub on_update_hook {
    my ($class, $id, $opts, $sensitive_opts) = @_;

    # implement in subclass

    return undef;
}

sub on_delete_hook {
    my ($class, $id, $opts) = @_;

    # implement in subclass

    return undef;
}

1;
