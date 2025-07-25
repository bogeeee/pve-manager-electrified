![](docs/images/pve-electrified_logo_text.png)

# PVE electrified

This is a modification of the [Proxmox Virtual Environment](https://www.proxmox.com/en/products/proxmox-virtual-environment/overview) **user interface**, that brings some nice features, mainly for homelab'ers. 
The goal is also, to provide a plugin system and give plugin authors the tools to develop such and publish them with very little effort. 

# Currently it' developer's summer pause
Saw no updates recently here/on github? That's because i'm making a summer break presumably till the end of August.
If you have **commercial/paid** interest on getting this project done faster,  or want some urgent features, then write me. So i can focus more on this one and don't have to catch other customer projects for my earnings then.  

## Install
**!!!!It's not yet releaed!!!. Please be patient!** Here, you'll find some random in-development release in the meanwhile.
````bash
wget https://pve-electrified.net/pubkey.asc -O /etc/apt/trusted.gpg.d/pve-electrified.asc
echo "deb https://pve-electrified.net/debian bookworm main" >> /etc/apt/sources.list
apt update && apt install -y pve-manager-electrified
````

## Uninstall

````bash
apt install -y pve-manager-electrified- pve-manager+
````


# Behind the scenes / architecture
These are the differences to the original pve-manager package from Proxmox: These are mainly intended, to improve the developer experience.

- Backend:
  Pve-manager-electrified starts a nodejs webserver, which is written in Typescript, so we have more modern language
  here than Perl. This webserver (port 8006) proxies some of the http and websocket paths, like to `/pve2`, `/novnc`, `/xtermjs`
  , `pwt`, `/api2` to the original pve backend server (called pveproxy)
  which is also/still running but was just moved to a different (internal) port: 8005.
- Frontend:
  Each time, when started, the nodejs webserver uses **vite**, to bundle the web files. This way, we can have the most modern web
  techniques like React, Typescript, npm dependency management and fast reloading during development (during dev, it starts a vite devserver). The old original
  .js files are also served. But instead of all in a non-debugging-friendly bigfile, they are listed as individually (Vite can still bundle them internally but then we have proper source mapping).
  React components are used in the mix with the old ExtJS 6 components.  
  Vite can also run in **dev server** mode. Then it watches the files and gives you fast reloading. Under `/webBuild`, There's control panel, where you can switch modes.

# Security consideration when using it in an enterprise
Read [here](https://github.com/bogeeee/pve-manager-electrified/blob/main/docs/security.md)
  
# Source code / license

[Source code on Github](https://github.com/bogeeee/pve-manager-electrified)  
[License](https://github.com/bogeeee/pve-manager-electrified/blob/main/debian/copyright). It meets GNU Affero General Public License, GPL and MIT. So it's luckily allowed to modify and republish the Proxmox's packages👍.
