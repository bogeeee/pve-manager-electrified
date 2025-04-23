import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession} from "pveme-nodejsserver"
import {spawnAsync} from "./util/util"; // Import to have types

class Application {
    remoteSession = new RestfuncsClient<ElectrifiedSession>("/electrifiedAPI", {/* options */}).proxy
    constructor() {
        console.log("Starting Proxmox VE Manager electrified");
        spawnAsync(async () => {
            console.log(`Web build state: ${JSON.stringify(await this.remoteSession.getWebBuildState())}`)
        });
    }
}
export const app = new Application();