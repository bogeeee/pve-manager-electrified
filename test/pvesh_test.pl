#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use JSON;
use Test::More;

use PVE::Tools;

# pvesh builds its command schemas at module load time from @ARGV, so each invocation needs
# a fresh process. Keep the real firewall handler and mock only its configuration read.
my $cli = <<'EOF';
use strict;
use warnings;

use JSON;
use Test::MockModule;

use PVE::API2;
use PVE::Firewall;
use PVE::RPCEnvironment;

my $schema = decode_json(shift @ARGV);
if (defined($schema)) {
    PVE::API2->register_method({
        name => 'pvesh_test',
        path => 'pvesh-test',
        method => 'GET',
        parameters => $schema,
        returns => { type => 'object' },
        code => sub { return shift; },
    });
}

my $firewall_mock = Test::MockModule->new('PVE::Firewall');
$firewall_mock->redefine(load_clusterfw_conf => sub { return { options => {} }; });
PVE::RPCEnvironment->init('cli');

require PVE::CLI::pvesh;

my $cmd = shift @ARGV;
PVE::CLI::pvesh->cli_handler("pvesh $cmd", $cmd, \@ARGV, ['api_path'], {});
EOF

my $object = {
    additionalProperties => 0,
    properties => {
        value => { type => 'string' },
    },
};
my $one_of = {
    'type-property' => 'type',
    'type-property-schema' => { type => 'string', enum => ['one', 'two'] },
    oneOf => [
        {
            'instance-type' => 'one',
            additionalProperties => 0,
            properties => { first => { type => 'string' } },
        },
        {
            'instance-type' => 'two',
            additionalProperties => 0,
            properties => { second => { type => 'string' } },
        },
    ],
};

my $tests = [
    {
        name => 'parameterless firewall options GET',
        path => '/cluster/firewall/options',
        expected => {},
    },
    {
        name => 'empty schema without properties',
        schema => { additionalProperties => 0 },
        expected => {},
    },
    {
        name => 'allOf properties',
        schema => { allOf => [$object] },
        args => ['--value', 'test'],
        expected => { value => 'test' },
    },
    {
        name => 'oneOf properties',
        schema => $one_of,
        args => ['--type', 'one', '--first', 'test'],
        expected => { type => 'one', first => 'test' },
    },
];

for my $test ($tests->@*) {
    subtest $test->{name} => sub {
        my ($output, $error) = ('', '');
        my $cmd = [
            $^X,
            '-I.',
            '-I..',
            '-',
            encode_json($test->{schema}),
            'get',
            $test->{path} // '/pvesh-test',
            ($test->{args} // [])->@*,
            '--output-format',
            'json',
        ];
        eval {
            PVE::Tools::run_command(
                $cmd,
                input => $cli,
                outfunc => sub { $output .= "$_[0]\n"; },
                errfunc => sub { $error .= "$_[0]\n"; },
            );
        };
        is($@, '', 'CLI exits successfully') or diag($error);
        is($error, '', 'no diagnostics');
        my $result = eval { decode_json($output) };
        is($@, '', 'output is JSON');
        delete $result->{digest} if $test->{path} && ref($result) eq 'HASH';
        is_deeply($result, $test->{expected}, 'API result excludes CLI-only parameters');
    };
}

done_testing();
