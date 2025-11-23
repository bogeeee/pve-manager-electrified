package PVE::API2::Certificates;

use strict;
use warnings;

use PVE::API2::ACME;
use PVE::Certificate;
use PVE::CertHelpers;
use PVE::Exception qw(raise_param_exc);
use PVE::JSONSchema qw(get_standard_option);
use PVE::Tools qw(extract_param file_get_contents file_set_contents);

use base qw(PVE::RESTHandler);

__PACKAGE__->register_method({
    subclass => "PVE::API2::ACME",
    path => 'acme',
});

__PACKAGE__->register_method({
    name => 'index',
    path => '',
    method => 'GET',
    permissions => { user => 'all' },
    description => "Node index.",
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

        return [
            { name => 'acme' }, { name => 'custom' }, { name => 'info' },
        ];
    },
});

__PACKAGE__->register_method({
    name => 'info',
    path => 'info',
    method => 'GET',
    permissions => { user => 'all' },
    proxyto => 'node',
    description => "Get information about node's certificates.",
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
        },
    },
    returns => {
        type => 'array',
        items => get_standard_option('pve-certificate-info'),
    },
    code => sub {
        my ($param) = @_;

        my $node_path = "/etc/pve/nodes/$param->{node}";

        my $res = [];
        my $cert_paths = [
            '/etc/pve/pve-root-ca.pem', "$node_path/pve-ssl.pem", "$node_path/pveproxy-ssl.pem",
        ];
        for my $path (@$cert_paths) {
            eval {
                my $info = PVE::Certificate::get_certificate_info($path);
                push @$res, $info if $info;
            };
        }
        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'upload_custom_cert',
    path => 'custom',
    method => 'POST',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    description => 'Upload or update custom certificate chain and key.',
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            certificates => {
                type => 'string',
                format => 'pem-certificate-chain',
                description => 'PEM encoded certificate (chain).',
            },
            key => {
                type => 'string',
                description => 'PEM encoded private key.',
                format => 'pem-string',
                optional => 1,
            },
            force => {
                type => 'boolean',
                description => 'Overwrite existing custom or ACME certificate files.',
                optional => 1,
                default => 0,
            },
            restart => {
                type => 'boolean',
                description => 'Restart pveproxy.',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => get_standard_option('pve-certificate-info'),
    code => sub {
        my ($param) = @_;

        my $node = extract_param($param, 'node');
        my $cert_prefix = PVE::CertHelpers::cert_path_prefix($node);

        my $certs = extract_param($param, 'certificates');
        $certs = PVE::Certificate::strip_leading_text($certs);

        my $key = extract_param($param, 'key');
        if ($key) {
            $key = PVE::Certificate::strip_leading_text($key);
        } else {
            raise_param_exc(
                { 'key' => "Attempted to upload custom certificate without (existing) key." })
                if !-e "${cert_prefix}.key";
        }

        my $info;

        my $code = sub {
            print "Setting custom certificate files\n";
            $info =
                PVE::CertHelpers::set_cert_files($certs, $key, $cert_prefix, $param->{force});

            if ($param->{restart}) {
                print "Restarting pveproxy\n";
                PVE::Tools::run_command(['systemctl', 'reload-or-restart', 'pveproxy']);
            }
        };

        PVE::CertHelpers::cert_lock(10, $code);
        die "$@\n" if $@;

        return $info;
    },
});

__PACKAGE__->register_method({
    name => 'remove_custom_cert',
    path => 'custom',
    method => 'DELETE',
    permissions => {
        check => ['perm', '/nodes/{node}', ['Sys.Modify']],
    },
    description => 'DELETE custom certificate chain and key.',
    protected => 1,
    proxyto => 'node',
    parameters => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            restart => {
                type => 'boolean',
                description => 'Restart pveproxy.',
                optional => 1,
                default => 0,
            },
        },
    },
    returns => {
        type => 'null',
    },
    code => sub {
        my ($param) = @_;

        my $node = extract_param($param, 'node');
        my $cert_prefix = PVE::CertHelpers::cert_path_prefix($node);

        my $code = sub {
            print "Deleting custom certificate files\n";
            unlink "${cert_prefix}.pem";
            unlink "${cert_prefix}.key";

            if ($param->{restart}) {
                print "Restarting pveproxy\n";
                PVE::Tools::run_command(['systemctl', 'reload-or-restart', 'pveproxy']);
            }
        };

        PVE::CertHelpers::cert_lock(10, $code);
        die "$@\n" if $@;

        return undef;
    },
});

1;
