package PVE::CertHelpers;

use strict;
use warnings;

use PVE::Certificate;
use PVE::JSONSchema;
use PVE::Tools;

my $account_prefix = '/etc/pve/priv/acme';

PVE::JSONSchema::register_standard_option(
    'pve-acme-account-name',
    {
        description => 'ACME account config file name.',
        type => 'string',
        format => 'pve-configid',
        format_description => 'name',
        optional => 1,
        default => 'default',
    },
);

PVE::JSONSchema::register_standard_option(
    'pve-acme-account-contact',
    {
        type => 'string',
        format => 'email-list',
        description => 'Contact email addresses.',
    },
);

PVE::JSONSchema::register_standard_option(
    'pve-acme-directory-url',
    {
        type => 'string',
        description => 'URL of ACME CA directory endpoint.',
        pattern => '^https?://.*',
    },
);

my $local_cert_lock = '/var/lock/pve-certs.lock';

sub cert_path_prefix {
    my ($node) = @_;

    return "/etc/pve/nodes/${node}/pveproxy-ssl";
}

sub default_cert_path_prefix {
    my ($node) = @_;

    return "/etc/pve/nodes/${node}/pve-ssl";
}

sub cert_lock {
    my ($timeout, $code, @param) = @_;

    return PVE::Tools::lock_file($local_cert_lock, $timeout, $code, @param);
}

sub set_cert_files {
    my ($cert, $key, $path_prefix, $force) = @_;

    my ($old_cert, $old_key, $info);

    my $cert_path = "${path_prefix}.pem";
    my $cert_path_tmp = "${path_prefix}.pem.old";
    my $key_path = "${path_prefix}.key";
    my $key_path_tmp = "${path_prefix}.key.old";

    die "Custom certificate file exists but force flag is not set.\n"
        if !$force && -e $cert_path;
    die "Custom certificate key file exists but force flag is not set.\n"
        if !$force && -e $key_path;

    PVE::Tools::file_copy($cert_path, $cert_path_tmp) if -e $cert_path;
    PVE::Tools::file_copy($key_path, $key_path_tmp) if -e $key_path;

    eval {
        PVE::Tools::file_set_contents($cert_path, $cert);
        PVE::Tools::file_set_contents($key_path, $key) if $key;
        $info = PVE::Certificate::get_certificate_info($cert_path);
    };
    my $err = $@;

    if ($err) {
        if (-e $cert_path_tmp && -e $key_path_tmp) {
            eval {
                warn "Attempting to restore old certificate files..\n";
                PVE::Tools::file_copy($cert_path_tmp, $cert_path);
                PVE::Tools::file_copy($key_path_tmp, $key_path);
            };
            warn "$@\n" if $@;
        }
        die "Setting certificate files failed - $err\n";
    }

    unlink $cert_path_tmp;
    unlink $key_path_tmp;

    return $info;
}

sub acme_account_dir {
    return $account_prefix;
}

sub list_acme_accounts {
    my $accounts = [];

    return $accounts if !-d $account_prefix;

    PVE::Tools::dir_glob_foreach(
        $account_prefix,
        qr/[^.]+.*/,
        sub {
            my ($name) = @_;

            push @$accounts, $name
                if PVE::JSONSchema::pve_verify_configid($name, 1);
        },
    );

    return $accounts;
}
