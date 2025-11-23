package PVE::API2::Network;

use strict;
use warnings;

use Net::IP qw(:PROC);
use PVE::Tools qw(extract_param dir_glob_regex);
use PVE::SafeSyslog;
use PVE::INotify;
use PVE::Exception qw(raise_param_exc);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::JSONSchema qw(get_standard_option);
use PVE::AccessControl;
use PVE::Network;
use IO::File;

use base qw(PVE::RESTHandler);

my $have_sdn;
eval {
    require PVE::Network::SDN;
    $have_sdn = 1;
};

my $iflockfn = "/etc/network/.pve-interfaces.lock";

my $bond_mode_enum = [
    'balance-rr',
    'active-backup', # OVS and Linux
    'balance-xor',
    'broadcast',
    '802.3ad',
    'balance-tlb',
    'balance-alb',
    'balance-slb', # OVS
    'lacp-balance-slb', # OVS
    'lacp-balance-tcp', # OVS
];

my $network_type_enum = [
    'bridge',
    'bond',
    'eth',
    'alias',
    'vlan',
    'fabric',
    'OVSBridge',
    'OVSBond',
    'OVSPort',
    'OVSIntPort',
    'vnet',
];

my $confdesc = {
    type => {
        description => "Network interface type",
        type => 'string',
        enum => [@$network_type_enum, 'unknown'],
    },
    comments => {
        description => "Comments",
        type => 'string',
        optional => 1,
    },
    comments6 => {
        description => "Comments",
        type => 'string',
        optional => 1,
    },
    autostart => {
        description => "Automatically start interface on boot.",
        type => 'boolean',
        optional => 1,
    },
    bridge_vlan_aware => {
        description => "Enable bridge vlan support.",
        type => 'boolean',
        optional => 1,
    },
    bridge_vids => {
        description =>
            "Specify the allowed VLANs. For example: '2 4 100-200'. Only used if the bridge is VLAN aware.",
        optional => 1,
        type => 'string',
        format => 'pve-vlan-id-or-range-list',
    },
    bridge_ports => {
        description => "Specify the interfaces you want to add to your bridge.",
        optional => 1,
        type => 'string',
        format => 'pve-iface-list',
    },
    ovs_ports => {
        description => "Specify the interfaces you want to add to your bridge.",
        optional => 1,
        type => 'string',
        format => 'pve-iface-list',
    },
    ovs_tag => {
        description => "Specify a VLan tag (used by OVSPort, OVSIntPort, OVSBond)",
        optional => 1,
        type => 'integer',
        minimum => 1,
        maximum => 4094,
    },
    ovs_options => {
        description => "OVS interface options.",
        optional => 1,
        type => 'string',
        maxLength => 1024,
    },
    ovs_bridge => {
        description =>
            "The OVS bridge associated with a OVS port. This is required when you create an OVS port.",
        optional => 1,
        type => 'string',
        format => 'pve-iface',
    },
    slaves => {
        description => "Specify the interfaces used by the bonding device.",
        optional => 1,
        type => 'string',
        format => 'pve-iface-list',
    },
    ovs_bonds => {
        description => "Specify the interfaces used by the bonding device.",
        optional => 1,
        type => 'string',
        format => 'pve-iface-list',
    },
    bond_mode => {
        description => "Bonding mode.",
        optional => 1,
        type => 'string',
        enum => $bond_mode_enum,
    },
    'bond-primary' => {
        description => "Specify the primary interface for active-backup bond.",
        optional => 1,
        type => 'string',
        format => 'pve-iface',
    },
    bond_xmit_hash_policy => {
        description =>
            "Selects the transmit hash policy to use for slave selection in balance-xor and 802.3ad modes.",
        optional => 1,
        type => 'string',
        enum => ['layer2', 'layer2+3', 'layer3+4'],
    },
    'vlan-raw-device' => {
        description => "Specify the raw interface for the vlan interface.",
        optional => 1,
        type => 'string',
        format => 'pve-iface',
    },
    'vlan-id' => {
        description => "vlan-id for a custom named vlan interface (ifupdown2 only).",
        optional => 1,
        type => 'integer',
        minimum => 1,
        maximum => 4094,
    },
    gateway => {
        description => 'Default gateway address.',
        type => 'string',
        format => 'ipv4',
        optional => 1,
    },
    netmask => {
        description => 'Network mask.',
        type => 'string',
        format => 'ipv4mask',
        optional => 1,
        requires => 'address',
    },
    address => {
        description => 'IP address.',
        type => 'string',
        format => 'ipv4',
        optional => 1,
        requires => 'netmask',
    },
    cidr => {
        description => 'IPv4 CIDR.',
        type => 'string',
        format => 'CIDRv4',
        optional => 1,
    },
    mtu => {
        description => 'MTU.',
        optional => 1,
        type => 'integer',
        minimum => 1280,
        maximum => 65520,
    },
    gateway6 => {
        description => 'Default ipv6 gateway address.',
        type => 'string',
        format => 'ipv6',
        optional => 1,
    },
    netmask6 => {
        description => 'Network mask.',
        type => 'integer',
        minimum => 0,
        maximum => 128,
        optional => 1,
        requires => 'address6',
    },
    address6 => {
        description => 'IP address.',
        type => 'string',
        format => 'ipv6',
        optional => 1,
        requires => 'netmask6',
    },
    cidr6 => {
        description => 'IPv6 CIDR.',
        type => 'string',
        format => 'CIDRv6',
        optional => 1,
    },
};

