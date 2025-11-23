package PVE::CLI::pvesh;

use strict;
use warnings;
use HTTP::Status qw(:constants :is status_message);
use String::ShellQuote;
use PVE::JSONSchema qw(get_standard_option);
use PVE::SafeSyslog;
use PVE::Cluster;
use PVE::INotify;
use PVE::RPCEnvironment;
use PVE::RESTHandler;
use PVE::CLIFormatter;
use PVE::CLIHandler;
use PVE::API2Tools;
use PVE::API2;
use JSON;
use IO::Uncompress::Gunzip qw(gunzip);

use base qw(PVE::CLIHandler);

my $disable_proxy = 0;
my $opt_nooutput = 0;

# compatibility code
my $optmatch;
do {
    $optmatch = 0;
    if ($ARGV[0]) {
        if ($ARGV[0] eq '--noproxy') {
            shift @ARGV;
            $disable_proxy = 1;
            $optmatch = 1;
        } elsif ($ARGV[0] eq '--nooutput') {
            # we use this when starting task in CLI (suppress printing upid)
            # for example 'pvesh --nooutput create /nodes/localhost/stopall'
            shift @ARGV;
            $opt_nooutput = 1;
            $optmatch = 1;
        }
    }
} while ($optmatch);

sub setup_environment {
    PVE::RPCEnvironment->setup_default_cli_env();
}

sub complete_api_path {
    my ($text) = @_;

    my ($dir, undef, $rest) = $text =~ m|^(.*/)?(([^/]*))?$|;

    my $path = $dir // ''; # copy

    $path =~ s|/+|/|g;
    $path =~ s|^\/||;
    $path =~ s|\/$||;

    my $res = [];

    my $di = dir_info($path);
    if (my $children = $di->{children}) {
        foreach my $c (@$children) {
            if ($c =~ /^\Q$rest/) {
                my $new = $dir ? "$dir$c" : $c;
                push @$res, $new;
            }
        }
    }

    if (scalar(@$res) == 1) {
        return [$res->[0], "$res->[0]/"];
    }

    return $res;
}

my $method_map = {
    create => 'POST',
    set => 'PUT',
    get => 'GET',
    delete => 'DELETE',
};

sub check_proxyto {
    my ($info, $uri_param, $params) = @_;

    my $rpcenv = PVE::RPCEnvironment->get();

    my $all_params = { %$uri_param, %$params };

    if ($info->{proxyto} || $info->{proxyto_callback}) {
        my $node = PVE::API2Tools::resolve_proxyto(
            $rpcenv,
            $info->{proxyto_callback},
            $info->{proxyto},
            $all_params,
        );

        if ($node ne 'localhost' && ($node ne PVE::INotify::nodename())) {
            die "proxy loop detected - aborting\n" if $disable_proxy;
            my $remip = PVE::Cluster::remote_node_ip($node);
            return ($node, $remip);
        }
    }

    return undef;
}

sub proxy_handler {
    my ($node, $remip, $path, $cmd, $param) = @_;

    my $args = [];
    foreach my $key (keys %$param) {
        next if $key eq 'quiet' || $key eq 'output-format'; # just to  be sure
        if (ref($param->{$key}) eq 'ARRAY') {
            push @$args, "--$key", $_ for $param->{$key}->@*;
        } else {
            push @$args, "--$key", $_ for split(/\0/, $param->{$key});
        }
    }

    my $ssh_tunnel_cmd = PVE::SSHInfo::ssh_info_to_command({ ip => $remip, name => $node });

    my @pvesh_cmd = ('pvesh', '--noproxy', $cmd, $path, '--output-format', 'json');
    if (scalar(@$args)) {
        my $cmdargs = [String::ShellQuote::shell_quote(@$args)];
        push @pvesh_cmd, @$cmdargs;
    }

    my $res = '';
    PVE::Tools::run_command(
        [$ssh_tunnel_cmd->@*, '--', @pvesh_cmd],
        errmsg => "proxy handler failed",
        outfunc => sub { $res .= shift },
    );

    my $decoded_json = eval { decode_json($res) };
    if ($@) {
        return $res; # do not error, '' (null) is valid too
    }
    return $decoded_json;
}

