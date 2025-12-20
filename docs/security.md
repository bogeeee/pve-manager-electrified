# Security

PVE electrified's main goal is to allow faster coding of new features. That's why it uses a different architecture for serving the web, based on Node.js and NPM.
So here are the things listed, that are different to the original proxmox's pve-manager in terms of security, so you can revise it:


# Supply chain

- `apt install pve-manager-electrified` adds ~470 additional debian packages for Node.js and npm
- For the nodejsserver code, after install, there are ~300 Node.js packages installed. You can find them under `/usr/share/pve-manager-nodejsserver/node_modules`
- For the client/web, there are ~100 packages installed + again those from nodejsserver. You can find them under: `/usr/share/pve-manager/node_modules`
  - The following packages have pinned versions, because exploit ability is considered lower than a future supply chain attack:
    - **react-draggable + it's dependencies** See commit c65e7a7c.
- Npm is run for the server and for the web **with the --ignore-scripts argument**, for some extra security. A lot of code paths are not used in reality and even complete packages are often listed but not actually used. So this doesn't give them a hook upfront.
- Npm is currently run with --no-audit. This ignores warnings about critical security vulnerabilities but prevents the situation suddenly not starting up anymore just because of a **theroretical** threat. TODO: run npm audit later **at runtime** and warn the user in the ui.

_As an open source author, i'm feeling very responsible for security in my own code and carefully select dependent libraries, but **i have no resources to constantly monitor all transient dependent libraries**. So it's up to you, to regularly investigate here._

# CSRF protection
- For classic, API calls, the CSRFToken is handed by index.html to a (non http-only) cookie. This is the original behaviour. The nodejsserver extracts it from the original index.html on port 8005 and serves it in the new GET-only index.html which is also not readable cross-origin. 
- The `/electrifiedAPI` uses Restfuncs (which is written by the PVE-electrified author) which uses [it's own CSRF protection and websocket hijacking protection](https://github.com/bogeeee/restfuncs?tab=readme-ov-file#csrf-protection).

# Proxying/ IP restrictions

- Settings from [/etc/default/pveproxy (access control, listening ip, ssl, ...)](https://pve.proxmox.com/pve-docs/pveproxy.8.html#pveproxy_host_acls) have no effect with PVE electrified. So a warning is displayed, if that file is found.
- The original server on port 8005 (pveproxy) is bound to localhost/loopback interface only👍.

# Web code

Compared to classic proxmox, the processing is shifted much more towards the client (browser). 
Pve-electrified- or plugin client code can request the server directly to run shell commands, if the client is authorized with `Sys.console` permission. _So, you must have this permission for a lot of the new features. This is a bit the downside here, feature wise_.
The `pvenodejsserver` services runs as root therefore (opposed to the original `pveproxxy` which runs as `www-data` with limited permissions and controls the `pvedaemon` with root permissions).
This different paradigm doesn't weaken security per se, because it's the same semantics: If someone pwns the browser or the front-facing service, we're screwed in both cases (classic/electrified).

# Permissions / logon state
The logon state and user's permissions will be cached in the **pve-electrified-**(pvenodejsserver)'s browser session, additionally to the **original** pveproxy on 8005's browser session, holding it. This allows us fast websocket calls for the small price that **logouts** might get propagated a few seconds later (10 seconds in prod, 2hours in vite-devserver mode). A manual logout in the ui also clears the permission cache. 
  
# Development mode

PVE-electrified can run in development mode. Then the vite-devserver is used. You'll see it in the main toolbar then, or you can check the status under the url `https://your-pve/webBuild `.
Because the vite-devserver, as the name says, was never meant to be used in production and can't be considered secure itself.
So, when not enabled, or the user is not authorized with `Sys.Console` permission, PVE-manager-electrified **prevents access** to the vite-devserver's paths **and also does not forward websocket connections** to it (to port 8055). 
For permissions, the current cookie-session is checked. Also, a same-origin check against the request headers is performed to prevent xsrf. So switching on the vite-devserver in production is sufficiently secured (there may be valid reasons to use it, i.e. the admin wants to edit a button).    

The vite devserver internally listens for hmr websocket connections on port 8055. It's bound to localhost/loopback interface only👍. Still that port is always bound, even when the devserver is not used (for internal reasons, cause express is rather static and always needs the middleware object upfront).
TODO: Add a config option to completely disable the vite devserver.

<hr/>

[Contact me](mailto:bogeee@bogitech.de) if you need further security- auditing/hardening/advisory