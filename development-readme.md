# Note: For plugin developers, see also
This document if for developing pve-manager-electried **it's self**. If you want to add features, you may more likely want to develop a plugin! See the [Plugin development guide](docs/plugin-development.md) instead.

# Install an IDE on a dev machine (which is a different machine than the PVE server)
As an IDE, ...
- ~~either use vscode with the "Remote SSH" plugin and connect the /root/proxmox/pve-manager-electrified project folder on the PVE server. This way, you can debug the nodejsserver seamlessly.~~
- or better use a Jetbrains IDE and configure an automatic deployment  (Tools->Deployment). Enable "delete target items".
  - Includes: 
     - `.git` folder. Make sure, it is not excluded from syncing, cause the make scripts expect, that there's such a folder, to automatically extract version information.
  - Excludes:    
    - Local: `/root/proxmox/pve-manager-electrified/nodejsserver/node_modules`
    - Local: `/root/proxmox/pve-manager-electrified/www/node_modules`
    - Local: `/root/proxmox/pve-manager-electrified/local.config.mk`
    - Remote: `/www/manager6/OnlineHelpInfo.js` . this file is a build artefact and should not be deleted by the sync.
With this setup, you have the .git / source code locally and can have a "burner" target PVE server, where you can leave a mess or hop between snapshots.



On the IDE machine:
````shell
git clone https://github.com/bogeeee/pve-manager-electrified.git
cd pve-manager-electrified
cp local.config.mk.sample local.config.mk
cp pve-manager-electrified-secrets.config.sample ~/pve-manager-electrified-secrets.config
````
- Then open the project and configure the **automatic deployment**, see above.  
- Adjust the `local.config.mk` and `pve-manager-electrified-secrets.config` files.  
- Look at the [Makefile](./Makefile) and see the targets, starting with `IDE_` _(=for running from the IDE machine)_.  
Normally, you run (on the first time):   
`make IDE_develop_nodejsserver`  
and later:  
`make IDE_faster_develop_nodejsserver`  
  these deploy everything on the target and run it.


#Publish to apt repo

- Specify the new package version by adding an entry into the [changelog](./debian/changelog).
- Also don't forget to keep the line `Provides: ..., pve-manager (=X.X.X)` in the [control file](./debian/control) up 2 date, reflecting the merged upstream commits from pve-manager. 

````shell
# Generate a key for signing. Answer with default options:
gpg --full-generate-key
# cd into this project dir
cd ~/pve-manager-electrified
gpg --export --armor [the id] > pubkey.asc
#adjust the config files

# build and publish:
make IDE_build_and_publish_package
````



# Old: Install source package on PVE server
**Better skip this chapter and [use a separate dev(IDE)- machine](#recommended-install-ide-on-a-dev-machine-which-is-a-different-machine-than-the-pve-server). This should deploy the following automatically.**


See the [official docs: Install build prerequisites for development environment](https://git.proxmox.com/?p=pve-common.git;a=blob_plain;f=README.dev;hb=HEAD),
or skip these and do this on a PVE server:
````shell
apt-get install -y build-essential git git-email debhelper pve-doc-generator devscripts sq
mkdir -p /root/proxmox
cd /root/proxmox
git clone TODO: link to this repo
cd pve-manager-electrified
mk-build-deps --install
````