sub json_config_properties {
    my $prop = shift;

    foreach my $opt (keys %$confdesc) {
        $prop->{$opt} = $confdesc->{$opt};
    }

    return $prop;
}

sub extract_altnames {
    my ($iface, $altnames) = @_;

    $altnames = PVE::Network::altname_mapping() if !defined($altnames);

    my $iface_altnames = [];
    my $original_iface;

    # when we get an altname, first extract the legacy iface name
    if (my $legacy_iface = $altnames->{$iface}) {
        push $iface_altnames->@*, $legacy_iface;
        $original_iface = $iface;
        $iface = $legacy_iface;
    }

    for my $altname (keys $altnames->%*) {
        next if defined($original_iface) && $original_iface eq $altname;
        if ($altnames->{$altname} eq $iface) {
            push $iface_altnames->@*, $altname;
        }
    }

    return [sort $iface_altnames->@*] if scalar($iface_altnames->@*) > 0;
    return undef;
}

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    permissions => { user => 'all' },
    description => "List available networks",
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            type => {
                description => "Only list specific interface types.",
                type => 'string',
                enum => [@$network_type_enum, 'any_bridge', 'any_local_bridge', 'include_sdn'],
                optional => 1,
            },
        },
    },
    returns => {
        type => "array",
        items => {
            type => "object",
            properties => json_config_properties({
                iface => get_standard_option('pve-iface'),
                active => {
                    type => 'boolean',
                    optional => 1,
                    description => "Set to true if the interface is active.",
                },
                'bridge-access' => {
                    type => 'integer',
                    optional => 1,
                    description => "The bridge port access VLAN.",
                },
                'bridge-learning' => {
                    type => 'boolean',
                    optional => 1,
                    description => "Bridge port learning flag.",
                },
                'bridge-arp-nd-suppress' => {
                    type => 'boolean',
                    optional => 1,
                    description => "Bridge port ARP/ND suppress flag.",
                },
                'bridge-unicast-flood' => {
                    type => 'boolean',
                    optional => 1,
                    description => "Bridge port unicast flood flag.",
                },
                'bridge-multicast-flood' => {
                    type => 'boolean',
                    optional => 1,
                    description => "Bridge port multicast flood flag.",
                },
                exists => {
                    type => 'boolean',
                    optional => 1,
                    description => "Set to true if the interface physically exists.",
                },
                families => {
                    type => "array",
                    description => "The network families.",
                    items => {
                        type => "string",
                        description => "A network family.",
                        enum => ["inet", "inet6"],
                    },
                    optional => 1,
                },
                'link-type' => {
                    type => 'string',
                    optional => 1,
                    description => "The link type.",
                },
                method => {
                    type => "string",
                    description => "The network configuration method for IPv4.",
                    enum => ["loopback", "dhcp", "manual", "static", "auto"],
                    optional => 1,
                },
                method6 => {
                    type => "string",
                    description => "The network configuration method for IPv6.",
                    enum => ["loopback", "dhcp", "manual", "static", "auto"],
                    optional => 1,
                },
                options => {
                    type => 'array',
                    optional => 1,
                    description => "A list of additional interface options for IPv4.",
                    items => {
                        type => "string",
                        description => "An interface property.",
                    },
                },
                options6 => {
                    type => 'array',
                    optional => 1,
                    description => "A list of additional interface options for IPv6.",
                    items => {
                        type => "string",
                        description => "An interface property.",
                    },
                },
                priority => {
                    type => 'integer',
                    description => "The order of the interface.",
                    optional => 1,
                },
                'uplink-id' => {
                    type => 'string',
                    optional => 1,
                    description => "The uplink ID.",
                },
                'vlan-protocol' => {
                    type => 'string',
                    optional => 1,
                    enum => [qw(802.1ad 802.1q)],
                    description => "The VLAN protocol.",
                },
                'vxlan-id' => {
                    type => 'integer',
                    optional => 1,
                    description => "The VXLAN ID.",
                },
                'vxlan-svcnodeip' => {
                    type => 'string',
                    optional => 1,
                    description => "The VXLAN SVC node IP.",
                },
                'vxlan-physdev' => {
                    type => 'string',
                    optional => 1,
                    description => "The physical device for the VXLAN tunnel.",
                },
                'vxlan-local-tunnelip' => {
                    type => 'string',
                    optional => 1,
                    description => "The VXLAN local tunnel IP.",
                },
            }),
        },
        links => [{ rel => 'child', href => "{iface}" }],
    },
    code => sub {
        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $tmp = PVE::INotify::read_file('interfaces', 1);
        my $config = $tmp->{data};
        my $changes = $tmp->{changes};

        $rpcenv->set_result_attrib('changes', $changes) if $changes;

        my $ifaces = $config->{ifaces};

        my $altnames = PVE::Network::altname_mapping();

        delete $ifaces->{lo}; # do not list the loopback device

        if (my $tfilter = $param->{type}) {
            my $vnets;
            my $fabrics;

            if ($have_sdn && $tfilter =~ /^(any_bridge|include_sdn|vnet)$/) {
                $vnets = PVE::Network::SDN::get_local_vnets(); # returns already access-filtered
            }

            if ($have_sdn && $tfilter =~ /^(include_sdn|fabric)$/) {
                my $local_node = PVE::INotify::nodename();

                $fabrics =
                    PVE::Network::SDN::Fabrics::config(1)->get_interfaces_for_node($local_node);
            }

            if ($tfilter ne 'include_sdn') {
                for my $k (sort keys $ifaces->%*) {
                    my $type = $ifaces->{$k}->{type};
                    my $is_bridge = $type eq 'bridge' || $type eq 'OVSBridge';
                    my $bridge_match = $is_bridge && $tfilter =~ /^any(_local)?_bridge$/;
                    my $match = $tfilter eq $type || $bridge_match;
                    delete $ifaces->{$k} if !$match;
                }
            }

            if (defined($vnets)) {
                $ifaces->{$_} = $vnets->{$_} for keys $vnets->%*;
            }

            if (defined($fabrics)) {
                for my $fabric_id (keys %$fabrics) {
                    next
                        if !$rpcenv->check_any(
                            $authuser,
                            "/sdn/fabrics/$fabric_id",
                            ['SDN.Audit', 'SDN.Use', 'SDN.Allocate'],
                            1,
                        );

                    $ifaces->{$fabric_id} = $fabrics->{$fabric_id};
                }
            }
        }

        #always check bridge access
        my $can_access_vnet = sub {
            return 1 if $authuser eq 'root@pam';
            return 1
                if $rpcenv->check_sdn_bridge(
                    $authuser, "localnetwork", $_[0], ['SDN.Audit', 'SDN.Use'], 1,
                );
        };
        for my $k (sort keys $ifaces->%*) {
            my $type = $ifaces->{$k}->{type};
            delete $ifaces->{$k}
                if ($type eq 'bridge' || $type eq 'OVSBridge') && !$can_access_vnet->($k);

            my $iface_altnames = extract_altnames($k, $altnames);
            $ifaces->{$k}->{altnames} = $iface_altnames if defined($iface_altnames);
        }

        return PVE::RESTHandler::hash_to_array($ifaces, 'iface');
    },
});

