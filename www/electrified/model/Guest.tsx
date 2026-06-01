import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {getElectrifiedApp, MeteredValue, t} from "../globals";
import {ModelBase} from "./ModelBase";
import {bind, binding, preserve, useWatchedState, watched} from "react-deepwatch";
import type {Node} from "./Node"
import {
    capitalize,
    getUniqueName, guestConfigEntry2Record,
    isDeepEqual, record2guestConfigEntry, RememberChoiceButton,
    RetryableError,
    retryTilSuccess,
    RetryTilSuccessOptions, showBlueprintDialog, sleep,
    spawnAsync,
    throwError, toError
} from "../util/util";
import {Disk} from "./hardware/Disk";
import {File} from "./File";
import {newDefaultMap} from "../util/util";
import {retsync2promise} from "proxy-facades/retsync";
import {Hardware} from "./hardware/Hardware";
import {NetworkInterface} from "./hardware/NetworkInterface";
import {stringify as brilloutJsonStringify} from "@brillout/json-serializer/stringify"
import {bool, instanceOf} from "prop-types";
import {NotificationTarget, Notification} from "../Notification";
import {CloneDialogResult} from "../ui/CloneDialog";
import {Qemu} from "./Qemu";
import * as React from "react";
import {Button, ButtonGroup, Checkbox, Classes, InputGroup, Intent} from "@blueprintjs/core";
import {DeviceFilePassthrough} from "./hardware/DeviceFilePassthrough";
import {Usb} from "./hardware/Usb";
import {HostPci} from "./hardware/HostPci";

export abstract class Guest extends ModelBase implements NotificationTarget {
    //@ts-ignore
    classType!: typeof Guest

    _id?: number;

    name!: string;

    comment?: string;

    /**
     * Back reference. Undefined when this is a snapshot
     */
    _node?: Node;

    /**
     * The raw data record from the ResourceStore that was returned by the api https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources
     * <p>
     *     If you find some information there, that is not also available directly as a field here, report this as a bug. I.e a new classic-pve feature that is not yet covered in electrified.
     * </p>
     */
    rawDataRecord!: Record<string, unknown>

    /**
     * Used as a simple way to write a changed config back to disk (redundant with fields here)
     * @see _configRecord
     */
    _rawConfigRecord!: Map<string, string | string[]>;

    snapshotRoot!: SnapshotRoot;
    /**
     * Undefined when live guest
     */
    snapshotName?: string;
    _parentSnapshotName?: string
    childSnapshots: Guest[] = [];

    /**
     * True if there were hardware changes throught the classic pve gui while this guest is running, so they will be affective next time the guest is started.
     * These changes are not reflected in this object!
     */
    hasPendingChanges!: boolean;

    // *** Hardware ***

    net: NetworkInterface[] = [];

    /**
     * Unused disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "unused0: ... , unused2: ..."
     * </p>
     */
    unused: Disk[] = [];

    // *** Fields from ResourceStore / https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources: ***
    /**
     * CPU utilization
     * @see currentCpuUsage
     */
    cpu!: number
    /**
     * used root image space in bytes
     */
    disk!: number
    /**
     * The number of bytes the guest read from its block devices since the guest was started. This info is not available for all storage types.
     */
    diskread!: number
    /**
     * The number of bytes the guest wrote to its block devices since the guest was started. This info is not available for all storage types
     */
    diskwrite!: number
    /**
     * HA service status (for HA managed VMs).
     */
    hastate!: string
    /**
     * The guest's current config lock
     */
    lock: string = "";
    /**
     * Number of available CPUs
     */
    maxcpu!: number
    /**
     * root image size for VMs
     * @see #disk
     */
    maxdisk!: number
    /**
     * Number of available memory in bytes
     */
    maxmem!:number
    /**
     * Used memory in bytes
     */
    mem!: number
    /**
     * The amount of traffic in bytes that was sent to the guest over the network since it was started.
     */
    netin!:number
    /**
     * The amount of traffic in bytes that was sent from the guest over the network since it was started
     */
    netout!:number

    /**
     * Tags
     */
    tags!: string[]
    /**
     * this guest is a template?
     */
    template!:boolean
    /**
     * Uptime in seconds
     */
    uptime!:number

    /**
     * Some meta-information about this guest. Raw config string in the form key1=value1, key2=value2
     */
    meta!: Map<string, string>;

    /**
     * Undefined if the guest is not running
     */
    electrifiedStats?: {
        pid: number,
        /**
         * In milliseconds in client time. When this stats were fetched from the server
         * @see currentCpuUsage.ageMs
         */
        clientTimestamp: number,
        currentCpuUsage?: MeteredValue
    }

    lastStatusAction?: {
        timestamp: number,
        action: "pause" | "start" | "resume"
    }

    get ui_type() {
        return t`guest`;
    }
    get ui_pluralType() {
        return t`guests`;
    }
    ui_toString() {
        return t`guest ${this.id}`;
    }

    faIcon = ""; // Implemented in subclass

    /**
     * TODO: keep content when preserving
     */
    notifications = new Map<string, Notification>();

    /**
     * [Fieldname / same as key in config file] -> class info
     */
    static hardwareKeys2Classes: {[key: string]: {clazz: typeof Hardware}} = {
        net: {clazz: NetworkInterface},

        // LXC:
        rootfs: {clazz: Disk}, // LXC root fs
        mp: {clazz: Disk}, // LXC mountpoint
        dev: {clazz: DeviceFilePassthrough},

        // Qemu:
        ide: {clazz: Disk},
        sata: {clazz: Disk},
        scsi: {clazz: Disk},
        virtio: {clazz: Disk},
        efidisk: {clazz: Disk},
        tpmstate: {clazz: Disk},
        unused: {clazz: Disk},
        vmstate: {clazz: Disk},
        usb: {clazz: Usb},
        hostpci: {clazz: HostPci},
    }

    static NAME_CONFIGURATION_KEY: string = "name";

