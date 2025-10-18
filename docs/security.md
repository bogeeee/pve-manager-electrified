# Security

PVE electrified's main goal is to allow faster coding of new features. That's why it uses a different architecture for serving the web, based on Node.js.
So here are the things listed, that are different to the original proxmox's pve-manager in terms of security, so you can revise it.

# Supply chain

- `apt install pve-manager-electrified` adds ~470 additional debian packages for Node.js and npm
- For the nodejsserver code, after install, there are ~300 Node.js packages installed. You can find them under `/usr/share/pve-manager-nodejsserver/node_modules`
- For the client/web, there are TODO:how-many Node.js packages installed. You can find them under: `/var/lib/pve-manager/bundledWww/node_modules`
  - These packages have pinned versions, cause exploit ability is considered lower that a future supply chain attack:
    - **react-draggable + it's dependencies** See commit c65e7a7c.
- Npm is run for the server and web packages **with the --ignore-scripts argument**, for some extra security. A lot of code paths are not used in reality and even complete packages are often listed but not actually used. So this doesn't give them a hook upfront.
- Npm is currently run with --no-audit. This ignores warnings about critical security vulnerabilities but prevents the situation suddenly not starting up anymore just because of a **theroretical** threat. TODO: run npm audit later **at runtime** and warn the user in the ui.

# CSRF protection
- For classic, API calls, the CSRFToken is handed by index.html to a (non http-only) cookie. This is the original behaviour. The nodejsserver extracts it from the original index.html on port 8005 and serves it in the new GET-only index.html which is also not readable cross-origin. 
- The `/electrifiedAPI` uses Restfuncs (which is written by the PVE-electrified author) which uses [it's own CSRF protection and websocket hijacking protection](https://github.com/bogeeee/restfuncs?tab=readme-ov-file#csrf-protection).

# Proxying/ IP restrictions

- As the nodejsserver proxies all requests to the original server, later one sees them as coming from **localhost**!
  **It has to be investigated, how this could be an issue!**
- Also, IP filter settings for the UI and Proxmox's PROXY_REAL_IP_HEADER and PROXY_REAL_IP_ALLOW_FROM currently don't work and **are not yet implemented as you're reading this**!! 
  **This has to be fixed**.
- Custom IP filters and ssl settings from /etc/default/pveproxy have no effect with PVE electrified.
- The original server on port 8005 is bound to localhost/loopback interface only👍.

# Web code

Compared to classic proxmox, the processing is shifted much more towards the client (browser). 
Pve-electrified- or plugin client code request the server directly to run shell commands. The server will check, if the current web user has root permissions (yes, you must be logged in as root, for most of the new features, this is a bit the downside here).
This different paradigm doesn't weaken security, because it's the same semantics: If someone pwns the browser, we're screwed in both cases.
The logon state will be cached in the pve-electrified's browser session (opposed to the **original pve server on 8005**'s browser session). This allows us fast websocket calls for the small price that **logouts** get propagated a few seconds later.
TODO: implement regular login-state polling, to propagate logouts.

  
# Development mode

PVE-electrified can run in development mode. Then the vite-devserver is used. You'll see it in the main toolbar then, or you can check the status under the url `https://your-pve/webBuild `.
When not enabled, PVE-manager-electrified prevents access to the vite-devserver's paths and also does not forward websocket connections to it (to port 8055). 
Cause this vite-devserver's API was only meant for development mode. 
When enabled, forwarding to it is only individually allowed for users that are logged in and have `Sys.Console` permission.
Also, a same-origin check against the request headers is performed to prevent xsrf. So switching on the vite-devserver in production is sufficiently secured (there may be valid reasons to use it, i.e. the admin wants to edit a button).    

The vite devserver internally listens for hmr websocket connections on port 8055. It's bound to localhost/loopback interface only👍. Still that port is always bound, even when the devserver is not used (for internal reasons, cause express is rather static and always needs the middleware object upfront).
TODO: Add a config option to completely disable the vite devserver.

<hr/>

[Contact me](mailto:bogeee@bogitech.de) if you need further security- auditing/hardening/advisory