__PACKAGE__->register_method({
    name => 'revert_network_changes',
    path => '',
    method => 'DELETE',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    protected => 1,
    description => "Revert network configuration changes.",
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => { type => "null" },
    code => sub {
        my ($param) = @_;

        unlink "/etc/network/interfaces.new";

        return undef;
    },
});

my $check_duplicate = sub {
    my ($config, $newiface, $key, $name) = @_;

    foreach my $iface (keys %$config) {
        raise_param_exc({ $key => "$name already exists on interface '$iface'." })
            if ($newiface ne $iface) && $config->{$iface}->{$key};
    }
};

my $check_duplicate_gateway = sub {
    my ($config, $newiface) = @_;
    return &$check_duplicate($config, $newiface, 'gateway', 'Default gateway');
};

my $check_duplicate_gateway6 = sub {
    my ($config, $newiface) = @_;
    return &$check_duplicate($config, $newiface, 'gateway6', 'Default ipv6 gateway');
};

my $check_duplicate_ports = sub {
    my ($config, $newiface, $newparam) = @_;

    my $param_name;
    my $get_portlist = sub {
        my ($param) = @_;
        my $ports = '';
        for my $k (qw(bridge_ports ovs_ports slaves ovs_bonds)) {
            if ($param->{$k}) {
                $ports .= " $param->{$k}";
                $param_name //= $k;
            }
        }
        return PVE::Tools::split_list($ports);
    };

    my $new_ports = {};
    for my $p ($get_portlist->($newparam)) {
        $new_ports->{$p} = 1;
    }
    return if !(keys %$new_ports);

    for my $iface (keys %$config) {
        next if $iface eq $newiface;

        my $d = $config->{$iface};
        for my $p ($get_portlist->($d)) {
            raise_param_exc({ $param_name => "$p is already used on interface '$iface'." })
                if $new_ports->{$p};
        }
    }
};

