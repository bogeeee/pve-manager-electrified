package PVE::Service::pveproxy;

use strict;
use warnings;

use Data::Dumper;
use Encode;
use HTTP::Response;
use Template;
use URI::QueryParam;
use URI;

use PVE::API2;
use PVE::APIServer::AnyEvent;
use PVE::APIServer::Formatter::HTML;
use PVE::APIServer::Formatter::Standard;
use PVE::APIServer::Formatter;
use PVE::APIServer::Utils;
use PVE::Cluster;
use PVE::Daemon;
use PVE::DataCenterConfig;
use PVE::HTTPServer;
use PVE::SafeSyslog;
use PVE::pvecfg;
use PVE::Tools;

use base qw(PVE::Daemon);

my $cmdline = [$0, @ARGV];

my %daemon_options = (
    max_workers => 3,
    restart_on_error => 5,
    stop_wait_time => 15,
    leave_children_open_on_reload => 1,
    setuid => 'www-data',
    setgid => 'www-data',
    pidfile => '/var/run/pveproxy/pveproxy.pid',
);

my $daemon = __PACKAGE__->new('pveproxy', $cmdline, %daemon_options);

sub add_dirs {
    my ($result_hash, $alias, $subdir) = @_;

    PVE::APIServer::AnyEvent::add_dirs($result_hash, $alias, $subdir);
}

my $basedirs = {
    docs => '/usr/share/pve-docs',
    extjs => '/usr/share/javascript/extjs',
    fontawesome => '/usr/share/fonts-font-awesome',
    fontlogos => '/usr/share/fonts-font-logos',
    i18n => '/usr/share/pve-i18n',
    manager => '/usr/share/pve-manager-electrified',
    novnc => '/usr/share/novnc-pve',
    sencha_touch => '/usr/share/javascript/sencha-touch',
    widgettoolkit => '/usr/share/javascript/proxmox-widget-toolkit',
    xtermjs => '/usr/share/pve-xtermjs',
};

sub init {
    my ($self) = @_;

    # we use same ALLOW/DENY/POLICY as pveproxy
    my $proxyconf = PVE::APIServer::Utils::read_proxy_config($self->{name});

    my $accept_lock_fn = "/var/lock/pveproxy.lck";

    my $lockfh = IO::File->new(">>${accept_lock_fn}") ||
	die "unable to open lock file '${accept_lock_fn}' - $!\n";

    my $listen_ip = $proxyconf->{LISTEN_IP};
    my $socket = $self->create_reusable_socket(8005, $listen_ip);

    my $dirs = {};

    add_dirs($dirs, '/novnc/' => "$basedirs->{novnc}/");
    add_dirs($dirs, '/pve-docs/' => "$basedirs->{docs}/");
    add_dirs($dirs, '/pve-docs/api-viewer/extjs/' => "$basedirs->{extjs}/");
    add_dirs($dirs, '/pve2/css/' =>  "$basedirs->{manager}/css/");
    add_dirs($dirs, '/pve2/ext6/', "$basedirs->{extjs}/");
    add_dirs($dirs, '/pve2/fa/css/' =>  "$basedirs->{fontawesome}/css/");
    add_dirs($dirs, '/pve2/fa/fonts/' =>  "$basedirs->{fontawesome}/fonts/");
    add_dirs($dirs, '/pve2/font-logos/' =>  "$basedirs->{fontlogos}/");
    add_dirs($dirs, '/pve2/images/' =>  "$basedirs->{manager}/images/");
    add_dirs($dirs, '/pve2/js/' =>  "$basedirs->{manager}/js/");
    add_dirs($dirs, '/pve2/locale/', "$basedirs->{i18n}/");
    add_dirs($dirs, '/pve2/sencha-touch/', "$basedirs->{sencha_touch}/");
    add_dirs($dirs, '/pve2/touch/', "$basedirs->{manager}/touch/");
    add_dirs($dirs, '/pwt/css/' => "$basedirs->{widgettoolkit}/css/");
    add_dirs($dirs, '/pwt/images/' => "$basedirs->{widgettoolkit}/images/");
    add_dirs($dirs, '/pwt/themes/' => "$basedirs->{widgettoolkit}/themes/");
    add_dirs($dirs, '/xtermjs/' => "$basedirs->{xtermjs}/");

    $self->{server_config} = {
	title => 'Proxmox VE API',
	keep_alive => 100,
	max_conn => 500,
	max_requests => 1000,
	lockfile => $accept_lock_fn,
	socket => $socket,
	lockfh => $lockfh,
	debug => $self->{debug},
	trusted_env => 0, # not trusted, anyone can connect
	logfile => '/var/log/pveproxy/access.log',
	allow_from => $proxyconf->{ALLOW_FROM},
	deny_from => $proxyconf->{DENY_FROM},
	policy => $proxyconf->{POLICY},
	ssl => {
	    cipher_list => $proxyconf->{CIPHERS},
	    ciphersuites => $proxyconf->{CIPHERSUITES},
	    key_file => '/etc/pve/local/pve-ssl.key',
	    cert_file => '/etc/pve/local/pve-ssl.pem',
	    honor_cipher_order => $proxyconf->{HONOR_CIPHER_ORDER},
	},
	compression => $proxyconf->{COMPRESSION},
	proxy_real_ip_header => $proxyconf->{PROXY_REAL_IP_HEADER},
	proxy_real_ip_allow_from => $proxyconf->{PROXY_REAL_IP_ALLOW_FROM},
	# Note: there is no authentication for those pages and dirs!
	pages => {
	    '/' => sub { get_index($self->{nodename}, @_) },
	    '/proxmox_state' => sub { get_proxmox_state($self->{nodename}, @_) },
	    # avoid authentication when accessing favicon
	    '/favicon.ico' => {
		file => "$basedirs->{manager}/images/favicon.ico",
	    },
	    '/proxmoxlib.js' => {
		file => "$basedirs->{widgettoolkit}/proxmoxlib.js",
	    },
	    '/qrcode.min.js' => {
		file => '/usr/share/javascript/qrcodejs/qrcode.min.js',
	    },
	},
	dirs => $dirs,
    };

    if (defined($proxyconf->{DHPARAMS})) {
	$self->{server_config}->{ssl}->{dh_file} = $proxyconf->{DHPARAMS};
    }
    if (defined($proxyconf->{DISABLE_TLS_1_2})) {
	$self->{server_config}->{ssl}->{tlsv1_2} = !$proxyconf->{DISABLE_TLS_1_2};
    }
    if (defined($proxyconf->{DISABLE_TLS_1_3})) {
	$self->{server_config}->{ssl}->{tlsv1_3} = !$proxyconf->{DISABLE_TLS_1_3};
    }
    my $custom_key_path = '/etc/pve/local/pveproxy-ssl.key';
    if (defined($proxyconf->{TLS_KEY_FILE})) {
	$custom_key_path = $proxyconf->{TLS_KEY_FILE};
    }
    if (-f '/etc/pve/local/pveproxy-ssl.pem' && -f $custom_key_path) {
	$self->{server_config}->{ssl}->{cert_file} = '/etc/pve/local/pveproxy-ssl.pem';
	$self->{server_config}->{ssl}->{key_file} = $custom_key_path;
	syslog('info', 'Using \'/etc/pve/local/pveproxy-ssl.pem\' as certificate for the web interface.');
    }
}

