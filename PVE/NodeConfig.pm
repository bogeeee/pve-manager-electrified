package PVE::NodeConfig;

use strict;
use warnings;

use PVE::CertHelpers;
use PVE::JSONSchema qw(get_standard_option);
use PVE::Tools qw(file_get_contents file_set_contents lock_file);
use PVE::ACME;

use PVE::API2::ACMEPlugin;

# register up to 5 domain names per node for now
my $MAXDOMAINS = 5;

my $node_config_lock = '/var/lock/pvenode.lock';

PVE::JSONSchema::register_format(
    'pve-acme-domain',
    sub {
        my ($domain, $noerr) = @_;

        my $label = qr/[a-z0-9][a-z0-9_-]*/i;

        return $domain if $domain =~ /^$label(?:\.$label)+$/;
        return undef if $noerr;
        die "value '$domain' does not look like a valid domain name!\n";
    },
);

PVE::JSONSchema::register_format(
    'pve-acme-alias',
    sub {
        my ($alias, $noerr) = @_;

        my $label = qr/[a-z0-9_][a-z0-9_-]*/i;

        return $alias if $alias =~ /^$label(?:\.$label)+$/;
        return undef if $noerr;
        die "value '$alias' does not look like a valid alias name!\n";
    },
);

sub config_file {
    my ($node) = @_;

    return "/etc/pve/nodes/${node}/config";
}

sub load_config {
    my ($node) = @_;

    my $filename = config_file($node);
    my $raw = eval { PVE::Tools::file_get_contents($filename); };
    return {} if !$raw;

    return parse_node_config($raw, $filename);
}

sub write_config {
    my ($node, $conf) = @_;

    my $filename = config_file($node);

    my $raw = write_node_config($conf);

    PVE::Tools::file_set_contents($filename, $raw);
}

sub lock_config {
    my ($node, $realcode, @param) = @_;

    # make sure configuration file is up-to-date
    my $code = sub {
        PVE::Cluster::cfs_update();
        $realcode->(@_);
    };

    my $res = lock_file($node_config_lock, 10, $code, @param);

    die $@ if $@;

    return $res;
}

my $confdesc = {
    description => {
        type => 'string',
        description => "Description for the Node. Shown in the web-interface node notes panel."
            . " This is saved as comment inside the configuration file.",
        maxLength => 64 * 1024,
        optional => 1,
    },
    'startall-onboot-delay' => {
        description =>
            'Initial delay in seconds, before starting all the Virtual Guests with on-boot enabled.',
        type => 'integer',
        minimum => 0,
        maximum => 300,
        default => 0,
        optional => 1,
    },
    'ballooning-target' => {
        description => 'RAM usage target for ballooning (in percent of total memory)',
        type => 'integer',
        minimum => 0,
        maximum => 100,
        default => 80,
        optional => 1,
    },
};

my $wakeonlan_desc = {
    mac => {
        type => 'string',
        description => 'MAC address for wake on LAN',
        format => 'mac-addr',
        format_description => 'MAC address',
        default_key => 1,
    },
    'bind-interface' => {
        type => 'string',
        description => 'Bind to this interface when sending wake on LAN packet',
        default => 'The interface carrying the default route',
        format => 'pve-iface',
        format_description => 'bind interface',
        optional => 1,
    },
    'broadcast-address' => {
        type => 'string',
        description => 'IPv4 broadcast address to use when sending wake on LAN packet',
        default => '255.255.255.255',
        format => 'ipv4',
        format_description => 'IPv4 broadcast address',
        optional => 1,
    },
};

$confdesc->{wakeonlan} = {
    type => 'string',
    description => 'Node specific wake on LAN settings.',
    format => $wakeonlan_desc,
    optional => 1,
};

my $acme_domain_desc = {
    domain => {
        type => 'string',
        format => 'pve-acme-domain',
        format_description => 'domain',
        description => 'domain for this node\'s ACME certificate',
        default_key => 1,
    },
    plugin => {
        type => 'string',
        format => 'pve-configid',
        description => 'The ACME plugin ID',
        format_description => 'name of the plugin configuration',
        optional => 1,
        default => 'standalone',
    },
    alias => {
        type => 'string',
        format => 'pve-acme-alias',
        format_description => 'domain',
        description => 'Alias for the Domain to verify ACME Challenge over DNS',
        optional => 1,
    },
};

