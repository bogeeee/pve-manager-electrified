#!/usr/bin/perl

use strict;
use warnings;

use lib ('.', '..');

use Test::More;
use PVE::API2::Cluster::Ceph;
use PVE::Ceph::Services;

{

    package ServiceRados;

    sub new {
        my ($class, $metadata) = @_;
        return bless { metadata => $metadata }, $class;
    }

    sub mon_command {
        my ($self, $cmd) = @_;
        return $self->{metadata}->{$1} // [] if $cmd->{prefix} =~ /^(\w+) metadata$/;
        die "unexpected command '$cmd->{prefix}'\n";
    }
}

{

    package ServiceRPCEnvironment;

    sub get_user { return 'root@pam'; }

    sub fork_worker {
        my ($self, $type, $id, $user, $worker) = @_;
        $worker->('test-upid');
        return 'test-upid';
    }
}

my $restart = PVE::API2::Cluster::Ceph->map_method_by_name('restart_bulk')->{code};
my $inventory = {
    'node-a' => { 0 => {}, 1 => {} },
    'node-b' => { 2 => {} },
    'node-a.example' => { 3 => {} },
};
my $versions = {
    'node-a' => { version => { str => '19.2.6' } },
    'node-a.example' => { version => { str => '20.2.1' } },
};
my $metadata = [
    { id => 0, hostname => 'node-a.invalid', ceph_version_short => '19.2.5' },
    { id => 1, hostname => 'node-a.invalid', ceph_version_short => '19.2.6' },
    { id => 2, hostname => 'node-b.invalid', ceph_version_short => '19.2.6' },
    { id => 3, hostname => 'node-a.example', ceph_version_short => '20.2.0' },
    { id => 4, hostname => 'foreign.invalid', ceph_version_short => '19.2.5' },
];

{
    no warnings qw(redefine once);
    local *PVE::RPCEnvironment::get = sub { bless {}, 'ServiceRPCEnvironment' };
    local *PVE::Ceph::Tools::check_ceph_inited = sub { };
    local *PVE::Ceph::Services::ResilientRados::new = sub {
        return ServiceRados->new({ osd => $metadata });
    };
    local *PVE::Cluster::cfs_read_file = sub { {} };
    local *PVE::Cluster::get_nodelist = sub { [sort keys %$inventory] };
    local *PVE::Ceph::Services::get_cluster_service = sub { $inventory };
    local *PVE::Ceph::Services::get_ceph_versions = sub { $versions };

    my $out = '';
    open(my $stdout, '>', \$out) or die $!;
    local *STDOUT = $stdout;
    $restart->({ 'service-type' => 'osd', 'dry-run' => 1, 'only-outdated' => 1 });
    like($out, qr/node-a \(1 outdated OSDs\)/, 'FQDN count uses the member installed version');
    like($out, qr/node-b \(1 outdated OSDs\)/, 'missing installed version still visits the member');
    like($out, qr/node-a\.example \(1 outdated OSDs\)/, 'exact member name precedes shortening');
    unlike($out, qr/invalid|nothing to do/, 'the plan contains no foreign host or false no-op');

    $metadata = [
        { id => 0, hostname => 'node-a.invalid', ceph_version_short => '19.2.6' },
        { id => 3, hostname => 'node-a.example', ceph_version_short => '20.2.1' },
    ];
    $out = '';
    $restart->({ 'service-type' => 'osd', 'dry-run' => 1, 'only-outdated' => 1 });
    like($out, qr/no outdated OSDs found/, 'up-to-date FQDN metadata does not schedule a restart');
}

{
    no warnings qw(redefine once);
    local *PVE::Cluster::get_nodelist = sub { ['node-a', 'node-a.example'] };
    local *PVE::Ceph::Tools::check_ceph_inited = sub { };
    local *PVE::Ceph::Services::get_ceph_versions = sub { {} };
    local *PVE::Ceph::Services::get_cluster_service = sub {
        return {
            'node-a' =>
                { present => { service => 1, direxists => 1 }, stopped => { service => 1 } },
            'node-a.example' => { exact => { service => 1 } },
        };
    };
    local *PVE::RADOS::new = sub {
        return ServiceRados->new({
            map {
                $_ => [
                    {
                        name => 'present',
                        hostname => 'node-a.invalid',
                        ceph_version_short => '19.2.6',
                    },
                    { name => 'exact', hostname => 'node-a.example' },
                    { name => 'foreign', hostname => 'foreign.invalid' },
                    { name => 'dead' },
                ]
            } qw(mon mgr mds)
        });
    };
    my $api = PVE::API2::Cluster::Ceph->map_method_by_name('metadata')->{code};
    my $result = $api->({});
    for my $type (qw(mon mgr mds)) {
        is_deeply(
            [sort keys %{ $result->{$type} }],
            ['exact@node-a.example', 'foreign@foreign.invalid', 'present@node-a', 'stopped@node-a'],
            "$type metadata merges member aliases without duplicate service records",
        );
        my $service = $result->{$type}->{'present@node-a'};
        is($service->{hostname}, 'node-a', "$type merged hostname agrees with the record key");
        ok($service->{service} && $service->{direxists}, "$type merged inventory flags survive");
        is($service->{ceph_version_short}, '19.2.6', "$type merged version survives");
    }
}

done_testing();