sub ipv6_tobin {
    return Net::IP::ip_iptobin(Net::IP::ip_expand_address(shift, 6), 6);
}

my $check_ipv6_settings = sub {
    my ($address, $netmask) = @_;

    raise_param_exc({ netmask => "$netmask is not a valid subnet length for ipv6" })
        if $netmask < 0 || $netmask > 128;

    raise_param_exc({ address => "$address is not a valid host IPv6 address." })
        if !Net::IP::ip_is_ipv6($address);

    my $binip = ipv6_tobin($address);
    my $binmask = Net::IP::ip_get_mask($netmask, 6);

    my $type = ($binip eq $binmask) ? 'ANYCAST' : Net::IP::ip_iptypev6($binip);

    if (defined($type) && $type !~ /^(?:(?:GLOBAL|(?:UNIQUE|LINK)-LOCAL)-UNICAST)$/) {
        raise_param_exc(
            { address => "$address with type '$type', cannot be used as host IPv6 address." });
    }
};

my $map_cidr_to_address_netmask = sub {
    my ($param) = @_;

    if ($param->{cidr}) {
        raise_param_exc({ address => "address conflicts with cidr" })
            if $param->{address};
        raise_param_exc({ netmask => "netmask conflicts with cidr" })
            if $param->{netmask};

        my ($address, $netmask) = $param->{cidr} =~ m!^(.*)/(\d+)$!;
        $param->{address} = $address;
        $param->{netmask} = $netmask;
        delete $param->{cidr};
    }

    if ($param->{cidr6}) {
        raise_param_exc({ address6 => "address6 conflicts with cidr6" })
            if $param->{address6};
        raise_param_exc({ netmask6 => "netmask6 conflicts with cidr6" })
            if $param->{netmask6};

        my ($address, $netmask) = $param->{cidr6} =~ m!^(.*)/(\d+)$!;
        $param->{address6} = $address;
        $param->{netmask6} = $netmask;
        delete $param->{cidr6};
    }
};

