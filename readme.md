![](docs/images/pve-electrified_logo_text.png)

# PVE electrified

This is a modification of the [Proxmox Virtual Environment](https://www.proxmox.com/en/products/proxmox-virtual-environment/overview) 
**user interface**, that brings some nice features, mainly for homelab'ers.


## Install

````bash
wget https://pve-electrified.net/pubkey.asc -O /etc/apt/trusted.gpg.d/pve-electrified.asc
add-apt-repository -y "deb https://pve-electrified.net/debian bookworm main"
apt install -y pve-manager-electrified
````

## Uninstall

````bash
apt install -y pve-manager-electrified- pve-manager+
````
