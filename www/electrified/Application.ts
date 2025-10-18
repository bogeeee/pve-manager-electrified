import {RestfuncsClient} from "restfuncs-client";

import {Clazz, returnWithErrorHandling, spawnAsync, withErrorHandling} from "./util/util"; // Import to have types
import {generated_pluginList as pluginList} from "../_generated_pluginList";
import {fixPluginClass, Plugin, PluginClass} from "./Plugin"
import {Guest} from "./model/Guest";
import {Qemu} from "./model/Qemu";
import {Lxc} from "./model/Lxc";
import {Node} from "./model/Node";
import {Datacenter} from "./model/Datacenter";
import {AsyncConstructableClass} from "./util/AsyncConstructableClass";

export class Application extends AsyncConstructableClass{


    /**
     * The live model of things in the datacenter live means, as soon, as the state on the server changes, i.e. a corresponding config file changes, it will be file-watched and pushed to here immediately.
     */
    datacenter!: Datacenter

    /**
     * Live model, (live like {@see datacenter})) of current node where this web frontend is currently hosted.
     */
    currentNode!: Node;


    /**
     * All classes are listed here, so they can be used in Plugins Because import {...} from "pvee-ui" does not work because of some vite/esbuild limitations.
     * <p>
     *     This way, you can at least create local classes inside a Plugin by:
     *     <pre><code>
     *     class MyQemuClass extends this.app.classes.model.Qemu {
     *         myOvverriddenMethod() {}
     *     }</code></pre>
     * </p>
     */
    classes= {
        /**
         * Category
         */
        model: {
            Guest, Qemu, Lxc
        },
        Plugin
    }

    /**
     * Classic proxmox's Ext.js workspace component
     */
    workspace!: any;

    private _plugins=  new Map<PluginClass, Plugin>();

    get plugins(){
        return [...this._plugins.values()];
    }

    getPluginByClass(clazz: PluginClass) {
        return this._plugins.get(clazz);
    }

    registerPlugin(pluginClass: PluginClass) {
        pluginClass = fixPluginClass(pluginClass);

        if(this.getPluginByClass(pluginClass)) { // Already registered
            return;
        }
        const plugin = new pluginClass(this);
        this._plugins.set(pluginClass, plugin);

    }


    async constructAsync() {
        console.log("Starting Proxmox VE Manager electrified");

        this.datacenter = await Datacenter.create();
        this.currentNode = await Node.create(); // TODO use datacenter.nodes[...]

        const electrifiedApi = this.currentNode.electrifiedApi;
        const webBuildState = await electrifiedApi.getWebBuildState();

        // Bug workaround: vite-devserver connection was rejected, because it had no/outdated permissions, cause they were not initialized yet.
        if(!webBuildState.builtWeb.buildOptions.buildStaticFiles && !(await electrifiedApi.permissionsAreUp2Date())) { // Using vite-devserver but permissions are not up2date?
            try {
                await electrifiedApi.ping(); // Force permissions to be up2date if there's a valid login
            }
            catch (e) {
            }

            if (await electrifiedApi.permissionsAreUp2Date()) { // but **now** they have become valid?
                // We realized that the vite-devserver connection must had failed because it saw none/outdated permissions. This occurs i.e. during nodejsserver development when restarting the server.

                window.location.reload();
            }
        }

        // Register plugins:
        pluginList.forEach(entry => {
            try {
                this.registerPlugin(entry.pluginClass);
            }
            catch (e) {
                throw new Error(`Error registering plugin ${entry.diagnosis_packageName}. Path: ${entry.diagnosis_sourceDir || ""}`, {cause: e});
            }
        })

        this.plugins.forEach(p => p.onUiReady()); // TODO: Remove this line here and call it from the right place



        console.log(`Develop: Web build state: ${JSON.stringify(webBuildState)}`);
        (window as any).electrifiedApp = this; // Make available for classic code
        app = this;
    }


    /**
     * Called by classic code to add / rearrange menu items and spacers
     * @param extJsMenuItems
     */
    _addElectrifiedMenuItems<I>(contextObj: object, extJsMenuItems: any[]) {
        return {...extJsMenuItems, ...this.plugins.map(p => p._getMenuItems(contextObj)).flat()};
    }

    _addGuestElectrifiedMenuItems(info: any,extJsMenuItems: any[] ) {
        return returnWithErrorHandling(() => {
            const contextObj = this.datacenter.getNode_existing(info.node).getGuest_existing(info.vmid);
            return this._addElectrifiedMenuItems(contextObj, extJsMenuItems);
        })
    }
}
let app: Application

withErrorHandling(async () => {
    const promise = Application.create();
    (window as any).electrifiedAppPromise =  promise;
    await promise; // Await it to provide error handling
})