sub run {
    my ($self) = @_;

    my $server = PVE::HTTPServer->new(%{$self->{server_config}});
    $server->run();
}

$daemon->register_start_command();
$daemon->register_restart_command(1);
$daemon->register_stop_command();
$daemon->register_status_command();

our $cmddef = {
    start => [ __PACKAGE__, 'start', []],
    restart => [ __PACKAGE__, 'restart', []],
    stop => [ __PACKAGE__, 'stop', []],
    status => [ __PACKAGE__, 'status', [], undef, sub { print shift . "\n";} ],
};

sub is_phone {
    my ($ua) = @_;

    return 0 if !$ua;

    return 1 if $ua =~ m/(iPhone|iPod|Windows Phone)/;

    if ($ua =~ m/Mobile(\/|\s)/) {
	return 1 if $ua =~ m/(BlackBerry|BB)/;
	return 1 if ($ua =~ m/(Android)/) && ($ua !~ m/(Silk)/);
    }

    return 0;
}

# NOTE: Requests to those pages are not authenticated
# so we must be very careful here

sub get_index {
    my ($nodename, $server, $r, $args) = @_;

    my $lang;
    my $username;
    my $token = 'null';
    my $theme = "auto";

    if (my $cookie = $r->header('Cookie')) {
	if (my $newlang = ($cookie =~ /(?:^|\s)PVELangCookie=([^;]*)/)[0]) {
	    if ($newlang =~ m/^[a-z]{2,3}(_[A-Z]{2,3})?$/) {
		$lang = $newlang;
	    }
	}

	if (my $newtheme = ($cookie =~ /(?:^|\s)PVEThemeCookie=([^;]*)/)[0]) {
	    # theme names need to be kebab case, with each segment a maximum of 10 characters long
	    # and at most 6 segments
	    if ($newtheme =~ m/^[a-z]{1,10}(-[a-z]{1,10}){0,5}$/) {
		$theme = $newtheme;
	    }
	}

	my $ticket = PVE::APIServer::Formatter::extract_auth_value($cookie, $server->{cookie_name});
	if (($username = PVE::AccessControl::verify_ticket($ticket, 1))) {
	    $token = PVE::AccessControl::assemble_csrf_prevention_token($username);
	}
    }

    if (!$lang) {
	my $dc_conf = PVE::Cluster::cfs_read_file('datacenter.cfg');
	$lang = $dc_conf->{language} // 'en';
    }

    my $mobile = (is_phone($r->header('User-Agent')) && (!defined($args->{mobile}) || $args->{mobile})) || $args->{mobile};

    my $novnc = defined($args->{console}) && $args->{novnc};
    my $xtermjs = defined($args->{console}) && $args->{xtermjs};

    my $langfile = -f "$basedirs->{i18n}/pve-lang-$lang.js" ? 1 : 0;

    my $version = PVE::pvecfg::version();

    my $wtversionraw = PVE::Tools::file_read_firstline("$basedirs->{widgettoolkit}/proxmoxlib.js");
    my $wtversion = $wtversionraw =~ m|^// (.*)$| ? $1 : '';

    my $debug = $server->{debug};
    if (exists $args->{debug}) {
	$debug = !defined($args->{debug}) || $args->{debug};
    }

    my $vars = {
	lang => $lang,
	langfile => $langfile,
	username => $username || '',
	token => $token,
	console => $args->{console},
	nodename => $nodename,
	debug => $debug,
	version => "$version",
	wtversion => $wtversion,
	theme => $theme,
    };

    # by default, load the normal index
    my $dir = $basedirs->{manager};

    if ($novnc) {
	$dir = $basedirs->{novnc};
    } elsif ($xtermjs) {
	$dir = $basedirs->{xtermjs};
    } elsif ($mobile) {
	$dir = "$basedirs->{manager}/touch";
    }

    my $page = '';
    my $template = Template->new({ABSOLUTE => 1});

    $template->process("$dir/index.html.tpl", $vars, \$page) || die $template->error(), "\n";

    my $headers = HTTP::Headers->new(Content_Type => "text/html; charset=utf-8");
    my $resp = HTTP::Response->new(200, "OK", $headers, $page);

    return $resp;
}


