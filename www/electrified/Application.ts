import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession} from "pveme-nodejsserver/ElectrifiedSession"
import {spawnAsync} from "./util/util"; // Import to have types
import {pluginClasses} from "../_generated_listPlugins";
import {Plugin} from "./Plugin"

class Application {
    remoteSession = new RestfuncsClient<ElectrifiedSession>("/electrifiedAPI", {/* options */}).proxy
    plugins: Plugin[];
    constructor() {
        console.log("Starting Proxmox VE Manager electrified");

        // Create plugin instances
        this.plugins = pluginClasses.map(pluginClazz => new pluginClazz())

        spawnAsync(async () => {
            console.log(`Web build state: ${JSON.stringify(await this.remoteSession.getWebBuildState())}`)
            this.plugins.forEach(p => p.onUiReady())
        });
    }
}
export const app = new Application();