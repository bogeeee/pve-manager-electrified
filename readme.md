![](docs/images/pve-electrified_logo_text.png)

# PVE electrified

This is a modification of the [Proxmox Virtual Environment](https://www.proxmox.com/en/products/proxmox-virtual-environment/overview) **user interface**, that brings some nice features, mainly for homelab'ers.
PVE electrified is **independant** of the company Proxmox. Also, it adds a plugin system and lifts PVE to a very developer friendly architecture, because in the past it was so hard for developers to enhance the PVE UI that almost no community mods existed.

# Features
- **CPU usage bars** in the tree. Updated in realtime.[^1]  
  ![](docs/images/Screenshot_cpu_bars.png)  
  [^1]: Realtime = 1 second interval. As this comes with some cost, on systems with many lxcs, the interval will increase automatically.
- **A plugin system** that allows to easily [create and publish UI plugins](https://github.com/bogeeee/pve-manager-electrified/blob/main/docs/plugin-development.md).  
  ![](docs/images/Screenshot_plugin_manager.png)
- PLANNED: Show real thin **disk usage** in the tree.
- PLANNED: **Instant cloning** of guests from zfs snapshots.
- PLANNED: **Docker support**.
- PLANNED: **Assistants for several small optimizations for home-lab usage:** Gpu passthrough; Dynamic ip; Prevent ssd wear-down; Install microcode update packages; Fix zfs memory settings; Fix disk stalling; Warn on simultaneous USB device use; Show password prompts for encrypted disks;

_Features are developed for **home-lab users first**. That's the most reasonable to focus on as a free-time open source developer. If you need features refined for enterprise grade (i.e. working with non-admin permissions), you still have the option [to pay me working on them](mailto:bogeee@bogitech.de)._

## Install
Requires PVE 9.x or later.
````
wget https://pve-electrified.net/pubkey.asc -O /etc/apt/trusted.gpg.d/pve-electrified.asc && \
apt install -y lsb-release && \
echo "deb https://pve-electrified.net/debian $(lsb_release -c -s) main" >> /etc/apt/sources.list
apt update
apt install -y pve-manager-electrified
````

## Uninstall

````
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
  .js files are also served. But instead of all in a non-debugging-friendly bigfile, they are listed as individual (Vite can still bundle them internally but then we have proper source mapping).
  React components are used in the mix with the old ExtJS 6 components.  
  Vite can also run in **dev server** mode. Then it watches the files and gives you fast reloading. Under `/webBuild`, There's control panel, where you can switch modes.

# Security consideration when using it in an enterprise
Read [here](https://github.com/bogeeee/pve-manager-electrified/blob/main/docs/security.md)

# Plugin development guide
See [here](https://github.com/bogeeee/pve-manager-electrified/blob/main/docs/plugin-development.md)
  
# Source code / license

[Source code on Github](https://github.com/bogeeee/pve-manager-electrified)  
[License](https://github.com/bogeeee/pve-manager-electrified/blob/main/debian/copyright). It meets GNU Affero General Public License, GPL and MIT. So it's luckily allowed to modify and republish the Proxmox's packages👍.  
[contact me](mailto:bogeee@bogitech.de)

# 100% handcrafted
Electrified code is 100% handcrafted with passion ❤, by an experienced software developer.
Contact me, if you need  features or if you have freelancer work to give out (in the EU, german / english speaking).