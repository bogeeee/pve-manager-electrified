package PVE::ExtMetric;

use strict;
use warnings;

use PVE::Status::Plugin;
use PVE::Status::Graphite;
use PVE::Status::InfluxDB;
use PVE::Status::OpenTelemetry;

PVE::Status::Graphite->register();
PVE::Status::InfluxDB->register();
PVE::Status::OpenTelemetry->register();
PVE::Status::Plugin->init();

sub foreach_plug($&) {
    my ($status_cfg, $code) = @_;

    for my $id (sort keys %{ $status_cfg->{ids} }) {
        my $plugin_config = $status_cfg->{ids}->{$id};
        next if $plugin_config->{disable};

        my $plugin = PVE::Status::Plugin->lookup($plugin_config->{type});
        $code->($plugin, $id, $plugin_config);
    }
}

sub update_all($$@) {
    my ($transactions, $subsystem, @params) = @_;

    my $method = "update_${subsystem}_status";

    for my $txn (@$transactions) {
        my $plugin = PVE::Status::Plugin->lookup($txn->{cfg}->{type});

        $plugin->$method($txn, @params);
    }
}

# must return a transaction hash with the format:
# {
#    cfg => $plugin_config,
#    connection => ..., # the connected socket
#    data => '', # payload, will be sent at the trannsaction flush
# }
sub transactions_start {
    my ($cfg) = @_;

    my $transactions = [];

    foreach_plug(
        $cfg,
        sub {
            my ($plugin, $id, $plugin_config) = @_;

            my $connection = $plugin->_connect($plugin_config, $id);

            push @$transactions,
                {
                    connection => $connection,
                    cfg => $plugin_config,
                    id => $id,
                    data => '',
                };
        },
    );

    return $transactions;
}

sub transactions_finish {
    my ($transactions) = @_;

    for my $txn (@$transactions) {
        my $plugin = PVE::Status::Plugin->lookup($txn->{cfg}->{type});

        eval { $plugin->flush_data($txn) };
        my $flush_err = $@;
        warn "$flush_err" if $flush_err;

        $plugin->_disconnect($txn->{connection}, $txn->{cfg});
        $txn->{connection} = undef;
        # avoid log spam, already got a send error; disconnect would fail too
        warn "disconnect failed: $@" if $@ && !$flush_err;
    }
}

1;