__PACKAGE__->register_method({
    name => 'create_network',
    path => '',
    method => 'POST',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    description => "Create network device configuration",
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => json_config_properties({
            node => get_standard_option('pve-node'),
            iface => get_standard_option('pve-iface'),
        }),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $node = extract_param($param, 'node');
        my $iface = extract_param($param, 'iface');

        my $code = sub {
            my $config = PVE::INotify::read_file('interfaces');
            my $ifaces = $config->{ifaces};

            raise_param_exc({ iface => "interface already exists" })
                if $ifaces->{$iface};

            &$check_duplicate_gateway($ifaces, $iface)
                if $param->{gateway};
            &$check_duplicate_gateway6($ifaces, $iface)
                if $param->{gateway6};

            $check_duplicate_ports->($ifaces, $iface, $param);

            $map_cidr_to_address_netmask->($param);

            &$check_ipv6_settings($param->{address6}, int($param->{netmask6}))
                if $param->{address6};

            my $families = $param->{families} = [];
            push @$families, 'inet'
                if $param->{address} && !grep(/^inet$/, @$families);
            push @$families, 'inet6'
                if $param->{address6} && !grep(/^inet6$/, @$families);
            @$families = ('inet') if !scalar(@$families);

            $param->{method} = $param->{address} ? 'static' : 'manual';
            $param->{method6} = $param->{address6} ? 'static' : 'manual';

            if ($param->{type} =~ m/^OVS/) {
                -x '/usr/bin/ovs-vsctl'
                    || die "Open VSwitch is not installed (need package 'openvswitch-switch')\n";
            }

            if ($param->{type} eq 'OVSIntPort' || $param->{type} eq 'OVSBond') {
                my $brname = $param->{ovs_bridge};
                raise_param_exc({ ovs_bridge => "parameter is required" }) if !$brname;
                my $br = $ifaces->{$brname};
                raise_param_exc({ ovs_bridge => "bridge '$brname' does not exist" }) if !$br;
                raise_param_exc({ ovs_bridge => "interface '$brname' is no OVS bridge" })
                    if $br->{type} ne 'OVSBridge';

                my @ports = split(/\s+/, $br->{ovs_ports} || '');
                $br->{ovs_ports} = join(' ', @ports, $iface)
                    if !grep { $_ eq $iface } @ports;
            }

            if (
                $param->{bridge_vids}
                && scalar(PVE::Tools::split_list($param->{bridge_vids}) == 0)
            ) {
                raise_param_exc({ bridge_vids => "VLAN list items are empty" });
            }
            # make sure the list is space separated! other separators will cause problems in the
            # network configuration
            $param->{bridge_vids} = join(" ", PVE::Tools::split_list($param->{bridge_vids}))
                if $param->{bridge_vids};

            $ifaces->{$iface} = $param;

            PVE::INotify::write_file('interfaces', $config);
        };

        PVE::Tools::lock_file($iflockfn, 10, $code);
        die $@ if $@;

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'update_network',
    path => '{iface}',
    method => 'PUT',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    description => "Update network device configuration",
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => json_config_properties({
            node => get_standard_option('pve-node'),
            iface => get_standard_option('pve-iface'),
            delete => {
                type => 'string',
                format => 'pve-configid-list',
                description => "A list of settings you want to delete.",
                optional => 1,
            },
        }),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $node = extract_param($param, 'node');
        my $iface = extract_param($param, 'iface');
        my $delete = extract_param($param, 'delete');

        my $code = sub {
            my $config = PVE::INotify::read_file('interfaces');
            my $ifaces = $config->{ifaces};

            raise_param_exc({ iface => "interface does not exist" })
                if !$ifaces->{$iface};

            my $families = ($param->{families} ||= []);
            foreach my $k (PVE::Tools::split_list($delete)) {
                delete $ifaces->{$iface}->{$k};
                @$families = grep(!/^inet$/, @$families) if $k eq 'address';
                @$families = grep(!/^inet6$/, @$families) if $k eq 'address6';
                if ($k eq 'cidr') {
                    delete $ifaces->{$iface}->{netmask};
                    delete $ifaces->{$iface}->{address};
                } elsif ($k eq 'cidr6') {
                    delete $ifaces->{$iface}->{netmask6};
                    delete $ifaces->{$iface}->{address6};
                }
            }

            $map_cidr_to_address_netmask->($param);

            &$check_duplicate_gateway($ifaces, $iface)
                if $param->{gateway};
            &$check_duplicate_gateway6($ifaces, $iface)
                if $param->{gateway6};

            $check_duplicate_ports->($ifaces, $iface, $param);

            if ($param->{address}) {
                push @$families, 'inet' if !grep(/^inet$/, @$families);
            } else {
                @$families = grep(!/^inet$/, @$families);
            }
            if ($param->{address6}) {
                &$check_ipv6_settings($param->{address6}, int($param->{netmask6}));
                push @$families, 'inet6' if !grep(/^inet6$/, @$families);
            } else {
                @$families = grep(!/^inet6$/, @$families);
            }
            @$families = ('inet') if !scalar(@$families);

            $param->{method} = $param->{address} ? 'static' : 'manual';
            $param->{method6} = $param->{address6} ? 'static' : 'manual';

            foreach my $k (keys %$param) {
                $ifaces->{$iface}->{$k} = $param->{$k};
            }

            if (
                $param->{bridge_vids}
                && scalar(PVE::Tools::split_list($param->{bridge_vids}) == 0)
            ) {
                raise_param_exc({ bridge_vids => "VLAN list items are empty" });
            }
            # make sure the list is space separated! other separators will cause problems in the
            # network configuration
            $param->{bridge_vids} = join(" ", PVE::Tools::split_list($param->{bridge_vids}))
                if $param->{bridge_vids};

            PVE::INotify::write_file('interfaces', $config);
        };

        PVE::Tools::lock_file($iflockfn, 10, $code);
        die $@ if $@;

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'network_config',
    path => '{iface}',
    method => 'GET',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Audit']],
    },
    description => "Read network device configuration",
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            iface => get_standard_option('pve-iface'),
        },
    },
    returns => {
        type => "object",
        properties => {
            type => {
                type => 'string',
            },
            method => {
                type => 'string',
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $config = PVE::INotify::read_file('interfaces');
        my $ifaces = $config->{ifaces};

        my $iface = $param->{iface};

        raise_param_exc({ iface => "interface does not exist" })
            if !$ifaces->{$iface};

        my $altnames = extract_altnames($iface);
        $ifaces->{$iface}->{altnames} = $altnames if defined($altnames);

        return $ifaces->{$iface};
    },
});

