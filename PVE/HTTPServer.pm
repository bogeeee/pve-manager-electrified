package PVE::HTTPServer;

use strict;
use warnings;

use PVE::SafeSyslog;
use PVE::INotify;
use PVE::Tools;
use PVE::APIServer::AnyEvent;
use PVE::Exception qw(raise_param_exc raise_perm_exc raise);

use PVE::RPCEnvironment;
use PVE::AccessControl;
use PVE::CertCache;
use PVE::Cluster;
use PVE::API2Tools;

use Data::Dumper;

use base('PVE::APIServer::AnyEvent');

use HTTP::Status qw(:constants);

sub new {
    my ($this, %args) = @_;

    my $class = ref($this) || $this;
    my $self = $class->SUPER::new(%args);

    $self->{rpcenv} = PVE::RPCEnvironment->init(
        $self->{trusted_env} ? 'priv' : 'pub',
        atfork => sub { $self->atfork_handler() },
    );

    return $self;
}

sub verify_spice_connect_url {
    my ($self, $connect_str) = @_;

    my $rpcenv = $self->{rpcenv};
    $rpcenv->init_request();

    my ($vmid, $node, $port) = PVE::AccessControl::verify_spice_connect_url($connect_str);

    return ($vmid, $node, $port);
}

sub generate_csrf_prevention_token {
    my ($username) = @_;
    return PVE::AccessControl::assemble_csrf_prevention_token($username);
}

sub auth_handler {
    my ($self, $method, $rel_uri, $ticket, $token, $api_token, $peer_host) = @_;

    my $rpcenv = $self->{rpcenv};

    # set environment variables
    $rpcenv->set_user(undef);
    $rpcenv->set_language('C');
    $rpcenv->set_client_ip($peer_host);

    eval { $rpcenv->init_request() };
    raise("RPCEnvironment init request failed: $@\n") if $@;

    my $require_auth = 1;

    # explicitly allow some calls without auth
    if (
        ($rel_uri eq '/access/domains' && $method eq 'GET')
        || ($rel_uri eq '/access/ticket' && ($method eq 'GET' || $method eq 'POST'))
        || ($rel_uri eq '/access/vncticket' && $method eq 'POST')
        || ($rel_uri eq '/access/openid/login' && $method eq 'POST')
        || ($rel_uri eq '/access/openid/auth-url' && $method eq 'POST')
    ) {
        $require_auth = 0;
    }

    my ($username, $age);

    my $isUpload = 0;

    if ($require_auth) {
        if ($api_token) {
            # the token-ID `<user>@<realm>!<tokenname>` is the user for token based authentication
            $username = PVE::AccessControl::verify_token($api_token);
        } else {
            die "No ticket\n" if !$ticket;

            ($username, $age, my $tfa_info) = PVE::AccessControl::verify_ticket($ticket);
            $rpcenv->check_user_enabled($username);

            if (defined($tfa_info)) {
                if (defined(my $challenge = $tfa_info->{challenge})) {
                    $rpcenv->set_u2f_challenge($challenge);
                }
                die "No ticket\n" if ($rel_uri ne '/access/tfa' || $method ne 'POST');
            }
        }

        $rpcenv->set_user($username);

        if ($method eq 'POST' && $rel_uri =~ m|^/nodes/([^/]+)/storage/([^/]+)/upload$|) {
            my ($node, $storeid) = ($1, $2);
            # CSRF check are omitted if $isUpload is set, so check user upload permission here
            my $perm = { check => ['perm', "/storage/$storeid", ['Datastore.AllocateTemplate']] };
            $rpcenv->check_api2_permissions($perm, $username, {});
            $isUpload = 1;
        }

        # Skip CSRF check for file upload (difficult to pass CSRF header with native html forms).
        # Also skip the check with API tokens, as one of the design goals of API tokens was to
        # provide stateless API access without requiring round-trips to get such CSRF tokens.
        # CSRF-prevention also does not make much sense outside of the browser context.
        if ($method ne 'GET' && !($api_token || $isUpload)) {
            my $euid = $>;
            PVE::AccessControl::verify_csrf_prevention_token($username, $token) if $euid != 0;
        }
    }

    return {
        ticket => $ticket,
        token => $token,
        userid => $username,
        age => $age,
        isUpload => $isUpload,
        api_token => $api_token,
    };
}

sub rest_handler {
    my ($self, $clientip, $method, $rel_uri, $auth, $params) = @_;

    my $rpcenv = $self->{rpcenv};

    my $resp = {
        status => HTTP_NOT_IMPLEMENTED,
        message => "Method '$method $rel_uri' not implemented",
    };

    my ($handler, $info);

    eval {
        my $uri_param = {};
        ($handler, $info) = PVE::API2->find_handler($method, $rel_uri, $uri_param);
        return if !$handler || !$info;

        for my $p (sort keys %{$params}) {
            if (defined($uri_param->{$p}) && $uri_param->{$p} ne $params->{$p}) {
                raise_param_exc({
                    $p =>
                        "duplicate parameter (already defined in URI) with conflicting values!",
                });
            }
            $uri_param->{$p} = $params->{$p};
        }

        raise_perm_exc("URI '$rel_uri' not available with API token, need proper ticket.\n")
            if $auth->{api_token} && !$info->{allowtoken};

        # check access permissions
        $rpcenv->check_api2_permissions($info->{permissions}, $auth->{userid}, $uri_param);

        if ($info->{proxyto} || $info->{proxyto_callback}) {
            my $node = PVE::API2Tools::resolve_proxyto(
                $rpcenv,
                $info->{proxyto_callback},
                $info->{proxyto},
                $uri_param,
            );

            if ($node ne 'localhost' && $node ne PVE::INotify::nodename()) {
                die "unable to proxy file uploads" if $auth->{isUpload};
                my $remip = $self->remote_node_ip($node);
                $resp = { proxy => $remip, proxynode => $node, proxy_params => $params };
                return;
            }
        }

        my $euid = $>;
        if ($info->{protected} && ($euid != 0)) {
            $resp = { proxy => 'localhost', proxy_params => $params };
            return;
        }

        if ($info->{expose_credentials}) {
            $rpcenv->set_credentials($auth);
        }

        $resp = {
            data => $handler->handle($info, $uri_param),
            info => $info, # useful to format output
            status => HTTP_OK,
        };

        if (my $count = $rpcenv->get_result_attrib('total')) {
            $resp->{total} = $count;
        }

        if (my $diff = $rpcenv->get_result_attrib('changes')) {
            $resp->{changes} = $diff;
        }
    };
    my $err = $@;

    $rpcenv->set_user(undef); # clear after request
    $rpcenv->set_credentials(undef); # clear after request

    if ($err) {
        $resp = { info => $info };
        if (ref($err) eq "PVE::Exception") {
            $resp->{status} = $err->{code} || HTTP_INTERNAL_SERVER_ERROR;
            $resp->{errors} = $err->{errors} if $err->{errors};
            $resp->{message} = $err->{msg};
        } else {
            $resp->{status} = HTTP_INTERNAL_SERVER_ERROR;
            $resp->{message} = $err;
        }
    }

    return $resp;
}

sub check_cert_fingerprint {
    my ($self, $cert) = @_;
    return PVE::CertCache::check_cert_fingerprint($cert);
}

sub initialize_cert_cache {
    my ($self, $node) = @_;
    PVE::CertCache::initialize_cert_cache($node);
}

sub remote_node_ip {
    my ($self, $node) = @_;

    my $remip = PVE::Cluster::remote_node_ip($node);
    die "unable to get remote IP address for node '$node'\n" if !$remip;

    return $remip;
}

1;