    protected async constructAsync(): Promise<void> {
        await super.constructAsync();

        (this._id && this._node) || throwError("Id/node not set"); // Validity check

        await this._reReadFromConfig();

        // Handle file changes:
        this.configFile.onChange(() => spawnAsync( async () => {
            this.checkValid();

            if(!await retsync2promise(() => this.configFile.exists)) { // it was a delete event  ?
                return;
            }

            await this._reReadFromConfig()
        }));
    }

    /**
     * @returns Guest tree (guest + snapshots). Id and node are not yet set
     */
    static async _fromConfig(configFile: File, guestClazz: typeof Guest): Promise<Guest> {
        const cfgContent = await retsync2promise(() => configFile.content);

        const sections2record = Guest._configString_to_sections2Record(cfgContent, configFile.path);

        // Safety check if parser functions are consistent:
        if(!isDeepEqual(sections2record, Guest._configString_to_sections2Record(Guest._sections2Record_to_configString(sections2record), configFile.path))) {
            throw new Error("Config parsing/serializing functions do not deliver consistent result for " + configFile.path + ". Reserialized output:\n" + Guest._sections2Record_to_configString(sections2record));
        }

        const hasPending = sections2record.has("PENDING"); // Pending changes are saved in a [PENDING] section. We will ignore them and just flag that fact
        sections2record.delete("PENDING");

        // Create guest instances and add them to snapshotRoot:
        const snapshotRoot = new SnapshotRoot();
        for(const sectionName of sections2record.keys()) {
            const section = sections2record.get(sectionName)!;
            //@ts-ignore
            const guest: Guest = new guestClazz(); // use the non-async constructor
            guest.snapshotName = sectionName;
            guest._parentSnapshotName = section.get("parent") as string | undefined; // set here as well to not fail the safety check
            guest.name = section.get("name") as string;

            await guest._applyConfigValues(section);

            // Safety check, if methods are consistent:
            const diag_sectionToString = (section:any) => Guest._sections2Record_to_configString(new Map([[sectionName,section]]) as any);
            if(diag_sectionToString(section) !== diag_sectionToString(guest._configRecord)) {
                throw new Error(`_applyConfigValues() and get _configRecord() methods are not consistent for ${configFile.path}#[${sectionName}]. Section:\n${diag_sectionToString(section)}\n****Reserialized output of get _configRecord():****\n${diag_sectionToString(guest._configRecord)}`);
            }

            snapshotRoot.snapshots.set(sectionName, guest); //Register
            guest.snapshotRoot = snapshotRoot;
        }

        // Set guest.parentSnapshot for all entries:
        for(const sectionName of sections2record.keys()) {
            const guest = snapshotRoot.snapshots.get(sectionName)! || throwError("Illegal state. Expected guest/sectionsnapshot to exist");

            const section = sections2record.get(sectionName)!;
            const parentName = section.get("parent") as string | undefined;
            if(parentName) {
                guest._parentSnapshotName = parentName;
                guest.parentSnapshot?.childSnapshots.push(guest);
            }
        }

        const liveGuest = snapshotRoot.snapshots.get(undefined)!;
        liveGuest.hasPendingChanges = hasPending;
        return liveGuest;
    }

    /**
     * ... must use it on fresh objects only.
     * Reverse method of {@see _configRecord}
     * @param configEntries entries from the config file (only one section/snapshot)
     * @see constructAsync
     */
    async _applyConfigValues(configEntries: Map<string, string | string[]>) {

        this._rawConfigRecord = structuredClone(configEntries);
        const popConfigValue = (key: string) => {
            const result = this._rawConfigRecord.get(key);
            this._rawConfigRecord.set(key, "DELETED_REDUNDANT_VALUE");
            return result;
        }

        for(const key of configEntries.keys()) {
            if(key === "parent") {
                continue; // Ignore, field has duplicate meaning
            }

            let configValue: string | string[] | number = configEntries.get(key)!;

            // Convert numeric value to number:
            if(typeof configValue === "string") {
                if(!Number.isNaN(Number(configValue))) {
                    configValue = Number(configValue);
                }
            }

            const createHardwareObject = async(key: string, rawConfigString: string, index?: number) => {
                const clazz = Guest.hardwareKeys2Classes[key]?.clazz || Hardware;
                const fields = {
                    parent: this,
                    type: key,
                    rawConfigString,
                    ...(index !== undefined)?{index}:{},
                    ...clazz.isDisk?{type: key}:{}
                };
                const result = await clazz.create(fields);

                // Validity check:
                result.rawConfigString === rawConfigString || throwError(`Guest ${this}'s hardware's config was not properly parsed. Key: ${key}${index!==undefined?index:""}.\nOriginal config string:\n${rawConfigString}\nAfter parsing and serializing:\n${result.rawConfigString}`);

                return result;
            }

            // Set value:
            let value: unknown = undefined;
            if(Array.isArray(configValue)) { // Multiple?
                // Make sure, hardware class is registered, to help the _configRecord getter:
                if(!Guest.hardwareKeys2Classes.hasOwnProperty(key)) {
                    //console.log(`Registering hardware class: ${key}`);
                    Guest.hardwareKeys2Classes[key] = {clazz: Hardware}
                }

                // Treat as hardwareArray:
                const hardwareArray: Hardware[] = [];
                for(const i in configValue) {
                    hardwareArray[i] = await createHardwareObject(key, configValue[i], Number(i));
                }
                value = hardwareArray;
                this._rawConfigRecord.set(key, "DELETED_REDUNDANT_VALUE");
            }
            else {
                if(!Object.hasOwnProperty(key)) { // Not initialized by other code?
                    if(Guest.hardwareKeys2Classes[key]) {
                        value = await createHardwareObject(key, configValue as string);
                        this._rawConfigRecord.set(key, "DELETED_REDUNDANT_VALUE");
                    }
                    else {
                        value = configValue;
                    }
                }
            }
            //@ts-ignore
            this[key] = value;
        }

        this.name = popConfigValue( this.clazz.NAME_CONFIGURATION_KEY) as string;
        this.meta = guestConfigEntry2Record(popConfigValue("meta") as string || "");
    }