sub extract_children {
    my ($lnk, $data) = @_;

    my $res = [];

    return $res if !($lnk && $data);

    my $href = $lnk->{href};
    if ($href =~ m/^\{(\S+)\}$/) {
        my $prop = $1;

        foreach my $elem (sort { $a->{$prop} cmp $b->{$prop} } @$data) {
            next if !ref($elem);
            my $value = $elem->{$prop};
            push @$res, $value;
        }
    }

    return $res;
}

sub dir_info {
    my ($path) = @_;

    my $res = { path => $path };
    my $uri_param = {};
    my ($handler, $info, $pm) = PVE::API2->find_handler('GET', $path, $uri_param);
    if ($handler && $info) {
        eval {
            my $data = $handler->handle($info, $uri_param);
            my $lnk = PVE::JSONSchema::method_get_child_link($info);
            $res->{children} = extract_children($lnk, $data);
        }; # ignore errors ?
    }
    return $res;
}

sub resource_cap {
    my ($path) = @_;

    my $res = '';

    my ($handler, $info) = PVE::API2->find_handler('GET', $path);
    if (!($handler && $info)) {
        $res .= '--';
    } else {
        if (PVE::JSONSchema::method_get_child_link($info)) {
            $res .= 'Dr';
        } else {
            $res .= '-r';
        }
    }

    ($handler, $info) = PVE::API2->find_handler('PUT', $path);
    if (!($handler && $info)) {
        $res .= '-';
    } else {
        $res .= 'w';
    }

    ($handler, $info) = PVE::API2->find_handler('POST', $path);
    if (!($handler && $info)) {
        $res .= '-';
    } else {
        $res .= 'c';
    }

    ($handler, $info) = PVE::API2->find_handler('DELETE', $path);
    if (!($handler && $info)) {
        $res .= '-';
    } else {
        $res .= 'd';
    }

    return $res;
}

# dynamically update schema definition
# like: pvesh <get|set|create|delete|help> <path>

sub extract_path_info {
    my ($uri_param) = @_;

    my ($handler, $info);

    my $test_path_properties = sub {
        my ($method, $path) = @_;
        ($handler, $info) = PVE::API2->find_handler($method, $path, $uri_param);
    };

    if (defined(my $cmd = $ARGV[0])) {
        if (my $method = $method_map->{$cmd}) {
            if (my $path = $ARGV[1]) {
                $test_path_properties->($method, $path);
                if (!defined($handler)) {
                    print STDERR "No '$cmd' handler defined for '$path'\n";
                    exit(1);
                }
            }
        } elsif ($cmd eq 'bashcomplete') {
            my $cmdline = substr($ENV{COMP_LINE}, 0, $ENV{COMP_POINT});
            my $args = PVE::Tools::split_args($cmdline);
            if (defined(my $cmd = $args->[1])) {
                if (my $method = $method_map->{$cmd}) {
                    if (my $path = $args->[2]) {
                        $test_path_properties->($method, $path);
                    }
                }
            }
        }
    }

    return $info;
}

my $path_properties = {};

my $api_path_property = {
    description => "API path.",
    type => 'string',
    completion => sub {
        my ($cmd, $pname, $cur, $args) = @_;
        return complete_api_path($cur);
    },
};

my $uri_param = {};
if (my $info = extract_path_info($uri_param)) {
    foreach my $key (keys %{ $info->{parameters}->{properties} }) {
        next if defined($uri_param->{$key});
        $path_properties->{$key} = $info->{parameters}->{properties}->{$key};
    }
}

$path_properties->{api_path} = $api_path_property;
$path_properties->{noproxy} = {
    description => "Disable automatic proxying.",
    type => 'boolean',
    optional => 1,
};

my $extract_std_options = 1;

