#!/usr/bin/perl

use v5.36;

use lib ('.', '..');

use Test::More;
use Test::MockModule;

use PVE::JSONSchema;

# Make sure we don't accidentally hit the real cluster filesystem when loading
# the API module: PVE::QemuServer::CPUConfig registers a cfs file and tries
# mkdir on /etc/pve/virtual-guest in BEGIN-time code, but both fail soft if
# pve-cluster is not mounted, which is what we want here.
require PVE::API2::Cluster::Qemu::CustomCPUModels;

# Stub out the rpc environment so permission checks don't blow up. The API
# handler code path calls $rpcenv->check_any / ->get_user.
my $stub_rpcenv = bless {}, 'PVE::RPCEnvironment::Test';
sub PVE::RPCEnvironment::Test::get_user { return 'root@pam'; }
sub PVE::RPCEnvironment::Test::check_any { return 1; }
sub PVE::RPCEnvironment::Test::check { return 1; }
my $rpc_mock = Test::MockModule->new('PVE::RPCEnvironment');
$rpc_mock->mock(get => sub { $stub_rpcenv });

# Helper to invoke a registered method's parameter schema.
sub validate_params($http_method, $path, $params) {
    my ($handler, $info) =
        PVE::API2::Cluster::Qemu::CustomCPUModels->find_handler($http_method, $path, {});
    die "no handler for $http_method $path\n" if !$info;
    PVE::JSONSchema::validate($params, $info->{parameters});
}

# Helper to invoke a registered method's code with mocked backend.
sub invoke_method($http_method, $path, $params) {
    my ($handler, $info) =
        PVE::API2::Cluster::Qemu::CustomCPUModels->find_handler($http_method, $path, {});
    die "no handler for $http_method $path\n" if !$info;
    PVE::JSONSchema::validate($params, $info->{parameters});
    return $info->{code}->($params);
}

# --- create: cputype required (A1) ---
eval { validate_params('POST', '', { 'reported-model' => 'qemu64' }) };
like(
    $@,
    qr/cputype.*(?:missing|required|not optional)/i,
    'POST without cputype rejected by schema',
);

eval { validate_params('POST', '', { cputype => 'name' }) };
like(
    $@,
    qr/reported-model.*(?:missing|required|not optional)/i,
    'POST without reported-model rejected by schema',
);

# --- create: cputype must be a valid pve-configid (A1) ---
eval { validate_params('POST', '', { cputype => '4foo', 'reported-model' => 'qemu64' }) };
like(
    $@, qr/format/i, 'POST with cputype starting with digit rejected by schema',
);

eval { validate_params('POST', '', { cputype => 'bad name', 'reported-model' => 'qemu64' }) };
like(
    $@, qr/format/i, 'POST with whitespace in cputype rejected by schema',
);

eval { validate_params('POST', '', { cputype => 'a' x 50, 'reported-model' => 'qemu64' }) };
like(
    $@, qr/40 characters|maxLength|too long/i, 'POST with overly long cputype rejected by schema',
);

# Valid cputype with optional 'custom-' prefix passes the schema.
eval { validate_params('POST', '', { cputype => 'custom-foo', 'reported-model' => 'qemu64' }) };
is($@, '', 'POST with valid prefixed cputype accepted by schema');

eval { validate_params('POST', '', { cputype => 'my_model', 'reported-model' => 'qemu64' }) };
is($@, '', 'POST with valid unprefixed cputype accepted by schema');

# --- create: empty name after stripping 'custom-' is rejected by runtime check (A1) ---
# Schema accepts "custom-" (valid pve-configid), but after stripping the
# prefix the name is empty, so pve_verify_configid in the handler must die
# before reaching the cfs lock.
{
    my $config_mock = Test::MockModule->new('PVE::QemuServer::CPUConfig');
    $config_mock->mock(
        lock_custom_cpu_model_config => sub { fail('lock reached for empty stripped name'); },
    );
    eval { invoke_method('POST', '', { cputype => 'custom-', 'reported-model' => 'qemu64' }) };
    like($@, qr/configid|invalid/i, 'POST with cputype "custom-" rejected after stripping');
}

# --- update: delete=cputype is rejected before touching the lock (A14) ---
{
    my $config_mock = Test::MockModule->new('PVE::QemuServer::CPUConfig');
    $config_mock->mock(lock_custom_cpu_model_config => sub { fail('should not reach lock'); });
    eval { invoke_method('PUT', 'foo', { cputype => 'foo', delete => 'cputype' }); };
    like($@, qr/cannot delete 'cputype'/, 'PUT with delete=cputype rejected');
}

# --- update: cputype value taken from URL is also validated (A1) ---
eval { validate_params('PUT', '4foo', { cputype => '4foo' }) };
like(
    $@, qr/format/i, 'PUT against a path with malformed cputype rejected by schema',
);

done_testing();