    /**
     * @see _writeConfig
     */
    async _reReadFromConfig() {
        if(this.isSnapshot()) {
            throw new Error("Can only call it on the live guest");
        }

        // Note: similar code in the fast-clone method

        const guestFromConfig = await Guest._fromConfig(this.configFile, this.constructor as any);
        guestFromConfig._node = this.node;
        guestFromConfig._id = this.id;
        const preserved = preserve(this, guestFromConfig)
        preserved === this || throwError("Illegal state");

        this.checkValid();
    }

    /**
     * Writes this._rawConfigRecord back to the config file
     */
    _writeConfig() {
        if(this.hasPendingChanges) {
            throw new Error(`Cannot make changes to the guest ${this} because it has pending hardware changes. Please stop the guest manually and try again.`);
        }
        const configObj = new Map( [...this.snapshotRoot.snapshots.entries()].map(([section, guest]) => [section, guest._configRecord]) );
        const configContent = Guest._sections2Record_to_configString(configObj as any);
        this.configFile.setStringContent(configContent, "utf-8", true);
    }

    /**
     * Call after {@link #_writeConfig} to make sure, proxmox's api also sees the current config
     */
    async _syncConfig() {
        throw new Error("Not implemented");
        /*
        // This approach has no effect:
        await this.configFile._calmDownAfterChangeEvent();
        const cfgSyncNumber = String(Math.random() * Number.MAX_SAFE_INTEGER);
        this.meta.set("cfgSyncNumber", cfgSyncNumber);
        await retsync2promise(() => this._writeConfig(), {checkSaved: false});
        await this.configFile._calmDownAfterChangeEvent(); // Wait til the file is really written
        await retryTilSuccess( async() => {
            const pveApiConfig = await this.node.api2fetch("GET", `/${this.type}/${this.id}/config`) as any;
            if(cfgSyncNumber !== guestConfigEntry2Record(pveApiConfig.meta || "").get("cfgSyncNumber")) { // api does not yet return
                console.log("not synced")
                throw new RetryableError(`Error waiting for synced config. Did not receive the expected cfgSyncNumber from meta=... in the ${this}'s config file`);
            }
        },{maxTime: 60000});
        */
    }

    /**
     * Reverse method of {@link _applyConfigValues}
     * @returns Config record to be written to disk.
     * @see _rawConfigRecord
     */
    get _configRecord() {
        const result = new Map(this._rawConfigRecord.entries());

        result.set(this.clazz.NAME_CONFIGURATION_KEY, this.name);
        if(this.comment) {
            result.set("comment", this.comment);
        }

        // Set parent:
        if(this._parentSnapshotName) {
            result.set("parent", this._parentSnapshotName);
        }
        else {
            result.delete("parent");
        }

        // Set hardware
        for(const key of Object.keys(Guest.hardwareKeys2Classes)) {
            //@ts-ignore
            const value = this[key];
            if(value === undefined) {
                continue;
            }
            if(Array.isArray(value)) {
                result.set(key, value.map(d => d.rawConfigString))
            }
            else {
                result.set(key, value.rawConfigString);
            }
        }

        // Set meta:
        if(this.meta.size > 0) {
            result.set("meta", record2guestConfigEntry(this.meta!))
        }
        else {
            result.delete("meta");
        }


        return result;
    }