sub ifupdown2_version {
    my $v;
    PVE::Tools::run_command(['ifreload', '-V'], outfunc => sub { $v //= shift });
    return if !defined($v) || $v !~ /^\s*ifupdown2:(\S+)\s*$/;
    $v = $1;
    my ($major, $minor, $extra, $pve) = split(/\.|-/, $v);
    my $is_pve = defined($pve) && $pve =~ /(pve|pmx|proxmox)/;

    return ($major * 100000 + $minor * 1000 + $extra * 10, $is_pve, $v);
}

sub assert_ifupdown2_installed {
    die "you need ifupdown2 to reload network configuration\n" if !-e '/usr/share/ifupdown2';
    my ($v, $pve, $v_str) = ifupdown2_version();
    die
        "incompatible 'ifupdown2' package version '$v_str'! Did you install from Proxmox repositories?\n"
        if $v < (1 * 100000 + 2 * 1000 + 8 * 10) || !$pve;
}

__PACKAGE__->register_method({
    name => 'reload_network_config',
    path => '',
    method => 'PUT',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    description => "Reload network configuration",
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            'regenerate-frr' => {
                type => 'boolean',
                description => 'Whether FRR config generation should get skipped or not.',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => { type => 'string' },
    code => sub {

        my ($param) = @_;

        my $rpcenv = PVE::RPCEnvironment::get();

        my $authuser = $rpcenv->get_user();

        my $current_config_file = "/etc/network/interfaces";
        my $new_config_file = "/etc/network/interfaces.new";

        my $regenerate_frr = extract_param($param, 'regenerate-frr');

        assert_ifupdown2_installed();

        my $worker = sub {

            rename($new_config_file, $current_config_file) if -e $new_config_file;

            if ($have_sdn) {
                PVE::Network::SDN::generate_etc_network_config();
                PVE::Network::SDN::generate_dhcp_config();
            }

            my $err = sub {
                my $line = shift;
                if ($line =~ /(warning|error): (\S+):/) {
                    print "$2 : $line \n";
                }
            };
            PVE::Tools::run_command(['ifreload', '-a'], errfunc => $err);

            if (defined($regenerate_frr)) {
                # SDN (or a manual invocation) is requesting a
                # specific behavior, so we abide by the parameter set.
                PVE::Network::SDN::generate_frr_config(1) if $regenerate_frr;
            } elsif (PVE::Network::SDN::running_config_has_frr()) {
                # Reload is coming from the Web UI (or a manual
                # invocation requesting no specific behavior), so we
                # reload if there are FRR entities in the SDN config.
                PVE::Network::SDN::generate_frr_config(1);
            }
        };
        return $rpcenv->fork_worker('srvreload', 'networking', $authuser, $worker);
    },
});

__PACKAGE__->register_method({
    name => 'delete_network',
    path => '{iface}',
    method => 'DELETE',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    description => "Delete network device configuration",
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            iface => get_standard_option('pve-iface'),
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $code = sub {
            my $config = PVE::INotify::read_file('interfaces');
            my $ifaces = $config->{ifaces};

            raise_param_exc({ iface => "interface does not exist" })
                if !$ifaces->{ $param->{iface} };

            my $d = $ifaces->{ $param->{iface} };
            if ($d->{type} eq 'OVSIntPort' || $d->{type} eq 'OVSBond') {
                if (my $brname = $d->{ovs_bridge}) {
                    if (my $br = $ifaces->{$brname}) {
                        if ($br->{ovs_ports}) {
                            my @ports = split(/\s+/, $br->{ovs_ports});
                            my @new = grep { $_ ne $param->{iface} } @ports;
                            $br->{ovs_ports} = join(' ', @new);
                        }
                    }
                }
            }

            delete $ifaces->{ $param->{iface} };

            PVE::INotify::write_file('interfaces', $config);
        };

        PVE::Tools::lock_file($iflockfn, 10, $code);
        die $@ if $@;

        return undef;
    },
});

1;
