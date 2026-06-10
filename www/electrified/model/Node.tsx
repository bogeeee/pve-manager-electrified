import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {
    tryWatched,
    newDefaultMap,
    newDefaultWeakMap,
    showBlueprintDialog,
    sleep,
    spawnAsync,
    spawnWithErrorHandling,
    throwError
} from "../util/util";
import {File, normalizePath} from "./File";
import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession, ExecaOptions} from "pveme-nodejsserver/ElectrifiedSession"
import {Guest} from "./Guest";
import {ElectrifiedRestfuncsClient} from "../util/ElectrifiedRestfuncsClient";
import {getElectrifiedApp, MeteredValue, t} from "../globals";
import _ from "underscore"
import {Lxc} from "./Lxc";
import {Qemu} from "./Qemu";
import {ModelBase} from "./ModelBase";
import {bind, preserve, useWatchedState, watched} from "react-deepwatch";
import {GuestsContainerBase} from "./GuestsContainerBase";
import {Notification, NotificationTarget} from "../Notification";
import type{Datacenter} from "./Datacenter";
import {DiskConfig, ElectrifiedJsonConfig} from "pveme-nodejsserver/Common";
import {retsync2promise} from "proxy-facades/retsync";
import React from "react";
import {Button, ButtonGroup, Classes, HTMLSelect, InputGroup, Intent,} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css"; // don't forget these
import "@blueprintjs/icons/lib/css/blueprint-icons.css"; // don't forget these
import "@blueprintjs/icons/lib/css/blueprint-icons.css"; // don't forget these

/**
 * A PVE-Node. All fields are live updated.
 */
export class Node extends GuestsContainerBase implements NotificationTarget {
    name!: string;

    _electrifiedClient?: RestfuncsClient<ElectrifiedSession>;

    /**
     * Files and directories
     * @protected
     */
    protected files = newDefaultMap<string, File>((path) => new File(this, path));

    /**
     * Undefined if the guest is not running
     */
    electrifiedStats?: {
        /**
         * In milliseconds in client time. When this stats were fetched from the server
         * @see currentCpuUsage.ageMs
         */
        clientTimestamp: number,
        currentCpuUsage?: MeteredValue
    }

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
     * @see currentCpuUsage
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

    /**
     * Increased on every udev event (`udevadm monitor -k -u`). Watch this field to react on changed hardware events
     */
    udevEventsCount = 0;

    protected async constructAsync(): Promise<void> {
        // See _initWhenLoggedIn for a better place
        await super.constructAsync();
    }

    async _initWhenLoggedOn(datacenter?: Datacenter) {
        await super._initWhenLoggedOn(datacenter);
        // Listen for udev events (changed hardware) and increase udevEventsCount
        if(this.supportsElectrifiedClient) {
            this.electrifiedClient?.withReconnect(() => spawnAsync( async() => {
                await this.electrifiedApi.onUdevEvent(() => {this.udevEventsCount++});
            }));
        }
    }

    get electrifiedClient() {
        if(this._electrifiedClient) {
            return this._electrifiedClient;
        }

        if(!this.supportsElectrifiedClient) {
            throw new Error("Using the electrified client is currently only possible for the current node (where you currently access the web interface). It's planned for the future, to route the api through.");
            // TODO when implementing: See Guest#configFile. Eventually assign it from the **guest's** node (not current node) and file operations will go through there
        }

        this._electrifiedClient = new ElectrifiedRestfuncsClient<ElectrifiedSession>("/electrifiedAPI", {/* options */});
        return this._electrifiedClient;
    }

