package PVE::API2::Ceph::Cfg;

use strict;
use warnings;

use PVE::Ceph::Tools;
use PVE::Cluster qw(cfs_read_file);
use PVE::JSONSchema qw(get_standard_option);
use PVE::RADOS;
use PVE::Tools qw(file_get_contents);

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    description => "Directory index.",
    permissions => { user => 'all' },
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => "object",
            properties => {},
        },
        links => [{ rel => 'child', href => "{name}" }],
    },
    code => sub {
        my ($param) = @_;

        my $result = [
            { name => 'raw' }, { name => 'db' }, { name => 'value' },
        ];

        return $result;
    },
});

__PACKAGE__->register_method({
    name => 'raw',
    path => 'raw',
    method => 'GET',
    proxyto => 'node',
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    description => "Get the Ceph configuration file.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => { type => 'string' },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $path = PVE::Ceph::Tools::get_config('pve_ceph_cfgpath');
        return file_get_contents($path);

    },
});

__PACKAGE__->register_method({
    name => 'db',
    path => 'db',
    method => 'GET',
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit', 'Datastore.Audit'], any => 1],
    },
    description => "Get the Ceph configuration database.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => {
            type => 'object',
            additionalProperties => 1,
            properties => {
                section => {
                    type => "string",
                    description =>
                        "Ceph config section the entry applies to: 'global', a daemon"
                        . " type ('mon', 'osd', 'mgr', 'mds', 'client'), or a specific"
                        . " daemon (e.g. 'osd.0', 'mon.<name>').",
                },
                name => {
                    type => "string",
                    description => "Config key name.",
                },
                value => {
                    type => "string",
                    description => "Configured value for the key (always serialised as a string"
                        . " by Ceph, regardless of the option's underlying type).",
                },
                level => {
                    type => "string",
                    enum => ['basic', 'advanced', 'dev'],
                    description => "Config level the entry is exposed at: 'basic' for"
                        . " operator-visible settings, 'advanced' for tuning parameters,"
                        . " 'dev' for developer-only knobs.",
                },
                'can_update_at_runtime' => {
                    type => "boolean",
                    description =>
                        "Set if the value can be changed at runtime without restarting"
                        . " the affected daemons. Emitted as the integer 1/0 to match the"
                        . " existing PVE wire convention.",
                },
                mask => {
                    type => "string",
                    description => "Match expression restricting the entry's scope; empty when"
                        . " the entry has no mask. Examples: 'host:foo', 'class:ssd'.",
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        my $rados = PVE::RADOS->new();
        my $res = $rados->mon_command({ prefix => 'config dump', format => 'json' });
        foreach my $entry (@$res) {
            $entry->{can_update_at_runtime} = $entry->{can_update_at_runtime} ? 1 : 0; # JSON::true/false -> 1/0
        }

        return $res;
    },
});

my $SINGLE_CONFIGKEY_RE = qr/[0-9a-z\-_\.]+:[0-9a-zA-Z\-_]+/i;
my $CONFIGKEYS_RE = qr/^(?:${SINGLE_CONFIGKEY_RE})(?:[;, ]${SINGLE_CONFIGKEY_RE})*$/;

__PACKAGE__->register_method({
    name => 'value',
    path => 'value',
    method => 'GET',
    proxyto => 'node',
    protected => 1,
    permissions => {
        check => ['perm', '/', ['Sys.Audit']],
    },
    description => "Get configured values from either ceph.conf or the mon config DB."
        . " Underscores in section and key names are normalised to hyphens in the response,"
        . " regardless of how they're written in the source.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            'config-keys' => {
                type => "string",
                typetext => "<section>:<config key>[;|,| <section>:<config key>]",
                pattern => $CONFIGKEYS_RE,
                maxLength => 4096,
                description => "List of <section>:<config key> items separated by"
                    . " semicolon, comma or space.",
            },
        },
    },
    returns => {
        type => 'object',
        description => "Two-level map of {section} -> {key} -> value. Underscores in"
            . " section and key names are normalised to hyphens.",
    },
    code => sub {
        my ($param) = @_;

        PVE::Ceph::Tools::check_ceph_inited();

        # Ceph treats '-' and '_' the same in parameter names, stick with '-'
        my $normalize = sub {
            my $t = shift;
            $t =~ s/_/-/g;
            return $t;
        };

        my $requested_keys = {};
        for my $pair (PVE::Tools::split_list($param->{'config-keys'})) {
            my ($section, $key) = split(":", $pair);
            $section = $normalize->($section);
            $key = $normalize->($key);

            $requested_keys->{$section}->{$key} = 1;
        }

        my $config = {};

        my $rados = PVE::RADOS->new();
        my $configdb = $rados->mon_command({ prefix => 'config dump', format => 'json' });
        for my $s (@{$configdb}) {
            my ($section, $name, $value) = $s->@{ 'section', 'name', 'value' };
            my $n_section = $normalize->($section);
            my $n_name = $normalize->($name);

            $config->{$n_section}->{$n_name} = $value
                if $requested_keys->{$n_section}->{$n_name};
        }

        # read ceph.conf after config db as it has priority if settings are present in both
        my $config_file = cfs_read_file('ceph.conf'); # cfs_read_file to get it parsed
        for my $section (keys %{$config_file}) {
            my $n_section = $normalize->($section);
            next if !defined $requested_keys->{$n_section};

            for my $key (keys %{ $config_file->{$section} }) {
                my $n_key = $normalize->($key);
                $config->{$n_section}->{$n_key} = $config_file->{$section}->{$key}
                    if $requested_keys->{$n_section}->{$n_key};
            }
        }

        return $config;
    },
});
