import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {newDefaultMap, throwError} from "../util/util";
import {File} from "./File";
import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession} from "pveme-nodejsserver/ElectrifiedSession"
import {Guest} from "./Guest";
import {ElectrifiedRestfuncsClient} from "../util/ElectrifiedRestfuncsClient";
import {getElectrifiedApp} from "../globals";

export class Node extends AsyncConstructableClass {
    name: string;

    electrifiedClient: RestfuncsClient<ElectrifiedSession> = new ElectrifiedRestfuncsClient<ElectrifiedSession>("/electrifiedAPI", {/* options */}) // TODO: path for this node. Allow other origins in the ElectrifiedSession.options but use sameSite cookies, so they cannot share the session cross site (would open xsrf attacks otherwise)

    /**
     * Files and directories
     * @protected
     */
    protected files = newDefaultMap<string, File>((path) => new File(this, path));
    protected guests!: Map<number, Guest>

    /**
     * Let's you call electrified-specific remote methods on the server. They are defined in nodejsserver/ElectrifiedSession.ts
     * For a plugin dev, you normally won't use the electrifiedApi directly, as the methods are mostly wrapped in the object model (like i.e. this Node class).
     * <p>
     *     Example: <code>electrifiedApp.currentNode.electrifiedApi.getDirectoryContents("/etc/pve"); // Just an example, rather use currentNode.getFile(/etc/pve").getDirectoryContents() for it</code>
     * <p>
     * Alias for this.electrifiedClient.proxy
     * </p>
     * @see Application#api2fetch
     */
    get electrifiedApi() {
        return this.electrifiedClient.proxy;
    }

    /**
     * Calls the pve2 api **for operations under this node**. The api can be browsed here: {@link https://pve.proxmox.com/pve-docs/api-viewer/#/nodes/{node}.
     * <p>
     *      Example: <code>const result = await electrifiedApp.currentNode.api2fetch("POST", "/lxc/820/status/stop", {skiplock: true}); // stops the guest 820 while ignoring locks</code>
     * </p>
     * @param method
     * @param url path after /api2/json/nodes/{node}. Must begin with a /
     * @param params booleans will be converted to "1" or "0". undefineds will be omitted.
     * @returns the json result
     * @see Application#api2fetch
     * @see Node#electrifiedClient
     *
     */
    async api2fetch(method: "GET" | "POST" | "PUT" | "DELETE", url: string, params?: Record<string, unknown>): Promise<unknown> {
        // Validity check:
        if(!url.startsWith("/")) {
            throw new Error("Url must start with /");
        }
        return await getElectrifiedApp().api2fetch(method, `/nodes/${this.name}${url}`, params);
    }

    /**
     *
     * @param path
     * @return File or directory
     */
    getFile(path: string): File {
        return this.files.get(path);
    }


    getGuest(id: number) : Guest | undefined{
        return this.guests.get(id);
    }

    getGuest_existing(id: number){
        return this.getGuest(id) || throwError(`Guest with id ${id} does not exist on node: ${this.name}`);
    }
}