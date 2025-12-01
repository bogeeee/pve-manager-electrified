import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {newDefaultMap, spawnAsync, throwError} from "../util/util";
import {File, normalizePath} from "./File";
import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession, ExecaOptions} from "pveme-nodejsserver/ElectrifiedSession"
import {Guest} from "./Guest";
import {ElectrifiedRestfuncsClient} from "../util/ElectrifiedRestfuncsClient";
import {getElectrifiedApp} from "../globals";
import _ from "underscore"
import {Lxc} from "./Lxc";
import {Qemu} from "./Qemu";
import {ModelBase} from "./ModelBase";

/**
 * A PVE-Node. All fields are live updated.
 */
export class Node extends ModelBase {
    name!: string;

    electrifiedClient!: RestfuncsClient<ElectrifiedSession>;

    /**
     * Files and directories
     * @protected
     */
    protected files = newDefaultMap<string, File>((path) => new File(this, path));
    protected guests!: Map<number, Guest>

    /**
     * The raw data record from the ResourceStore that was returned by the api https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources
     * <p>
     *     If you find some information there, that is not also available directly as a field here, report this as a bug. I.e a new classic-pve feature that is not yet covered in electrified.
     * </p>
     */
    rawDataRecord!: Record<string, unknown>

    // *** Fields from ResourceStore / https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources: ***
    /**
     * Number of available memory in bytes
     */
    maxmem!: number;
    /**
     * Used memory in bytes
     */
    mem!:  number;
    /**
     * Uptime in seconds
     */
    uptime!:  number;
    /**
     * Support level
     */
    level!:  string;
    /**
     * The cgroup mode this node operates under
     */
    "cgroup-mode"!:  number;
    /**
     * CPU utilization
     */
    cpu!:  number;
    /**
     * Number of available CPUs
     */
    maxcpu!:  number;
    /**
     * "online" or ...
     */
    status!:  string;
    /**
     * Value was provided by the ResourceStore but no further docs found
     */
    diskuse!:  number;
    /**
     *  Value was provided by the ResourceStore but no further docs found
     */
    memuse!:  number;
    /**
     *  Value was provided by the ResourceStore but no further docs found
     */
    running!:  boolean;

    protected async constructAsync(): Promise<void> {
        // See _initWhenLoggedIn for a better place
        await super.constructAsync();
        this.electrifiedClient = new ElectrifiedRestfuncsClient<ElectrifiedSession>(this.isCurrentNode?"/electrifiedAPI":`https://${this.hostNameForBrowser}:8006/electrifiedAPI`, {/* options */}) // TODO: Allow other origins in the ElectrifiedSession.options but use sameSite cookies, so they cannot share the session cross site (would open xsrf attacks otherwise)
    }

    async _initWhenLoggedOn() {
        this.guests = new Map();
        await this.handleResourceStoreDataChanged();
        getElectrifiedApp()._resourceStore.on("datachanged", () => spawnAsync(() => this.handleResourceStoreDataChanged()));
    }