my $cond_add_standard_output_properties = sub {
    my ($props) = @_;

    my $keys =
        [grep { !defined($props->{$_}) } keys %$PVE::RESTHandler::standard_output_options];

    return PVE::RESTHandler::add_standard_output_properties($props, $keys);
};

my $handle_streamed_response = sub {
    my ($download) = @_;
    my ($fh, $path, $encoding, $type) =
        $download->@{ 'fh', 'path', 'content-encoding', 'content-type' };

    die "{download} returned but neither fh nor path given\n"
        if !defined($fh) && !defined($path);

    die "unknown 'content-encoding' $encoding\n" if defined($encoding) && $encoding ne 'gzip';
    die "unknown 'content-type' $type\n"
        if defined($type) && $type !~ qw!^(?:text/plain|application/json)$!;

    if (defined($path)) {
        open($fh, '<', $path) or die "open stream path '$path' for reading failed - $!\n";
    }

    local $/;
    my $data = <$fh>;

    if (defined($encoding)) {
        my $out;
        gunzip(\$data => \$out);
        $data = $out;
    }

    if (defined($type) && $type eq 'application/json') {
        $data = decode_json($data)->{data};
    }

    return $data;
};

sub call_api_method {
    my ($cmd, $param) = @_;

    my $method = $method_map->{$cmd} || die "unable to map command '$cmd'";

    my $path = PVE::Tools::extract_param($param, 'api_path');
    die "missing API path\n" if !defined($path);

    my $stdopts =
        $extract_std_options
        ? PVE::RESTHandler::extract_standard_output_properties($param)
        : {};

    $opt_nooutput = 1 if $stdopts->{quiet};

    my $uri_param = {};
    my ($handler, $info) = PVE::API2->find_handler($method, $path, $uri_param);
    if (!$handler || !$info) {
        die "no '$cmd' handler for '$path'\n";
    }

    my $data;
    my ($node, $remip) = check_proxyto($info, $uri_param, $param);
    if ($node) {
        $data = proxy_handler($node, $remip, $path, $cmd, $param);
    } else {
        foreach my $p (keys %$uri_param) {
            $param->{$p} = $uri_param->{$p};
        }

        if ($info->{expose_credentials}) {
            # create a ticket for the root@pam user, since the
            # api call expects to read those credentials
            my $rpcenv = PVE::RPCEnvironment->get();
            my $authuser = $rpcenv->get_user();

            my $ticket = PVE::AccessControl::assemble_ticket($authuser);
            my $csrf_token = PVE::AccessControl::assemble_csrf_prevention_token($authuser);
            $rpcenv->set_credentials({
                userid => $authuser,
                ticket => $ticket,
                token => $csrf_token,
            });
        }

        $data = $handler->handle($info, $param);

        # remove credentials after api call
        PVE::RPCEnvironment->get()->set_credentials(undef);

        # TODO: remove 'download' check with PVE 9.0
        if (
            ref($data) eq 'HASH'
            && ref($data->{download}) eq 'HASH'
            && ($info->{download_allowed} || $info->{download})
        ) {
            $data = $handle_streamed_response->($data->{download});
        }
    }

    return if $opt_nooutput || $stdopts->{quiet};

    PVE::CLIFormatter::print_api_result($data, $info->{returns}, undef, $stdopts);
}

