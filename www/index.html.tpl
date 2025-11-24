<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>[% nodename %] - Proxmox Virtual Environment</title>
    <link rel="icon" sizes="128x128" href="images/pve-electrified_logo.png" />
    <link rel="apple-touch-icon" sizes="128x128" href="images/pve-electrified_logo.png" />
    <!-- Urls, not under this www directory, are prefixed with 'https://remove_this_prefix', so the bundler will not touch them and not complain. The server.ts#serveIndexHtml method later removes the prefix when serving -->
    <link rel="stylesheet" type="text/css" href="https://remove_this_prefix/pve2/ext6/theme-crisp/resources/theme-crisp-all.css?ver=$CACHEBREAKER$" />
    <link rel="stylesheet" type="text/css" href="https://remove_this_prefix/pve2/ext6/crisp/resources/charts-all.css?ver=$CACHEBREAKER$" />
    <link rel="stylesheet" type="text/css" href="https://remove_this_prefix/pve2/fa/css/font-awesome.css" />
    <link rel="stylesheet" type="text/css" href="https://remove_this_prefix/pve2/font-logos/css/font-logos.css" />
    <link rel="stylesheet" type="text/css" href="https://remove_this_prefix/pve2/css/ext6-pve.css?ver=$CACHEBREAKER$" />
    <link rel="stylesheet" type="text/css" href="https://remove_this_prefix/pwt/css/ext6-pmx.css?ver=$CACHEBREAKER$" />

    <!-- $...$ are replaced in index.ts#serveIndexHtml -->
    $THEME$

    $LANGFILE$

    <script type="text/javascript" src="/electrified/diagnosis_checkAuthorizationForViteDevserver.js"></script>
    <script type="text/javascript" src="/pve2/ext6/ext-all$DEBUG_EXT_ALL$.js"></script>
    <script type="text/javascript" src="/pve2/ext6/charts$DEBUG_CHARTS$.js"></script>

    <script type="text/javascript" src="/u2f-api.js"></script>
    <script type="text/javascript" src="/qrcode.min.js"></script>
    <script type="text/javascript">
    Proxmox = $PROXMOXSTATE$;
    </script>
    <script type="text/javascript" src="/proxmoxlib.js?ver=$CACHEBREAKER$"></script>
    <script type="text/javascript" src="/proxmoxlib_bugfixes.js?ver=$CACHEBREAKER$"></script>
    <!-- manager6 nonmodule scripts: -->
    $INCLUDE_MANAGER6_NONMODULE_SCRIPTS$

    <script type="text/javascript" src="/manager6/OnlineHelpInfo.js?ver=$CACHEBREAKER$"></script>

    <script type="text/javascript" src="/pve2/ext6/locale/locale-[% lang %].js?ver=$CACHEBREAKER$"></script>

    <script type="module" src="./electrified/Application.ts"></script>

    <script type="text/javascript">
    if (typeof(PVE) === 'undefined') PVE = {};
    Ext.History.fieldid = 'x-history-field';
    Ext.onReady(async function() { await window.electrifiedAppPromise; Ext.create('PVE.StdWorkspace');});
    </script>

  </head>
  <body>
    <!-- Fields required for history management -->
    <form id="history-form" class="x-hidden">
    <input type="hidden" id="x-history-field"/>
    </form>
  </body>
</html>
