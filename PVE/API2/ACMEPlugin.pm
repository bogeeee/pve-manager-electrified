package PVE::API2::ACMEPlugin;

use strict;
use warnings;

use MIME::Base64;
use Storable qw(dclone);

use PVE::ACME::Challenge;
use PVE::ACME::DNSChallenge;
use PVE::ACME::StandAlone;
use PVE::Cluster qw(cfs_read_file cfs_write_file cfs_register_file cfs_lock_file);
use PVE::JSONSchema qw(register_standard_option get_standard_option);
use PVE::Tools qw(extract_param);

use base qw(PVE::RESTHandler);

my $plugin_config_file = "priv/acme/plugins.cfg";

cfs_register_file(
    $plugin_config_file,
    sub { PVE::ACME::Challenge->parse_config(@_); },
    sub { PVE::ACME::Challenge->write_config(@_); },
);

PVE::ACME::DNSChallenge->register();
PVE::ACME::StandAlone->register();
PVE::ACME::Challenge->init();

PVE::JSONSchema::register_standard_option(
    'pve-acme-pluginid',
    {
        type => 'string',
        format => 'pve-configid',
        description => 'Unique identifier for ACME plugin instance.',
    },
);

my $plugin_type_enum = PVE::ACME::Challenge->lookup_types();

my $modify_cfg_for_api = sub {
    my ($cfg, $pluginid) = @_;

    die "ACME plugin '$pluginid' not defined\n" if !defined($cfg->{ids}->{$pluginid});

    my $plugin_cfg = dclone($cfg->{ids}->{$pluginid});
    $plugin_cfg->{plugin} = $pluginid;
    $plugin_cfg->{digest} = $cfg->{digest};

    return $plugin_cfg;
};

my $acme_challenge_create_schema = PVE::ACME::Challenge->createSchema();
my $acme_challenge_return_schema = {
    type => "object",
    properties => {
        PVE::ACME::Challenge->createSchema()->{properties}->%*,
        digest => get_standard_option('pve-config-digest'),
        plugin => get_standard_option('pve-acme-pluginid'),
    },
};
# replaced by plugin property
delete $acme_challenge_return_schema->{properties}->{id};

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    description => "ACME plugin index.",
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            type => {
                description => "Only list ACME plugins of a specific type",
                type => 'string',
                enum => $plugin_type_enum,
                optional => 1,
            },
        },
    },
    returns => {
        type => 'array',
        items => $acme_challenge_return_schema,
        links => [{ rel => 'child', href => "{plugin}" }],
    },
    code => sub {
        my ($param) = @_;

        my $cfg = load_config();

        my $res = [];
        foreach my $pluginid (keys %{ $cfg->{ids} }) {
            my $plugin_cfg = $modify_cfg_for_api->($cfg, $pluginid);
            next if $param->{type} && $param->{type} ne $plugin_cfg->{type};
            push @$res, $plugin_cfg;
        }

        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'get_plugin_config',
    path => '{id}',
    method => 'GET',
    description => "Get ACME plugin configuration.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-acme-pluginid'),
        },
    },
    returns => $acme_challenge_return_schema,
    code => sub {
        my ($param) = @_;

        my $cfg = load_config();
        return $modify_cfg_for_api->($cfg, $param->{id});
    },
});

__PACKAGE__->register_method({
    name => 'add_plugin',
    path => '',
    method => 'POST',
    description => "Add ACME plugin configuration.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    protected => 1,
    parameters => $acme_challenge_create_schema,
    returns => {
        type => "null",
    },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');
        my $type = extract_param($param, 'type');

        cfs_lock_file(
            $plugin_config_file,
            undef,
            sub {
                my $cfg = load_config();
                die "ACME plugin ID '$id' already exists\n" if defined($cfg->{ids}->{$id});

                my $plugin = PVE::ACME::Challenge->lookup($type);
                my $opts = $plugin->check_config($id, $param, 1, 1);

                $cfg->{ids}->{$id} = $opts;
                $cfg->{ids}->{$id}->{type} = $type;

                cfs_write_file($plugin_config_file, $cfg);
            },
        );
        die "$@" if $@;

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'update_plugin',
    path => '{id}',
    method => 'PUT',
    description => "Update ACME plugin configuration.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    protected => 1,
    parameters => PVE::ACME::Challenge->updateSchema(),
    returns => {
        type => "null",
    },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');
        my $delete = extract_param($param, 'delete');
        my $digest = extract_param($param, 'digest');

        cfs_lock_file(
            $plugin_config_file,
            undef,
            sub {
                my $cfg = load_config();
                PVE::Tools::assert_if_modified($cfg->{digest}, $digest);
                my $plugin_cfg = $cfg->{ids}->{$id};
                die "ACME plugin ID '$id' does not exist\n" if !$plugin_cfg;

                my $type = $plugin_cfg->{type};
                my $plugin = PVE::ACME::Challenge->lookup($type);

                if (defined($delete)) {
                    my $schema = $plugin->private();
                    my $options = $schema->{options}->{$type};
                    for my $k (PVE::Tools::split_list($delete)) {
                        my $d = $options->{$k} || die "no such option '$k'\n";
                        die "unable to delete required option '$k'\n" if !$d->{optional};

                        delete $cfg->{ids}->{$id}->{$k};
                    }
                }

                my $opts = $plugin->check_config($id, $param, 0, 1);
                for my $k (sort keys %$opts) {
                    $plugin_cfg->{$k} = $opts->{$k};
                }

                cfs_write_file($plugin_config_file, $cfg);
            },
        );
        die "$@" if $@;

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'delete_plugin',
    path => '{id}',
    method => 'DELETE',
    description => "Delete ACME plugin configuration.",
    permissions => {
        check => ['perm', '/', ['Sys.Modify']],
    },
    protected => 1,
    parameters => {
        additionalProperties => 0,
        properties => {
            id => get_standard_option('pve-acme-pluginid'),
        },
    },
    returns => {
        type => "null",
    },
    code => sub {
        my ($param) = @_;

        my $id = extract_param($param, 'id');

        cfs_lock_file(
            $plugin_config_file,
            undef,
            sub {
                my $cfg = load_config();

                delete $cfg->{ids}->{$id};

                cfs_write_file($plugin_config_file, $cfg);
            },
        );
        die "$@" if $@;

        return undef;
    },
});

sub load_config {
    # auto-adds the standalone plugin if no config is there for backwards
    # compatibility, so ALWAYS call the cfs registered parser
    return cfs_read_file($plugin_config_file);
}

1;
