# Install source package on PVE server
**may be you can just skip this whole chapter. The IDE_... make targets should deploy this automatically to the target pve server.**


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


# Recommended: Install IDE on a dev machine (which is a different machine than the PVE server)
As an IDE,
- ~~Either use vscode with the "Remote SSH" plugin and connect the /root/proxmox/pve-manager-electrified project folder on the PVE server. This way, you can debug the nodejsserver seamlessly.~~
- ~~Or use Jetbrains Webstorm. It also has a remote SSH feature. Similar to the above.~~
- Better: Use a Jetbrains IDE and configure an automatic deployment. Make sure, the `.git` folder is not excluded from syncing, cause the make scripts expect, that there's such a folder, to automatically extract version information. Also enable "delete target items".
With this setup, you have the .git / source code locally and can have a "burner" target PVE server, where you can leave a mess or hop between snapshots.



On the IDE machine:
````shell
git clone TODO
cd pve-manager-electrified
cp local.config.mk.sample local.config.mk
cp pve-manager-electrified-secrets.config.sample ~/pve-manager-electrified-secrets.config
````
Adjust the `local.config.mk` and `pve-manager-electrified-secrets.config` files.  
Look at the [Makefile](./Makefile) and see the targets, starting with `IDE_`.

Normally, you run (on the first time):   
`make IDE_debug_nodejsserver`  
and afterwards:  
`make IDE_faster_debug_nodejsserver`  

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