# get things for pve-electrified that it can't retrieve on it's own, like user, language and csrftoken
# NOTE: Requests to those pages are not authenticated
# so we must be very careful here
sub get_proxmox_state {
    my ($nodename, $server, $r, $args) = @_;

    my $lang;
    my $username;
    my $token = 'null';
    my $theme = "auto";

    if (my $cookie = $r->header('Cookie')) {
	if (my $newlang = ($cookie =~ /(?:^|\s)PVELangCookie=([^;]*)/)[0]) {
	    if ($newlang =~ m/^[a-z]{2,3}(_[A-Z]{2,3})?$/) {
		$lang = $newlang;
	    }
	}

	if (my $newtheme = ($cookie =~ /(?:^|\s)PVEThemeCookie=([^;]*)/)[0]) {
	    # theme names need to be kebab case, with each segment a maximum of 10 characters long
	    # and at most 6 segments
	    if ($newtheme =~ m/^[a-z]{1,10}(-[a-z]{1,10}){0,5}$/) {
		$theme = $newtheme;
	    }
	}

	my $ticket = PVE::APIServer::Formatter::extract_auth_value($cookie, $server->{cookie_name});
	if (($username = PVE::AccessControl::verify_ticket($ticket, 1))) {
	    $token = PVE::AccessControl::assemble_csrf_prevention_token($username);
	}
    }

    if (!$lang) {
	my $dc_conf = PVE::Cluster::cfs_read_file('datacenter.cfg');
	$lang = $dc_conf->{language} // 'en';
    }

    my $mobile = (is_phone($r->header('User-Agent')) && (!defined($args->{mobile}) || $args->{mobile})) || $args->{mobile};

    my $novnc = defined($args->{console}) && $args->{novnc};
    my $xtermjs = defined($args->{console}) && $args->{xtermjs};

    my $langfile = -f "$basedirs->{i18n}/pve-lang-$lang.js" ? 1 : 0;

    my $version = PVE::pvecfg::version();

    my $wtversionraw = PVE::Tools::file_read_firstline("$basedirs->{widgettoolkit}/proxmoxlib.js");
    my $wtversion = $wtversionraw =~ m|^// (.*)$| ? $1 : '';

    my $debug = $server->{debug};
    if (exists $args->{debug}) {
	$debug = !defined($args->{debug}) || $args->{debug};
    }

    my $vars = {
	lang => $lang,
	langfile => $langfile,
	username => $username || '',
	token => $token,
	console => $args->{console},
	nodename => $nodename,
	debug => $debug,
	version => "$version",
	wtversion => $wtversion,
	theme => $theme,
    };

    # by default, load the normal index
    my $dir = $basedirs->{manager};

    my $page = '';
    my $template = Template->new({ABSOLUTE => 1});

    $template->process("$dir/proxmoxState.json.tpl", $vars, \$page) || die $template->error(), "\n";

    my $headers = HTTP::Headers->new(Content_Type => "application/json");
    my $resp = HTTP::Response->new(200, "OK", $headers, $page);

    return $resp;
}

1;
