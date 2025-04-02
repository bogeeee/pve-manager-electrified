<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>[% nodename %] - Proxmox Virtual Environment</title>
    <link rel="icon" sizes="128x128" href="images/logo-128.png" />
    <link rel="apple-touch-icon" sizes="128x128" href="images/logo-128.png" />
    <link rel="stylesheet" type="text/css" href="/usr/share/javascript/extjs/theme-crisp/resources/theme-crisp-all.css" />
    <link rel="stylesheet" type="text/css" href="/usr/share/javascript/extjs/crisp/resources/charts-all.css" />
    <link rel="stylesheet" type="text/css" href="/usr/share/fonts-font-awesome/css/font-awesome.css" />
    <link rel="stylesheet" type="text/css" href="/usr/share/fonts-font-logos/fonts/font-logos.css" />
    <link rel="stylesheet" type="text/css" href="/css/ext6-pve.css" />
    <link rel="stylesheet" type="text/css" href="/usr/share/javascript/proxmox-widget-toolkit/css/ext6-pmx.css" />

    <!-- $...$ are replaced in index.ts#serveIndexHtml -->
    $THEME$

    $LANGFILE$

    <script type="text/javascript" src="/pve2/ext6/ext-all$DEBUG_EXT_ALL$.js"></script>
    <script type="text/javascript" src="/pve2/ext6/charts$DEBUG_CHARTS$.js"></script>

    <script type="text/javascript" src="/u2f-api.js"></script>
    <script type="text/javascript" src="/qrcode.min.js"></script>
    <script type="text/javascript">
    Proxmox = {
	Setup: { auth_cookie_name: 'PVEAuthCookie' },
	defaultLang: '[% lang %]',
	NodeName: '[% nodename %]',
	UserName: '[% username %]',
	CSRFPreventionToken: '[% token %]'
    };
    </script>
    <script type="text/javascript" src="/proxmoxlib.js?ver=$CACHEBREAKER$"></script>
    <!-- manager6 nonmodule scripts: -->
    $INCLUDE_MANAGER6_NONMODULE_SCRIPTS$

    <script type="text/javascript" src="/manager6/OnlineHelpInfo.js?ver=$CACHEBREAKER$"></script>

    <script type="text/javascript" src="/pve2/ext6/locale/locale-[% lang %].js?ver=$CACHEBREAKER$"></script>


    <script type="text/javascript">
    if (typeof(PVE) === 'undefined') PVE = {};
    Ext.History.fieldid = 'x-history-field';
    Ext.onReady(function() { Ext.create('PVE.StdWorkspace');});
    </script>

  </head>
  <body>
    <!-- Fields required for history management -->
    <form id="history-form" class="x-hidden">
    <input type="hidden" id="x-history-field"/>
    </form>
  </body>
</html>