    /**
     * Parses the config file contents
     * @param cfgContent Content of the config file like in /etc/pve/qemu-server/xxx.conf
     * @returns config sections with keys->values. The main/non-snapshot section is under: undefined
     */
    static _configString_to_sections2Record(cfgContent: string, diagnosis_configFilePath: string) {
        const result = newDefaultMap((s: string | undefined) => new Map<string, string | string[]>() );

        let section = result.get(undefined);
        for(let line of cfgContent.split("\n")) {
            line = line.trim();
            const sectionMatch = line.match(/^\[(.*)]$/);
            if(sectionMatch) {
                !result.has(sectionMatch[1]) || throwError(`duplicate ${line} in config file ${diagnosis_configFilePath}`)
                section = result.get(sectionMatch[1]);
                continue;
            }
            if(line.match(/^\s*$/)) { // Empty line ?
                continue;
            }
            const commentMatch = line.match(/^\s*#(.*)$/);
            if(commentMatch) { // Comment ?
                section.set("comment", (section.get("comment")?`${section.get("comment") as string}\n`:"") + commentMatch[1]);
                continue;
            }

            const entryMatch = line.match(/^([\w\-]+?)([0-9]*)\s*:(.*)$/);
            if(!entryMatch) {
                throw new Error(`Invalid line in config file ${diagnosis_configFilePath}:\n${line}`);
            }
            let [l, key, numericIndex, value] = entryMatch;
            value = value.trim();

            let existingValue = section.get(key);
            if(existingValue && (numericIndex != "") != Array.isArray(existingValue) ) throw new Error("Invalid line / mixing numeric with non-numeric keys: " + line); // Validity check

            if(numericIndex) {
                existingValue ||= [];
                section.set(key, existingValue);
                (existingValue as string[])[Number(numericIndex)] = value;
            }
            else { // Single value
                !existingValue || throwError(`Duplicate key: ${key} in config file ${diagnosis_configFilePath}`);
                section.set(key, value);
            }
        }
        return result;
    }

    /**
     * Reverse of {@see _configString_to_sections2Record}. For writing the config back to the file
     * @param sections2Record
     * @returns
     */
    static _sections2Record_to_configString(sections2Record: ReturnType<typeof Guest._configString_to_sections2Record>) {
        return [...sections2Record.entries()].map(([sectionName, record]) => {
            let result = "";
            result+= `${sectionName?`[${sectionName}]\n`:""}`;  // [section]
            [...record.entries()].forEach(([key, value]) => {
                value !== undefined && value !== null || throwError("Value must not be null or undefined"); // Safety check
                if(key === "comment") {
                    result+=(value as string).split("\n").map(line => `#${line}`).join("\n") + "\n";
                    return;
                }
                if(typeof value === "string") {
                    result+=`${key}: ${value}\n`
                }
                else if(Array.isArray(value)) {
                    value.forEach((subValue, index) => {
                        result+=`${key}${index}: ${subValue}\n`
                    })
                }
                else {
                    throw new Error("Unhandled value type");
                }
            });
            return result;
        }).join("\n");
    }

    isSnapshot() {
        return this._node === undefined;
    }

    get parentSnapshot() {
        return this.snapshotRoot.snapshots.get(this._parentSnapshotName);
    }

    /**
     * @returns the life guest that is not a snapshot.
     */
    get liveGuest(): Guest {
       if(!this.isSnapshot()) {
           return this;
       }
       return this.snapshotRoot.snapshots.get(undefined) || throwError("Illegal state: no life guest found. Note that this error can occur after taking a snapshot, after which the config config file is **temporarily** in an illegal state (proxmox does not write the changes atomically).");
    }

    get id() {
        return this.liveGuest._id!;
    }

    get key() {
        return `${this._id}@${this.snapshotName}`
    }

    get node() {
        return this.liveGuest._node!;
    }

    get parent(): Node {
        return this.node;
    }

    get configFile(): File {
        return getElectrifiedApp().currentNode.getFile(`/etc/pve/nodes/${this.node.name}/${this.type === "lxc"?"lxc":(this.type === "qemu"?"qemu-server":throwError("unsupported type"))}/${this.id}.conf`);
    }

    get pool() {
        return getElectrifiedApp().datacenter.pools.find(pool => pool.getGuest(this.id));
    }

    /**
     * Disks of all types.
     * @see the fields "ide", "sata", "scsi", "virtio", "efidisk", "tpmstate", "rootfs", "mp", "unused", to get them for a certain type
     */
    get disks(): Disk[] {
        const result: Disk[] = [];
        for(const type of Disk.diskTypes) {
            //@ts-ignore
            const diskOrDisks: Disk | Disk[] = this[type];
            if(!diskOrDisks) {
                continue;
            }
            if(Array.isArray(diskOrDisks)) {
                diskOrDisks.forEach(disk => {
                    if(disk) {
                        result.push(disk);
                    }
                })

            }
            else {
                result.push(diskOrDisks);
            }
        }
        return result;
    }

    /**
     * Hardware of all kinds
     */
    get hardware(): Hardware[] {
        const result: Hardware[] = [];
        for(const key of Object.keys(this)) {
            //@ts-ignore
            const val = this[key];
            if(Array.isArray(val)) {
                val.forEach(val => {
                    if(val !== null && val instanceof Hardware) {
                        result.push(val);
                    }
                })
            }
            else if(val !== null && val instanceof Hardware) {
                result.push(val);
            }
        }
        return result;
    }

    abstract get type(): "lxc" | "qemu"

    /**
     * @param fields fields from resource store (classic pve)
     */
    _updateFieldsFromResourceStore(fields: any) {
        const fieldsToCopy: (keyof this)[] = ["cpu","disk","diskread", "diskwrite", "hastate", "maxcpu", "maxdisk", "maxmem", "mem", "netin", "netout", "uptime"];
        for(const key of fieldsToCopy) {
            //@ts-ignore
            this[key] = fields[key];
        }

        const booleanFieldsToCopy: (keyof this)[] = ["template"];
        for(const key of booleanFieldsToCopy) {
            //@ts-ignore
            this[key] = (fields[key] === "1"?true:false);
        }


        const strTags = fields["tags"] as string;
        this.tags = (strTags && strTags.trim() != "")?strTags.split(";"):[];

        this.rawDataRecord = preserve(this.rawDataRecord, fields, {destroyObsolete: false});

        this._fireUpdate();
    }

    checkValid() {
        for(const k of Object.keys(this)) {
            //@ts-ignore
            const val = this[k];
            if(val !== null && val instanceof Hardware) {
                if(val.parent !== this) {
                    throw new Error("Illegal parent instance");
                }
            }
        }

        for (const snapshot of this.snapshotRoot.snapshots.values()) {
            if (snapshot.snapshotRoot !== this.snapshotRoot) {
                throw new Error("Illegal snapshotRoot instance");
            }
        }
    }

    isLocked() {
        return this.lock !== undefined && this.lock !== "";
    }

    /**
     *
     * @param plainValue the value from the resource
     */
    _getImprovedStatus(plainValue: string | undefined) {
        const now = new Date().getTime();
        // Note: You see different magic numbers here, but the status update take indeed different amounts of max-time to arrive

        if((plainValue === "stopped" || plainValue === "unknown") && this.electrifiedStats?.pid && (this.electrifiedStats.clientTimestamp + 5000) > now) {
            return "running";
        }
        if(plainValue === "running" && !this.electrifiedStats && this.parent?.electrifiedStats && (this.parent.electrifiedStats.clientTimestamp + 5000) > now) {
            return "stopped";
        }

        if(this.lastStatusAction && this.lastStatusAction.timestamp + 10000 > now) {
            if (plainValue === "running" && this.lastStatusAction.action === "pause" ) {
                return "paused";
            }

            if (plainValue === "paused" && this.lastStatusAction.action === "resume") {
                return "running";
            }

            if (plainValue === "prelaunch" && this.lastStatusAction.action === "resume") {
                return "running";
            }
        }

        const tasks = this.parent.parent.tasks.byTargetId.get(String(this.id)) || [];
        if(tasks.some(task => task.type.endsWith("stop") && task.finishedSuccessful && task.endtime && task.endtime.getTime() + 1000 > now && !(this.lastStatusAction && this.lastStatusAction.timestamp > task.endtime?.getTime()) )) { // A stop task finished not long ago (and not other button was pressed in the meanwhile) ?
            return "stopped" // Prevent flickering
        }

        return plainValue;
    }

    /**
     * After hibernating, it was sometimes seen that this.rawDataRecord = undefined (how come??), so undefined may be returned in that case
     * @see #status_extended
     */
    get status(): "prelaunch" | "running" | "stopped" | "suspended" | "paused"| undefined {
        return this._getImprovedStatus(this.rawDataRecord?.["status"] as string) as any;
    }

    /**
     * Electrified status that gives you more info (while {@link status} stays backward compatible with classic code
     * @see #status
     */
    get status_extended() {
        const runningTaks = this.parent.parent.tasks.byTargetId.get(String(this.id))?.filter(t => t.running) || [];
        if(runningTaks?.some(t => t.type?.endsWith("shutdown") && this.status !== "stopped")) {
            return "shutting_down";
        }
        if(runningTaks?.some(t => t.type?.endsWith("reboot") && this.status !== "stopped")) {
            return "rebooting";
        }
        if(runningTaks?.some(t => t.type === "qmstop" || t.type === "lxcstop")) {
            return "stopping";
        }
        return undefined;
    }

    isRunning() {
        return this.status === "running";
    }

    toString() {
        let id = `<unknown id>${this.snapshotName?`/[${this.snapshotName}]`:""}`;
        try {
            id = `${this.id}`;
        }
        catch (e) {
        }
        return `${id} (${this.type})`
    }

    /**
     *
     * @param snapname
     * @param description
     * @param vmstate Saves the vmstate = with memory
     */
    async createSnapshot(snapname: string, description:string, vmstate: boolean, options: RetryTilSuccessOptions = {}) {
        await this.configFile._calmDownAfterChangeEvent(); // Cause it was observed that calling createSnapshot after a config write sometimes caused missing change events

        const taskId = await this.node.api2fetch("POST", `/${this.type}/${this.id}/snapshot`, {
            snapname,
            description,
            ...(vmstate?{vmstate}:{})
        }) as string;
        await this.node.awaitTask(taskId);
        return await retryTilSuccess( async() => {
            await this._reReadFromConfig();
            !this.isLocked() || throwError(new RetryableError(`Guest is locked`));
            return this.snapshotRoot.snapshots.get(snapname) || throwError(new RetryableError(`Snapshot does not exist`));
        }, {maxTime: Number.POSITIVE_INFINITY, ...options});

    }

    /**
     * Rolls back to this snapshot.
     * @param start Whether the VM should get started after rolling back successfully. (Note: VMs will be automatically started if the snapshot includes RAM.). Does not wait, if this is set.
     */
    async rollBack(start: boolean) {
        this.isSnapshot() || throwError(`rollBack not called on a snapshot`)
        const taskId = await this.node.api2fetch("POST", `/${this.type}/${this.id}/snapshot/${this.snapshotName}/rollback`, {start}) as string;
        if(!start) {
            await this.node.awaitTask(taskId);
        }
    }

    async deleteSnapshot() {
        this.snapshotName || throwError(`Must call deleteSnapshot on a snapshot and not on the live guest`);
        const taskId = await this.node.api2fetch("DELETE", `/${this.type}/${this.id}/snapshot/${this.snapshotName}`, {}) as string;
        await this.node.awaitTask(taskId);
        await this.liveGuest._reReadFromConfig();
    }

    async delete() {
        if(this.isSnapshot()) {
            return await this.deleteSnapshot();
        }
        const taskId = await this.node.api2fetch("DELETE", `/${this.type}/${this.id}`, {}) as string;
        await this.node.awaitTask(taskId);
    }

    /**
     * Clones this guest. Uses fast-clone (zfs-clone for disks), if possible.
     * @param cloneParams Params like you see them in the UI dialog. See {@link Application#classes.CloneDialogResult}
     * @param selectCloneInTree ..., only when fast clone was used.
     */
    async clone(cloneParams: CloneDialogResult, selectCloneInTree=false) {
        const app = getElectrifiedApp();
        const node = this.node;
        const origGuest = this.liveGuest;


        const backupJobs = (await app.datacenter._getBackupJobs());
        const affectedIncludeBackupJobs = backupJobs.filter(b => b.includedGuests.some(g => g === origGuest));
        const affectedExcludeBackupJobs = backupJobs.filter(b => b.excludedGuests.some(g => g === origGuest));
        app.datacenter.hasQuorum || throwError("Cannot clone. Datacenter has no quorum."); // Check quorum

        const withRam = cloneParams.withRamPossible && cloneParams.withRam;

        // Exec zfs clone command(s)
        const destroyDataset = async (dataSetOrSnapshot: string) => {
            while (true) {
                try {
                    await node.execCommand`zfs destroy ${dataSetOrSnapshot}`;
                    return;
                }
                catch (e) {
                    if((e as Error)?.message?.indexOf("dataset is busy") >= 0) {
                        await sleep(200);
                        continue; // try again
                    }
                    throw e;
                }
            }
        }

        const rollbackFns: (() => Promise<void>)[] = [];
        const finallyFns: (() => Promise<void>)[] = [];
        try {
            let sourceSnapshot: Guest = cloneParams.snapshot;
            let clone: Guest;

            app._fix_nameHints.set(cloneParams.id, cloneParams.name); setTimeout(() => app._fix_nameHints.delete(cloneParams.id), 20000); // Help the resource tree to display the propert name

            if(cloneParams.fastClonePossible() === true) {
                let sourceSnapshotName = cloneParams.snapshot.snapshotName;
                if(sourceSnapshotName === undefined) {
                    sourceSnapshotName =getUniqueName(`fork_${cloneParams.id}_${cloneParams.name}`, new Set(origGuest.snapshotRoot.snapshots.keys()), 40);
                    sourceSnapshot = await origGuest.createSnapshot(sourceSnapshotName, t`Guest ${cloneParams.id} ${cloneParams.name} was forked/cloned from here using ZFS cloning (copy-on-write)`, withRam);
                    rollbackFns.push(async () => await sourceSnapshot!.deleteSnapshot());
                }

                clone = await Guest._fromConfig(origGuest.configFile, origGuest.constructor as any); // Construct clone in memory. Like in the Guest#_reReadFromConfig:

                clone = clone.snapshotRoot.snapshots.get(sourceSnapshotName) || throwError(`Object not found for snapshotname: ${sourceSnapshotName}`); // Use the specified snapshot as root

                clone.name = cloneParams.name;
                clone.comment = cloneParams.snapshot.comment;

                //Make clone the root and delete all other snapshots:
                clone.snapshotName = undefined;
                clone.snapshotRoot.snapshots = new Map([[undefined, clone]]);
                clone._parentSnapshotName = undefined;
                clone.childSnapshots = [];

                // Set id and node like in the Guest#_reReadFromConfig:
                clone._node = origGuest.node;
                clone._id = cloneParams.id;
                rollbackFns.push(async () => {clone._id = undefined; clone._node = undefined}); // Clean up possible mess


                // Copy firewall configuration:
                if (await retsync2promise(() => node.getFile(`/etc/pve/firewall/${origGuest.id}.fw`).exists)) {
                    await node.execCommand`cp /etc/pve/firewall/${origGuest.id}.fw /etc/pve/firewall/${clone.id}.fw`;
                    rollbackFns.push(async () => {await node.execCommand`rm /etc/pve/firewall/${clone.id}.fw`;});
                }

                clone.unused = []; // Remove unused disks

                // ZFS Clone disks
                for(const disk of clone.disks) {
                    if(disk.media === "cdrom") {
                        continue;
                    }
                    if(disk.type === "vmstate") {
                        continue; // Will be handled, see below
                    }
                    (disk.storage && disk.storage?.status === "available" || disk.storage?.status === "unknown" /* Strange behaviour: despite beeing available, it is reported as unknwon  */) || throwError(`Storage ${disk.storageName} is not available`);
                    if(disk.storage === undefined) throwError("not available");
                    disk.storage.type === "zfspool" || throwError(`Disk ${disk} is not zfs`);

                    const datasetFilePath = await disk.zfsGetDatasetFilePath();
                    const filePathMatch = /^(.*)\/(.*)-([0-9]+)-(.*)$/.exec(datasetFilePath) || throwError(`Dataset file of disk ${disk} has invalid format: ${datasetFilePath}`);
                    const clonedDatasetFilePath = `${filePathMatch[1]}/${filePathMatch[2]}-${clone.id}-${filePathMatch[4]}`;
                    await node.execCommand`zfs clone ${datasetFilePath}@${sourceSnapshotName} ${clonedDatasetFilePath}`
                    rollbackFns.push(async () => {
                        while (true) {
                            try {
                                await node.execCommand`zfs destroy ${clonedDatasetFilePath}`;
                                return;
                            }
                            catch (e) {
                                if((e as Error)?.message?.indexOf("dataset is busy") >= 0) {
                                    await sleep(200);
                                    continue; // try again
                                }
                                throw e;
                            }
                        }
                    });
                    // Set new file id in config:
                    const fileIdMatch = /^(.*)-([0-9]+)-(.*)$/.exec(disk.fileId) || throwError(`FileId of disk ${disk} has invalid format: ${disk.fileId}`);
                    disk.fileId = `${fileIdMatch[1]}-${clone.id}-${fileIdMatch[3]}`;
                }

                if(clone instanceof Qemu) {
                    await clone._deleteRunningState();
                }
            }
            else {
                const params: Record<string, unknown> = {
                    newid: cloneParams.id
                };

                if (cloneParams.snapshot.isSnapshot()) {
                    params.snapname = cloneParams.snapshot.snapshotName;
                }

                if (cloneParams.pool) {
                    params.pool = cloneParams.pool.name;
                }

                if (origGuest.type === 'lxc') {
                    params.hostname = cloneParams.name;
                } else {
                    params.name = cloneParams.name;
                }

                params.target = cloneParams.targetNode.name;
                params.full = 1;
                if(cloneParams.targetStorage) {
                    params.storage = cloneParams.targetStorage.name;
                }

                await(app.currentNode.awaitTask(await node.api2fetch("POST", '/' + origGuest.type + '/' + origGuest.id + '/clone', params) as string));

                // Freshly retrieve clone:
                clone = await retryTilSuccess(async () => {
                    await app.datacenter.ensureUp2Date();
                    return app.datacenter.getGuest(cloneParams.id) || throwError(new RetryableError("Guest not found after clone"));
                },{maxTime: 30000});
            }

            // Minor: Add rollback fn:
            if(cloneParams.fastClonePossible() !== true) {
                rollbackFns.push(async () => await clone.delete());
            }

            if(cloneParams.randomizeMacAddresses) {
                clone.net.forEach(networkInterface => networkInterface.randomizeMacAddress())
            }

            if(cloneParams.randomizeVmGenId && clone instanceof Qemu) {
                await clone.randomizeVmGenId();
            }

            // Write config:
            await retsync2promise(() => clone._writeConfig(), {checkSaved: false});

            await cloneParams.pool?.addGuest(clone); // add to pool

            let initialSnapshot: Guest | undefined = undefined;
            if(cloneParams.createInitialSnapshot) {
                await clone.configFile._calmDownAfterChangeEvent();

                // Take initial snapshot named "cloned":
                initialSnapshot = await clone.createSnapshot("cloned", t`Cloned from ${origGuest.id} ${origGuest.name}${sourceSnapshot.isSnapshot() ? `@${sourceSnapshot.snapshotName}` : ""}`, false)
                rollbackFns.push(async () => await initialSnapshot!.delete());

                if (withRam) {
                    // Copy running state fields:
                    const initialSnapshotConfigRecord = initialSnapshot._configRecord;
                    for(const key of sourceSnapshot._configRecord.keys()) {
                        if(key.startsWith("running") || key.startsWith("vmstate")) {
                            const value = sourceSnapshot._configRecord.get(key)!;
                            initialSnapshotConfigRecord.set(key, value)
                        }
                    }
                    await initialSnapshot._applyConfigValues(initialSnapshotConfigRecord); // Re-apply the plain record. this will i.e. initialize the vmstate disk
                    await retsync2promise(() => initialSnapshot!._writeConfig(), {checkSaved: false});

                    const sourceVmStateDisk = (sourceSnapshot as Qemu).vmstate!;
                    const datasetFilePath = await sourceVmStateDisk.zfsGetDatasetFilePath();
                    const filePathMatch = /^(.*)\/(.*)-([0-9]+)-state-(.*)$/.exec(datasetFilePath) || throwError(`Dataset file of disk ${sourceVmStateDisk} has invalid format: ${datasetFilePath}`);
                    const clonedDatasetFilePath = `${filePathMatch[1]}/${filePathMatch[2]}-${clone.id}-state-cloned`;
                    // Create snapshot for cloning:
                    const tempSnapshotName = `_forCloning`
                    try {
                        await node.execCommand`zfs list ${datasetFilePath}@${tempSnapshotName}`; // Check if snapshot exists. This may be left from a previous clone
                    } catch (e) { // Snapshot does not exist?
                        await node.execCommand`zfs snapshot ${datasetFilePath}@${tempSnapshotName}` // Create
                        rollbackFns.push(async () => destroyDataset(`${datasetFilePath}@${tempSnapshotName}`));
                    }
                    // Clone vmstate volume:
                    //finallyFns.push(async () => destroyDataset(`${datasetFilePath}@${tempSnapshotName}`)); // Cannot destroy snapshot //TODO: add it to diagnosis to be able to clean it up later
                    await node.execCommand`zfs clone ${datasetFilePath}@${tempSnapshotName} ${clonedDatasetFilePath}`
                    rollbackFns.push(async () => destroyDataset(clonedDatasetFilePath));

                    const fileIdMatch = /^(.*)-([0-9]+)-state-(.*)$/.exec(sourceVmStateDisk.fileId) || throwError(`FileId of disk ${sourceVmStateDisk} has invalid format: ${sourceVmStateDisk.fileId}`);
                    (initialSnapshot as Qemu).vmstate!.fileId = `${fileIdMatch[1]}-${clone.id}-state-cloned`;


                }
                else {
                    if(clone instanceof Qemu) {
                        await (initialSnapshot as Qemu)._deleteRunningState();
                    }
                }
                await retsync2promise(() => initialSnapshot!._writeConfig(), {checkSaved: false}); // Write config
            }

            // List in backups:
            {
                // Re-retrieve list (to be surely up2date if the dialog took a while):
                const backupJobs = (await app.datacenter._getBackupJobs());
                const affectedIncludeBackupJobs = backupJobs.filter(b => b.includedGuests.some(g => g === origGuest));
                const affectedExcludeBackupJobs = backupJobs.filter(b => b.excludedGuests.some(g => g === origGuest));

                affectedIncludeBackupJobs.forEach(b => b.updateIncludedGuests([...b.includedGuests, clone]));
                affectedExcludeBackupJobs.forEach(b => b.updateExcludedGuests([...b.excludedGuests, clone]));
            }


            await app.datacenter.ensureUp2Date();

            if(selectCloneInTree) {
                await app.refreshResourceTree();
                if (cloneParams.fastClonePossible() === true) { // Used fast clone / it didn't take long, so we can do jumpy stuff on the screen without disturbing the user?
                    app.workspace.down('pveResourceTree').selectById(`${clone.type}/${clone.id}`); // Select clone in tree
                }
            }

            if(cloneParams.start) {
                if(withRam) {
                    await initialSnapshot!.rollBack(true);
                }
                else {
                    await clone.startInteractively();
                }
            }
        }
        catch (e) {
            // Roll back everything:
            e = toError(e);
            rollbackFns.reverse();
            for(const fn of rollbackFns) {
                try {
                    await fn();
                }
                catch (rollbackError) {
                    e.message+= `\n\nThere was also a rollback error: ${toError(rollbackError).message}`;
                }
            }
            if(rollbackFns.length > 0) { e.message+="\n\nClone actions were rolled back after this error."}
            throw e;
        }
        finally {
            // Run finallyFns:
            finallyFns.reverse();
            const errors: Error[] = [];
            for(const fn of finallyFns) {
                try {
                    await fn();
                }
                catch (err) {
                    errors.push(toError(err));
                }
            }

            if(errors.length > 0) {
                const firstErr = errors[0];
                if(errors.length > 1) {
                    firstErr.message+=`\n** more errors by finallyFns: ${errors.slice(1).map(e => e.message).join("; ")}`
                }
                throw firstErr;
            }
        }
    }

    async suspend(todisk = false) {
        if(!todisk) { // Pause?
            this.lastStatusAction = {timestamp: new Date().getTime(), action: "pause"}
        }
        await this.parent.awaitTask(await this.parent.api2fetch("POST", `/${this.type}/${this.id}/status/suspend`,{todisk}) as string);
    }

    async start() {
        this.lastStatusAction = {timestamp: new Date().getTime(), action: "start"}
        getElectrifiedApp().currentNode.execCommand`${this.manageCmd} start ${this.id}`;
    }

    async resume() {
        this.lastStatusAction = {timestamp: new Date().getTime(), action: "resume"}
        await this.parent.awaitTask(await this.parent.api2fetch("POST", `/${this.type}/${this.id}/status/resume`,{}) as string);
    }

    async startOrResume() {
        if(this.status === "suspended" || this.status === "paused" || this.status === "prelaunch") {
            await(this.resume());
        }
        else {
            await(this.start());
        }
    }

    async shutdown() {
        await this.parent.awaitTask(await this.parent.api2fetch("POST", `/${this.type}/${this.id}/status/shutdown`,{}) as string);
    }

    /**
     * Stops the guest immediately
     */
    async stop() {
        if(this._rebootTask) {
            await this.parent.stopTask(this._rebootTask); // Otherwise stop may timeout and fail
        }
        await this.parent.awaitTask(await this.parent.api2fetch("POST", `/${this.type}/${this.id}/status/stop`,{"overrule-shutdown": true}) as string);
    }

    /**
     * Keep track of task to allow for faster top / reset
     */
    _rebootTask?: string;

    async reboot() {
        await this.parent.awaitTask(this._rebootTask = await this.parent.api2fetch("POST", `/${this.type}/${this.id}/status/reboot`,{}) as string);
    }

    async reset() {
        if(this._rebootTask) {
            await this.parent.stopTask(this._rebootTask); // Otherwise reset may timeout and fail
        }
        await this.parent.awaitTask(await this.parent.api2fetch("POST", `/${this.type}/${this.id}/status/reset`,{}) as string);
    }

    /**
     * ... displays a Dialog when there are resource conflicts (or not enough resources) before actually starting it.
     */
    async startInteractively() {
        try {
            // TODO: Show a dialog when there's not enough ram to start guest.

            // Determine conflicts:
            const conflictingPairsGroupedByOtherGuest = newDefaultMap<Guest, {thisHw: Hardware, otherHw: Hardware}[]>(() => [])
            for(const otherGuest of this.node.guests) {
                if(!otherGuest.isRunning()) {
                    continue;
                }
                if(otherGuest === this) {
                    continue; // Fix: When clicking stop and start fast, this guest could still be reported as  running
                }
                this.hardware.forEach(thisHw => {
                    otherGuest.hardware.forEach(otherHw => {
                        if(otherHw.constructor === thisHw.constructor && thisHw.conflictsWith_whenGuestIsRunning(otherHw)) {
                            conflictingPairsGroupedByOtherGuest.get(otherGuest).push({thisHw, otherHw});
                        }
                    })
                })
            }

            if(conflictingPairsGroupedByOtherGuest.size > 0) { // Has conflicts ?
                const result = await showBlueprintDialog<boolean>({title: t`Hardware conflict`, style: {width: "800px"}}, (props) => {
                    const userConfig = watched(getElectrifiedApp().userConfig)
                    const state = useWatchedState({
                        forceStop: userConfig.startWithResourceConflictOptions?.forceStop === true,
                        forceStopAfterSeconds: userConfig.startWithResourceConflictOptions?.forceStopAfterSeconds || 60,
                        alternatingMode: userConfig.startWithResourceConflictOptions?.alternatingMode === true,
                    }); // contentComponentFn was wrapped for you in a watchedComponent, so you can use watchedComponent features (see react-deepwatch)
                    return <div>
                        <div className={Classes.DIALOG_BODY}>
                            {t`These running guests use the same/conflicting hardware resources:`}<br/><br/>
                            {[...conflictingPairsGroupedByOtherGuest.keys()].map(otherGuest => <div key={otherGuest.id}>
                                <span className={`fa fa-${otherGuest.faIcon}`}/> {otherGuest.id} ({otherGuest.name})
                                {conflictingPairsGroupedByOtherGuest.get(otherGuest).map(conflictPair => {
                                    const reason = conflictPair.thisHw.conflictsWith_whenGuestIsRunning(conflictPair.otherHw);
                                    return <div key={conflictPair.otherHw.id} style={{paddingLeft: "16px"}}>
                                        <span className={`fa fa-fw pmx-icon ${conflictPair.otherHw.iconClass}`}/> {capitalize(conflictPair.otherHw.ui_type)} {conflictPair.otherHw.toString()}{typeof reason === "string"?<span>: {reason}</span>:undefined}
                                </div>})}
                            </div>)}
                            <hr style={{ width: "107%", position: "relative", left: "-16px"}} />
                        </div>
                        <div className={Classes.DIALOG_FOOTER}>
                            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                                <ButtonGroup style={{flexDirection: "column", gap: "8px", width: "100%"}}>
                                    <div>
                                        <Button onClick={() => {this.node.electrifiedApi.powerOffConflictingGuestsThenStartGuest([...conflictingPairsGroupedByOtherGuest.keys()].map(g => {return {id: g.id, type: g.type}}), state.forceStop, state.forceStopAfterSeconds, state.alternatingMode, {id: this.id, type: this.type}); props.close()}} intent={Intent.PRIMARY} fill={true}>{t`Power off conflicting guests first. Then start ${this.id} (${this.name})`}</Button>
                                        <div style={{padding: "8px", paddingTop: "4px", paddingLeft: "12px", paddingBottom: 0}}>
                                            <div style={{display: "flex", alignItems: "center"}}><span>↳</span><Checkbox {...bind(state.forceStop)} style={{position: "relative", top: "4px"}}/><RememberChoiceButton currentValue={state.forceStop} storageBind={binding(userConfig.startWithResourceConflictOptions.forceStop)}/><div style={{paddingLeft: "6px"}}>{t`Force shut down after `}&#160;</div> <InputGroup {...bind(state.forceStopAfterSeconds)} style={{width: "42px", marginRight: "4px"}}/><RememberChoiceButton currentValue={state.forceStopAfterSeconds} storageBind={binding(userConfig.startWithResourceConflictOptions.forceStopAfterSeconds)}/><div>&#160;{t`seconds`}.</div></div>
                                            <div style={{display: "flex"}}><span>↳</span><Checkbox {...bind(state.alternatingMode)}/><RememberChoiceButton currentValue={state.alternatingMode} storageBind={binding(userConfig.startWithResourceConflictOptions.alternatingMode)}/><div style={{paddingLeft: "6px"}}><strong>{t`Alternating mode`}:</strong> {t`Power conflicting guests back on when ${this.id} (${this.name})'s session has finished (= when it gets powered off).`}</div></div>
                                        </div>
                                    </div>
                                    <Button onClick={() => {this.start(); props.close()}} intent={Intent.PRIMARY}>{t`Start ${this.id} (${this.name}), ignore conflicts`}</Button>

                                    <Button onClick={() => props.close()}>Cancel</Button>

                                </ButtonGroup>
                            </div>
                        </div>
                    </div>;
                });
            }
            else {
                await this.start();
            }

        }
        catch (e) {
            await this.start(); // Start anyway
            throw e;
        }
    }

    abstract get manageCmd(): string;
}

class SnapshotRoot {
    snapshots = new Map<string | undefined, Guest>();

    get liveGuest() {
        return this.snapshots.get(undefined) || throwError("No live guest");
    }

    /**
     * ..., resource expensive / no caching.
     */
    async getSnapshotsSorted() {
        const guest = this.liveGuest;
        const snapList = (await guest.node.api2fetch("GET", `/${guest.type}/${guest.id}/snapshot`, {})) as any[];
        const snapNames_timestamp = new Map<string, number>(snapList.map(e => [e.name, e.snaptime]));

        const now = new Date().getTime();

        const result = [...this.snapshots.values()]
        result.sort((a, b) => {
            const getTime = (g: Guest): number => {
                return g.snapshotName?(snapNames_timestamp.get(g.snapshotName) || now) : now;
            }
            return getTime(a) - getTime(b);
        });

        return result;
    }
}