__PACKAGE__->register_method({
    name => 'ls',
    path => 'ls',
    method => 'GET',
    description => "List child objects on <api_path>.",
    parameters => {
        additionalProperties => 0,
        properties => $cond_add_standard_output_properties->($path_properties),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $path = PVE::Tools::extract_param($param, 'api_path');

        my $stdopts = PVE::RESTHandler::extract_standard_output_properties($param);

        my $uri_param = {};
        my ($handler, $info) = PVE::API2->find_handler('GET', $path, $uri_param);
        if (!$handler || !$info) {
            die "no such resource '$path'\n";
        }

        my $link = PVE::JSONSchema::method_get_child_link($info);
        die "resource '$path' does not define child links\n" if !$link;

        my $res;

        my ($node, $remip) = check_proxyto($info, $uri_param, $param);
        if ($node) {
            $res = proxy_handler($node, $remip, $path, 'ls', $param);
        } else {
            foreach my $p (keys %$uri_param) {
                $param->{$p} = $uri_param->{$p};
            }

            my $data = $handler->handle($info, $param);

            my $children = extract_children($link, $data);

            $res = [];
            foreach my $c (@$children) {
                my $item = { name => $c, capabilities => resource_cap("$path/$c") };
                push @$res, $item;
            }
        }

        my $schema = { type => 'array', items => { type => 'object' } };
        $stdopts->{sort_key} = 'name';
        $stdopts->{noborder} //= 1;
        $stdopts->{noheader} //= 1;
        PVE::CLIFormatter::print_api_result($res, $schema, ['capabilities', 'name'], $stdopts);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'get',
    path => 'get',
    method => 'GET',
    description => "Call API GET on <api_path>.",
    parameters => {
        additionalProperties => 0,
        properties => $cond_add_standard_output_properties->($path_properties),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        call_api_method('get', $param);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'set',
    path => 'set',
    method => 'PUT',
    description => "Call API PUT on <api_path>.",
    parameters => {
        additionalProperties => 0,
        properties => $cond_add_standard_output_properties->($path_properties),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        call_api_method('set', $param);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'create',
    path => 'create',
    method => 'POST',
    description => "Call API POST on <api_path>.",
    parameters => {
        additionalProperties => 0,
        properties => $cond_add_standard_output_properties->($path_properties),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        call_api_method('create', $param);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'delete',
    path => 'delete',
    method => 'DELETE',
    description => "Call API DELETE on <api_path>.",
    parameters => {
        additionalProperties => 0,
        properties => $cond_add_standard_output_properties->($path_properties),
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        call_api_method('delete', $param);

        return undef;
    },
});

__PACKAGE__->register_method({
    name => 'usage',
    path => 'usage',
    method => 'GET',
    description => "print API usage information for <api_path>.",
    parameters => {
        additionalProperties => 0,
        properties => {
            api_path => $api_path_property,
            verbose => {
                description => "Verbose output format.",
                type => 'boolean',
                optional => 1,
            },
            returns => {
                description => "Including schema for returned data.",
                type => 'boolean',
                optional => 1,
            },
            command => {
                description => "API command.",
                type => 'string',
                enum => [keys %$method_map],
                optional => 1,
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $path = $param->{api_path};

        my $found = 0;
        foreach my $cmd (qw(get set create delete)) {
            next if $param->{command} && $cmd ne $param->{command};
            my $method = $method_map->{$cmd};
            my $uri_param = {};
            my ($handler, $info) = PVE::API2->find_handler($method, $path, $uri_param);
            next if !$handler;
            $found = 1;

            if ($param->{verbose}) {
                print $handler->usage_str(
                    $info->{name},
                    "pvesh $cmd $path",
                    undef,
                    $uri_param,
                    'full',
                );

            } else {
                print "USAGE: "
                    . $handler->usage_str(
                        $info->{name},
                        "pvesh $cmd $path",
                        undef,
                        $uri_param,
                        'short',
                    );
            }
            if ($param->{returns}) {
                my $schema =
                    to_json($info->{returns}, { utf8 => 1, canonical => 1, pretty => 1 });
                print "RETURNS: $schema\n";
            }
        }

        if (!$found) {
            if ($param->{command}) {
                die "no '$param->{command}' handler for '$path'\n";
            } else {
                die "no such resource '$path'\n";
            }
        }

        return undef;
    },
});

our $cmddef = {
    usage => [__PACKAGE__, 'usage', ['api_path']],
    get => [__PACKAGE__, 'get', ['api_path']],
    ls => [__PACKAGE__, 'ls', ['api_path']],
    set => [__PACKAGE__, 'set', ['api_path']],
    create => [__PACKAGE__, 'create', ['api_path']],
    delete => [__PACKAGE__, 'delete', ['api_path']],
};

1;
