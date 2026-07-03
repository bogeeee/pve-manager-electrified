package PVE::API2::Cluster::Qemu::CustomCPUModels;

use v5.36;

use PVE::JSONSchema qw(get_standard_option);
use PVE::RESTHandler;
use PVE::RPCEnvironment;
use PVE::SectionConfig;
use PVE::Tools qw(extract_param);

use PVE::QemuServer::CPUConfig;

use base qw(PVE::RESTHandler);

my $cputype_param = {
    type => 'string',
    format => 'pve-configid',
    maxLength => 40,
    description => "Name for the custom CPU model. The 'custom-' prefix is optional.",
};

my $reported_model_param =
    { get_standard_option('pve-qm-custom-cpu-model')->{'reported-model'}->%*, optional => 0 };

# privileges that grant any kind of visibility on a custom CPU model
my $can_see_mapping_privs = ['Mapping.Modify', 'Mapping.Use', 'Mapping.Audit'];

__PACKAGE__->register_method({
    name => 'config',
    path => '',
    method => 'GET',
    description => 'List all custom CPU model definitions visible to the user.',
    permissions => {
        description => "Only lists entries where the user has 'Mapping.Modify',"
            . " 'Mapping.Use' or 'Mapping.Audit' permissions on '/mapping/cpu/<name>'.",
        user => 'all',
    },
    parameters => {
        additionalProperties => 0,
    },
    returns => {
        type => 'array',
        items => {
            type => 'object',
            properties => {
                %{ get_standard_option('pve-qm-custom-cpu-model') },
                digest => get_standard_option('pve-config-digest'),
            },
        },
        links => [{ rel => 'child', href => "{cputype}" }],
    },
    code => sub {
        my $rpcenv = PVE::RPCEnvironment::get();
        my $authuser = $rpcenv->get_user();

        my $conf = PVE::QemuServer::CPUConfig::load_custom_cpu_model_config();
        my $res = [];
        for my $id (sort keys $conf->{ids}->%*) {
            next
                if !$rpcenv->check_any($authuser, "/mapping/cpu/$id", $can_see_mapping_privs, 1);
            my $entry = $conf->{ids}->{$id};
            delete $entry->{type};
            $entry->{digest} = $conf->{digest};
            push @$res, $entry;
        }
        return $res;
    },
});

__PACKAGE__->register_method({
    name => 'create',
    path => '',
    method => 'POST',
    protected => 1,
    description => 'Add a custom CPU model definition.',
    permissions => {
        check => ['perm', '/mapping/cpu', ['Mapping.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => PVE::QemuServer::CPUConfig::add_cpu_json_properties({
            cputype => $cputype_param,
            'reported-model' => $reported_model_param,
        }),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        (my $name = $param->{cputype}) =~ s/^custom-//;
        PVE::JSONSchema::pve_verify_configid($name);
        $param->{cputype} = "custom-$name";

        PVE::QemuServer::CPUConfig::lock_custom_cpu_model_config(sub {
            my $conf = PVE::QemuServer::CPUConfig::load_custom_cpu_model_config();
            my $opts = PVE::QemuServer::CPUConfig->check_config($name, $param, 1, 1);

            die "custom CPU model '$name' already exists\n"
                if defined($conf->{ids}->{$name});

            $conf->{ids}->{$name} = $opts;

            PVE::QemuServer::CPUConfig::write_custom_cpu_model_config($conf);
        });
    },
});

__PACKAGE__->register_method({
    name => 'delete',
    path => '{cputype}',
    method => 'DELETE',
    protected => 1,
    description => 'Delete a custom CPU model definition.',
    permissions => {
        check => ['perm', '/mapping/cpu/{cputype}', ['Mapping.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            cputype => {
                type => 'string',
                description => "The custom model to delete. The 'custom-' prefix is optional.",
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        (my $name = $param->{cputype}) =~ s/^custom-//;

        PVE::QemuServer::CPUConfig::lock_custom_cpu_model_config(sub {
            my $conf = PVE::QemuServer::CPUConfig::load_custom_cpu_model_config();

            die "custom CPU model '$name' does not exist\n"
                if !defined($conf->{ids}->{$name});
            delete $conf->{ids}->{$name};

            PVE::QemuServer::CPUConfig::write_custom_cpu_model_config($conf);
        });
    },
});

__PACKAGE__->register_method({
    name => 'update',
    path => '{cputype}',
    method => 'PUT',
    protected => 1,
    description => "Update a custom CPU model definition.",
    permissions => {
        check => ['perm', '/mapping/cpu/{cputype}', ['Mapping.Modify']],
    },
    parameters => {
        additionalProperties => 0,
        properties => PVE::QemuServer::CPUConfig::add_cpu_json_properties({
            cputype => $cputype_param,
            digest => get_standard_option('pve-config-digest'),
            delete => {
                type => 'string',
                format => 'pve-configid-list',
                description => "A list of properties to delete.",
                optional => 1,
            },
        }),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $digest = extract_param($param, 'digest');
        my $delete = extract_param($param, 'delete');

        if ($delete) {
            $delete = [PVE::Tools::split_list($delete)];
            die "cannot delete 'cputype'\n" if grep { $_ eq 'cputype' } @$delete;
            die "cannot delete 'reported-model'\n" if grep { $_ eq 'reported-model' } @$delete;
        }

        (my $name = $param->{cputype}) =~ s/^custom-//;
        PVE::JSONSchema::pve_verify_configid($name);
        $param->{cputype} = "custom-$name";

        PVE::QemuServer::CPUConfig::lock_custom_cpu_model_config(sub {
            my $conf = PVE::QemuServer::CPUConfig::load_custom_cpu_model_config();

            PVE::SectionConfig::assert_if_modified($conf, $digest);

            my $opts = PVE::QemuServer::CPUConfig->check_config($name, $param, 0, 1);

            my $model = $conf->{ids}->{$name};
            die "custom CPU model '$name' does not exist\n" if !defined($model);

            my $options = PVE::QemuServer::CPUConfig->private()->{options}->{'cpu-model'};

            PVE::SectionConfig::delete_from_config($model, $options, $opts, $delete);

            $model->{$_} = $opts->{$_} for keys $opts->%*;

            PVE::QemuServer::CPUConfig::write_custom_cpu_model_config($conf);
        });
    },
});

__PACKAGE__->register_method({
    name => 'info',
    path => '{cputype}',
    method => 'GET',
    description => 'Retrieve details about a specific custom CPU model.',
    permissions => {
        check => [
            'or',
            ['perm', '/mapping/cpu/{cputype}', ['Mapping.Audit']],
            ['perm', '/mapping/cpu/{cputype}', ['Mapping.Use']],
            ['perm', '/mapping/cpu/{cputype}', ['Mapping.Modify']],
        ],
    },
    parameters => {
        additionalProperties => 0,
        properties => {
            cputype => {
                type => 'string',
                description =>
                    "Name of the CPU model to query. The 'custom-' prefix is optional.",
            },
        },
    },
    returns => {
        type => 'object',
        properties => PVE::QemuServer::CPUConfig::add_cpu_json_properties({
            digest => get_standard_option('pve-config-digest'),
        }),
    },
    code => sub {
        my ($param) = @_;
        (my $name = $param->{cputype}) =~ s/^custom-//;
        my $conf = PVE::QemuServer::CPUConfig::load_custom_cpu_model_config();
        my $retval = PVE::QemuServer::CPUConfig::get_custom_model($name, 0, $conf);
        $retval->{digest} = $conf->{digest};
        return $retval;
    },
});

1;