my $acmedesc = {
    account => get_standard_option('pve-acme-account-name'),
    domains => {
        type => 'string',
        format => 'pve-acme-domain-list',
        format_description => 'domain[;domain;...]',
        description => 'List of domains for this node\'s ACME certificate',
        optional => 1,
    },
};

$confdesc->{acme} = {
    type => 'string',
    description => 'Node specific ACME settings.',
    format => $acmedesc,
    optional => 1,
};

for my $i (0 .. $MAXDOMAINS) {
    $confdesc->{"acmedomain$i"} = {
        type => 'string',
        description => 'ACME domain and validation plugin',
        format => $acme_domain_desc,
        optional => 1,
    };
}

my $conf_schema = {
    type => 'object',
    properties => $confdesc,
};

sub parse_node_config : prototype($$) {
    my ($content, $filename) = @_;

    return undef if !defined($content);
    my $digest = Digest::SHA::sha1_hex($content);

    my $conf = PVE::JSONSchema::parse_config($conf_schema, $filename, $content, 'description');
    $conf->{digest} = $digest;

    return $conf;
}

sub write_node_config {
    my ($conf) = @_;

    my $raw = '';
    # add description as comment to top of file
    my $descr = $conf->{description} || '';
    foreach my $cl (split(/\n/, $descr)) {
        $raw .= '#' . PVE::Tools::encode_text($cl) . "\n";
    }

    for my $key (sort keys %$conf) {
        next if ($key eq 'description');
        next if ($key eq 'digest');

        my $value = $conf->{$key};
        die "detected invalid newline inside property '$key'\n"
            if $value =~ m/\n/;
        $raw .= "$key: $value\n";
    }

    return $raw;
}

sub get_wakeonlan_config {
    my ($node_conf) = @_;

    $node_conf //= {};

    my $res = {};
    if (defined($node_conf->{wakeonlan})) {
        $res = eval {
            PVE::JSONSchema::parse_property_string($wakeonlan_desc, $node_conf->{wakeonlan});
        };
        die $@ if $@;
    }

    return $res;
}

# we always convert domain values to lower case, since DNS entries are not case
# sensitive and ACME implementations might convert the ordered identifiers
# to lower case
sub get_acme_conf {
    my ($node_conf, $noerr) = @_;

    $node_conf //= {};

    my $res = {};
    if (defined($node_conf->{acme})) {
        $res = eval { PVE::JSONSchema::parse_property_string($acmedesc, $node_conf->{acme}) };
        if (my $err = $@) {
            return undef if $noerr;
            die $err;
        }
        my $standalone_domains = delete($res->{domains}) // '';
        $res->{domains} = {};
        for my $domain (split(";", $standalone_domains)) {
            $domain = lc($domain);
            die "duplicate domain '$domain' in ACME config properties\n"
                if defined($res->{domains}->{$domain});

            $res->{domains}->{$domain}->{plugin} = 'standalone';
            $res->{domains}->{$domain}->{_configkey} = 'acme';
        }
    }

    $res->{account} //= 'default';

    for my $index (0 .. $MAXDOMAINS) {
        my $domain_rec = $node_conf->{"acmedomain$index"};
        next if !defined($domain_rec);

        my $parsed =
            eval { PVE::JSONSchema::parse_property_string($acme_domain_desc, $domain_rec) };
        if (my $err = $@) {
            return undef if $noerr;
            die $err;
        }
        my $domain = lc(delete $parsed->{domain});
        if (my $exists = $res->{domains}->{$domain}) {
            return undef if $noerr;
            die "duplicate domain '$domain' in ACME config properties"
                . " 'acmedomain$index' and '$exists->{_configkey}'\n";
        }
        $parsed->{plugin} //= 'standalone';

        my $plugin_id = $parsed->{plugin};
        if ($plugin_id ne 'standalone') {
            my $plugins = PVE::API2::ACMEPlugin::load_config();
            die "plugin '$plugin_id' for domain '$domain' not found!\n"
                if !$plugins->{ids}->{$plugin_id};
        }

        $parsed->{_configkey} = "acmedomain$index";
        $res->{domains}->{$domain} = $parsed;
    }

    return $res;
}

# expects that basic format verification was already done, this is more higher
# level verification
sub verify_conf {
    my ($node_conf) = @_;

    # verify ACME domain uniqueness
    my $tmp = get_acme_conf($node_conf);

    # TODO: what else?

    return 1; # OK
}

sub get_nodeconfig_schema {
    return $confdesc;
}

1;
