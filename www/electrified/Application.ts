import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession} from "pveme-nodejsserver/ElectrifiedSession"
import {spawnAsync} from "./util/util"; // Import to have types
import {generated_pluginList as pluginList} from "../_generated_pluginList";
import {fixPluginClass, Plugin, PluginClass} from "./Plugin"

export class Application {
    remoteSession = new RestfuncsClient<ElectrifiedSession>("/electrifiedAPI", {/* options */}).proxy

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


    constructor() {
        console.log("Starting Proxmox VE Manager electrified");

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

        spawnAsync(async () => {
            console.log(`Web build state: ${JSON.stringify(await this.remoteSession.getWebBuildState())}`)
        });
    }
}
export const app = new Application();