    protected async handleResourceStoreDataChanged() {
        const guestsSeenInResourceStore = new Set<number>()
        for(const item of getElectrifiedApp()._resourceStore.getData().getRange()) { // Iterate all items from the resource store
            const dataRecord: any = item.data;
            const type = dataRecord.type as string;
            if(dataRecord.node !== this.name) { // Not for this node?
                continue
            }
            if(type === "lxc" || type == "qemu") { // is a guest?
                const id = dataRecord.vmid as number;
                guestsSeenInResourceStore.add(id);
                let guest = this.getGuest(id);

                if(!guest) { // Guest is new?
                    if(type === "lxc") {
                        guest = await Lxc.create({id});
                    }
                    else if(type === "qemu") {
                        guest = await Qemu.create({id});
                    }
                    else {
                        throw new Error("Unhandled type")
                    }
                    this.guests.set(id, guest);
                }

                guest._updateFields(dataRecord);
            }
        }

        // Delete nodes that don't exist anymore:
        [...this.guests.keys()].forEach(id => {
            if(!guestsSeenInResourceStore.has(id)) {
                this.guests.delete(id);
            }
        })
    }

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
        return this.files.get(normalizePath(path));
    }


    getGuest(id: number) : Guest | undefined{
        return this.guests.get(id);
    }

    getGuest_existing(id: number){
        return this.getGuest(id) || throwError(`Guest with id ${id} does not exist on node: ${this.name}`);
    }

    get isCurrentNode() {
        const app = getElectrifiedApp();
        if(!app.currentNode) {
            return true; // If we are at this early initialization phase, this must be the one and only current node
        }
        return this === app.currentNode;
    }

    get isOnline() {
        if(this.status === undefined) {
            throw new Error("Not yet fully initialized");
        }
        return this.status === "online"
    }

    /**
     * Execute a (shell-/system) command. You can use the tagged-template syntax, and expressions inside ${...} will be passed as an **individual** arg (stuff that sticks to your individual arg without whitespace, will be included in that arg / come as a single arg). ${...} expressions need no quoting with double-quotes.
     * <p>
     *     Example: <code>myNode.execShell`ls -l ${myFile}`</code>
     * </p>
     * <p>
     *     Example2: <code>myNode.execCommand`zfs list -H /rpool/pveDatasets/subvol-${myNodeId}-disk-${myDisk}`</code>
     * </p>
     * <p>
     *     Default working dir is: /tmp/pve/[session-id]
     *     If you want to specify a different working dir or other options, use <code>myNode.execCommandWithOptions({cwd: "..."})`myCommand`</code>
     * </p>
     * <p>
     *     If you really want bash-like features like && or * globbing, use <code>myNode.execCommandWithOptions({cwd: "...", shell="/bin/bash"})`myCommand`</code>
     *     Note that in this case, ${...} expressions just get appended to the big bash string and **are not escaped**. You have to put them in " quotes yourself and escape them, to prevent command injections.
     * </p>
     * @param command
     * @param values
     * @returns result buffer, encoded as utf8 (for a different encoding, see {@link execCommandWithOptions}
     */
    async execCommand(command: TemplateStringsArray, ...values: any[]): Promise<string> {
        return await this.execCommandWithOptions({shell: false})(command, ...values);
    }

    /**
     * Like {@link execCommand} but you can specify the options yourself. See {@link execShellCommand} for more info about the tagged template params.
     * <p>
     *   Usage: <code>myNode.execCommandWithOptions({cwd: "/home/myUser", shell: "/bin/bash"})`ls -l ${myFile}`</code>
     * <p>
     * @param options Fields will default to: encoding="utf8", cwd="/tmp/pve/[session-id]"
     * @see execCommand
     * @see execShellCommand
     */
    execCommandWithOptions(options: ExecaOptions) {
        return async (command: TemplateStringsArray, ...values: any[]) => {
            const cmd = taggedTemplatetoCommandArray(command, values);
            return await this.electrifiedApi.execa(cmd[0], cmd.slice(1), options);
        }
    }

    async execShellCommandInPopupTerminalWindow(command: TemplateStringsArray, ...values: any[]): Promise<void> {
        throw new Error("TODO")
    }



    /**
     * Host name under which this node is reachable from the browser
     */
    get hostNameForBrowser() {
        return this.name
    }

    /**
     * Internal
     * @param fields fields from resource store
     */
    _updateFields(fields: any) {
        const fieldsToCopy: (keyof this)[] = ["maxmem","mem", "uptime", "level", "cgroup-mode", "cpu", "maxcpu", "status", "diskuse","memuse", "running"];
        for(const key of fieldsToCopy) {
            //@ts-ignore
            this[key] = fields[key];
        }

        this.rawDataRecord = fields;

        this._fireUpdate();
    }
}


/**
 * Converts i.e. the expression `a b${'c c c'}d e ${'f'}` into an array ["a", "b c c cd", "e", "f"].
 * Tokens will be squeezed together to one arg, if there is no space between them **in the template**.
 * @param template
 * @param values
 */
function taggedTemplatetoCommandArray(template: TemplateStringsArray, values: any[]) {
    const result: string[] = [];
    let currentArg: string | undefined = undefined; // Empty strings can also be allowed as args if they come through values
    const flushToken = ()=> {
        if(currentArg !== undefined) {
            result.push(currentArg);
            currentArg = undefined;
        }
    }
    const appendToCurrentArg = (value: string) => {
        currentArg = (currentArg || "") + value;
    }

    for (let i = 0; i < template.length; i++) {
        const templatePart = template[i];

        if(templatePart.indexOf('"') >= 0 || templatePart.indexOf("'") >= 0 || templatePart.indexOf("`") >= 0) {
            throw new Error('You cannot not use quotes in the command expression. This is currently not supported. Instead, use the syntax: myNode.execXXXCommand`... ${myArgStringWithSpacesAndSpecialChars} ...`. ');
        }

        if(templatePart.startsWith(" ")) {
            flushToken();
        }

        const tokens = templatePart.split(/\s+/);
        for(let t=0;t<tokens.length;t++) {
            const token = tokens[t];
            if(token.trim() === "") {
                continue;
            }
            if(t>0) {
                flushToken();
            }
            appendToCurrentArg(token);
        }

        if(templatePart.endsWith(" ")) {
            flushToken();
        }


        if (i < values.length) {
            const value = values[i];
            if(value === undefined || value === null) {
                throw new Error("Illegal argument: ${" + value+ "}. Undefined or null is not allowed. You may supply an empty string inside the ${...} expression instead.")
            }
            if(_.isArray(value)) {
                throw new Error("${} expressions returning arrays are currently not supported")
            }
            const stringValue = "" + value; // Convert to string
            appendToCurrentArg(stringValue);
        }
    }

    flushToken();

    if(result.length === 0) {
        throw new Error("Command is empty");
    }
    return result;
}