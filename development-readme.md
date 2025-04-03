# Install a development environment

See the [official docs: Install build prerequisites for development environment](https://git.proxmox.com/?p=pve-common.git;a=blob_plain;f=README.dev;hb=HEAD),
or skip these and do this on a PVE server:
````shell
apt-get install build-essential git git-email debhelper pve-doc-generator
mkdir -p /root/proxmox
cd /root/proxmox
git clone TODO: link to this repo
cd pve-manager-electrified
mk-build-deps --install
````

# IDE (on a different dev machine)
- Either use vscode with the "Remote SSH" plugin and connect the /root/proxmox/pve-manager-electrified project folder on the PVE server. This way, you can debug the nodejsserver seamlessly.
- Or use Jetbrains Webstorm. It also has a remote SSH feature. Similar to the above.
- Or use an older Jetbrains IDE and configure an automatic deployment. Make sure, the `.git` folder is not excluded from syncing, cause the make scripts expect, that there's such a folder, to automatically extract version information  

#Run
dev_run.sh

TODO: also run the nodejs server

# 