    get supportsElectrifiedClient() {
        return this.isCurrentNode;
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
     * <p>
     *     Erroneous results are taken care of and a Error is thrown then.
     * </p>
     * @param method
     * @param url path after /api2/json/nodes/{node}. Must begin with a /
     * @param params booleans will be converted to "1" or "0". undefineds will be omitted.
     * @returns the json result from under rawResult.data = the data that you want to work with.
     * @see Application#api2fetch
     * @see Node#electrifiedClient
     * @see awaitTask
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
     * Waits til the pve task is finished or has failed (throws an error then)
     * @param id
     */
    async awaitTask(id: string) {
        while(true) {
            const statusResult: any = await this.api2fetch("GET", `/tasks/${id}/status`);
            if(statusResult.status !== "running") {
                if(statusResult.exitstatus === "OK" || (statusResult.exitstatus as string)?.match(/WARNINGS: [0-9]+/)) {
                    return;
                }
                throw new Error(`Task ${id} failed. Exit status: ${statusResult.exitstatus}`);
            }
            await sleep(100); // TODO: Friendly poll
        }
    }

    /**
     * @param id
     */
    async stopTask(id: string) {
        await this.api2fetch("DELETE", `/tasks/${id}`);
    }

    /**
     *
     * @param path
     * @return File or directory
     */
    getFile(path: string): File {
        return this.files.get(normalizePath(path));
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

    toString() {
        return `Node: ${this.name}`;
    }

    toJSON() {
        return `{"name": ${JSON.stringify(this.name)} }` // Prevent it from diving int electrifiedApi
    }

    get type(): "node" {
        return "node";
    }

    get ui_type() {
        return t`node`;
    }
    get ui_pluralType() {
        return t`nodes`;
    }

    ui_toString() {
        return t`node ${this.name}`;
    }

    faIcon = "building"; // Implemented in subclass

    /**
     * ElectrifiedResourceStats are additional stats with cpu usage and [running/not running]. Cause the cluster cluster/resources's stats are too lame (~30 second average or so).
     * @protected
     */
    async _refreshElectrifiedResourceStats(needsCpuUsage: boolean) {
        const clientTimestamp = new Date().getTime();
        const resourceStats = getElectrifiedApp().loginData?.cap.nodes["Sys.Audit"]?await this.electrifiedApi.getResourceStats(window.document.hasFocus(), needsCpuUsage):undefined;

        // Apply stats for this node:
        {
            const newStats = resourceStats ? {
                clientTimestamp,
                currentCpuUsage: resourceStats.totalCpuUsage,
            } : undefined;
            this.electrifiedStats = preserve(this.electrifiedStats, newStats);
        }

        // Apply stats to guests:
        if(resourceStats) {
            const guestStatsMap = new Map(resourceStats.guestCpuUsage.map(g => [g.guestId, g])); // convert to map
            for(const guest of this._guests.values()) {
                const stats = guestStatsMap.get(guest.id);
                const newStats = stats ? {
                    clientTimestamp,
                    ...stats,

                    // Create accessors, to trap, if someone actually needs the cpu usage. So we do the expensive fetch next time
                    _currentCpuUsage: stats.currentCpuUsage,
                    get currentCpuUsage() {
                        getElectrifiedApp().datacenter._cpuUsageWasNeeded = true;
                        this.clientTimestamp; // access a field that is always fluctuating, so the component gets rerendered next stats update and will call this method again, so we cab flag _cpuUsageWasNeeded again (not loose it)

                        return this._currentCpuUsage
                    },
                    set currentCpuUsage(value: any) {
                        this._currentCpuUsage = value;
                    }
                } : undefined;
                guest.electrifiedStats = preserve(guest.electrifiedStats, newStats);
            }
        }
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

        this.rawDataRecord = preserve(this.rawDataRecord, fields, {destroyObsolete: false});

        this._fireUpdate();
    }

    get id() {
        return this.name;
    }

    _parent?: Datacenter
    get parent(): Datacenter {
        return this._parent || throwError("Datacenter not yet initialized");
    }

    /**
     * Config from: /etc/pve/nodes/[nodename]/electrified.json
     */
    get config(): ElectrifiedJsonConfig {
        if(getElectrifiedApp().currentNode.name !== this.name) {
            throwError('Getting the config for a different node is not yet implemented');
        }
        return tryWatched(getElectrifiedApp().nodeConfig);
    }

    /**
     * @returns status for encrypted or encryptable disks
     */
    async getEncryptableDisksStatus() {
        const thisNode = this;

        /*
        To quickly test zfs encryption:
        zfs create -o encryption=on -o keyformat=passphrase -o keylocation=prompt rpool/testCrypt

        */

        class Row {
            type: "luks" | "zfs";

            /**
             * Disk device under /dev
             */
            disk: string;

            /**
             * For luks devices. Actual mapped disk under /dev/mapper
             */
            mappedDisk?: string;

            constructor(type: "luks" | "zfs", disk: string, mappedDisk: string | undefined) {
                this.type = type;
                this.disk = disk;
                this.mappedDisk = mappedDisk;
            }

            /**
             * Result of blkid (for luks)
             */
            blkidRecord?: {
                UUID: string,
                LABEL?: string,
                PARTUUID?: string,
                PARTLABEL?: string,
            }

            get id() {
                return this.blkidRecord?.UUID || this.disk;
            }

            /**
             * For luks devices
             */
            get configuredMappedDeviceName(): string | undefined {
                return this.config?.luksMappedName || undefined;
            }

            getDefaultMappedLuksDiskName() {
                if(this.configuredMappedDeviceName) {
                    return this.configuredMappedDeviceName;
                }
                if(this.config.identifier.type === "file") {
                    return `luks-${this.disk.substring(this.disk.lastIndexOf("/") + 1)}`;
                }
                return this.configuredMappedDeviceName?this.configuredMappedDeviceName:`luks-${this.config.identifier.value}`
            }


            get isDecrypted() {
                if(this.type === "luks") {
                    return !!this.mappedDisk
                }
                throw new Error("not yet implemented for type")
            }

            get ui_type() {
                if(this.type === "luks") {
                    return t`LUKS`
                }
                else if(this.type === "zfs") {
                    return t`ZFS`
                }
                return this.type
            }

            get ui_toolTipInfo() {
                return this.blkidRecord;
            }

            /**
             * The config entry for this disk under the node config
             */
            get config(): DiskConfig {
                const nodeConfig = thisNode.config;
                const uuid = this.blkidRecord?.UUID;
                const matchingCfgs = nodeConfig.disks.filter(cfg => {
                    cfg.identifier.value || throwError(`No disks.identifier.value specified (in node's electrified configuration)`)
                    if(cfg.identifier.type === "file") {
                        return this.disk === cfg.identifier.value;
                    }
                    else if(cfg.identifier.type === "uuid") {
                        return uuid === cfg.identifier.value;
                    }
                    else if(cfg.identifier.type === "label") {
                        return this.blkidRecord?.LABEL === cfg.identifier.value;
                    }
                    else {
                        throwError(`Invalid value for disks.identifier.type=${cfg.identifier.type}`)
                    }
                })

                matchingCfgs.length <= 1 || throwError(`There are multiple entries that match the same disk (in node's electrified configuration)`);
                if(matchingCfgs.length === 0) {
                    // Create config entry_
                    nodeConfig.disks.push({
                        identifier: uuid?{type: "uuid", value: this.id}:{type:"file", value: this.disk},
                        luksMappedName: "",
                        noDecrypt: false,
                    });
                    return this.config; // Should return it now
                }
                else {
                    return matchingCfgs[0];
                }

            }

            ui_showDiskSettings() {
                spawnWithErrorHandling(async () => {
                    await showBlueprintDialog({title: t`Disk settings for ${this.disk}`, niceElectrifiedStyle: false, style: {width: "700px"}},(props) => {
                        const cfg = watched(this.config,{onChange: () => {
                            if(cfg.identifier.type === "file") {
                                cfg.identifier.value = this.disk;
                            }
                            else if(cfg.identifier.type === "uuid") {
                                cfg.identifier.value = this.blkidRecord!.UUID;
                            }
                            else if(cfg.identifier.type === "label") {
                                cfg.identifier.value = this.blkidRecord!.LABEL!;
                            }
                            else {
                                throwError(`Invalid value for disks.identifier.type=${cfg.identifier.type}`)
                            }
                        }});
                        const state = useWatchedState({}); // contentComponentFn was wrapped for you in a watchedComponent, so you can use watchedComponent features (see react-deepwatch)

                        return <div>
                            <div className={Classes.DIALOG_BODY}>
                                {/* Identify by: */}
                                <div style={{display: "flex", gap: "8px", alignItems: "center"}}><div>{t`Intentify by / save configuration for:`}</div><HTMLSelect {...bind(cfg.identifier.type)}>
                                    <option value={"file"}>{t`File: ${this.disk}`}</option>
                                    {this.blkidRecord?.UUID && <option value={"uuid"}>{t`UUID: ${this.blkidRecord?.UUID}`}</option>}
                                    {this.blkidRecord?.LABEL && <option value={"label"}>{t`Label: ${this.blkidRecord?.LABEL}`}</option>}
                                </HTMLSelect></div>

                                {/* Mapping: */}
                                <div style={{display: "flex", alignItems: "center", marginTop: "8px"}}><div>{t`Map decrypted disk to:`}</div><div>&#160;/dev/mapper/</div><InputGroup {...bind(cfg.luksMappedName)} placeholder={this.getDefaultMappedLuksDiskName()} style={{width: "360px"}}/></div>
                            </div>

                            <div className={Classes.DIALOG_FOOTER}>
                                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                                    <ButtonGroup>
                                        <Button onClick={() => props.close()}>{t`Close`}</Button>
                                    </ButtonGroup>
                                </div>
                            </div>
                        </div>;
                    });
                })
            }



            /**
             * A bit hacky but for type simplicity, we add it here
             */
            _uiState?: "isDecrypting" | "success" | Error
        }




        var fetchLuksDecryptedDisks = async () => {
            const result: {disk: string, mappedDisk: string}[] = [];
            for (const mappedDisk of await retsync2promise(() => this.getFile("/dev/mapper").getDirectoryContents())) {
                let statusResult = ""
                try {
                    statusResult = await this.execCommand`cryptsetup status ${mappedDisk}`;
                }
                catch (e) {
                    if((e as any)?.cause?.exitCode === 4) { // device is not active?
                        continue
                    }
                    throw e;
                }
                if(statusResult.startsWith(`${mappedDisk} is active`)) {
                    const disk = statusResult.split("\n").slice(1).map(line => line.match(/\s*device:\s*(.+)$/)?.[1]).find(v => !!v);
                    if(disk) {
                        result.push({disk, mappedDisk: mappedDisk.path});
                    }
                }
            }
            return result;
        }

        const result = (await fetchLuksDecryptedDisks()).map(r => new Row("luks", r.disk, r.mappedDisk)); // Add already encrypted luks disks to result

        // Add not yet encrypted luks disks to result:
        (await this.execCommand`blkid`).split("\n").forEach(line => { // Iterate all disks with type info
            const [match, deviceFile, tokens] = (line.match(/^(.+): (.*)$/) || throwError(`invalid line: ${line}`));
            const record: Record<string,string> = {};
            [...tokens.matchAll(/([A-Z]+)="(.*?)"/g)].forEach(match => record[match[1]] = match[2]);
            //console.log(record);
            if(record.TYPE === "crypto_LUKS") {
                if(!result.some(r => r.disk === deviceFile)) {
                    const row = new Row("luks", deviceFile, undefined);
                    row.blkidRecord = record as any;
                    result.push(row);
                }
            }
        });

        return result;
    }

    /**
     * TODO: keep content when preserving
     */
    notifications = new Map<string, Notification>();
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