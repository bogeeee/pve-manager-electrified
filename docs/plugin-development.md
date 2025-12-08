# Modding classic pve code
In case you don't find a plugin hook for the feature, you want to code on, create an [issue](https://github.com/bogeeee/pve-manager-electrified/issues) or otherwise, if you're impatient, dig your self into the clasic code:

### Directly editing the classic sources
During development, it might be handy to directly edit the sources, to find the spot that you want to patch or hook into.
On the host, do:
````bash
mkdir /root/proxmox
cd /root/proxmox
git clone https://github.com/bogeeee/pve-manager-electrified
systemctl restart pvenodejsserver
````
Note: Make sure, the versions of the running server and the client code match, so eventually `git checkout` a few commits back to the last release commit.  
Now, under `/root/proxmox/pve-manager-electrified/www` you have all sources and editing them **hot-reloads** the page👍.

### Modding/Patching
After you've found the desired spot and want to deliver a patch via your plugin, override the `Plugin#earlyInit` method. Example:
````js
export default class Plugin extends PvemePlugin {
    /**
     * Called, when classic components have been defined but are not started yet.
     * Use this hook, to modify them.
     * <p>
     *     this.app has not been fully initialized at that time.
     * </p>
     * @see init
     */
    async earlyInit() {
        const mePlugin = this;
        
        // Patch the PVE.Workspace#initComponent method: 
        const orig_initComponent = PVE.Workspace.prototype.initComponent;
        Ext.define('MyPlugin.PVE.Workspace', {
            override: 'PVE.Workspace', // **Patches** PVE.Workspace's definition
            initComponent(...args) {
              console.log("Hello from patched initComponent");
              
              mePlugin.app... // Access this plugin or the electrifiedApp from here.
              
              return orig_initComponent.apply(this, args); // Calls the original.
            }
        });
    }
}
````

Note: The Ext JS's `callParent` does not work from module code. Instead, use: `this.prototype.apply(this, [...args])`. This calls it at the level of the parent of the overridden. 
You can't call the overridden level its self, because that method was destroyed by patching with "override". Therefore, save a reference to it beforehand, like in the above example.

[Ext JS 6 documentation](https://docs.sencha.com/extjs/6.7.0/modern/Ext.html)