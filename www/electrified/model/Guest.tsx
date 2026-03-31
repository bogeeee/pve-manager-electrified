import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {getElectrifiedApp, MeteredValue, t} from "../globals";
import {ModelBase} from "./ModelBase";
import {preserve} from "react-deepwatch";
import type {Node} from "./Node"
import {
    isDeepEqual,
    RetryableError,
    retryTilSuccess,
    RetryTilSuccessOptions,
    spawnAsync,
    throwError
} from "../util/util";
import {Disk} from "./hardware/Disk";
import {File} from "./File";
import {newDefaultMap} from "../util/util";
import {retsync2promise} from "proxy-facades/retsync";
import {Hardware} from "./hardware/Hardware";
import {NetworkInterface} from "./hardware/NetworkInterface";
import {stringify as brilloutJsonStringify} from "@brillout/json-serializer/stringify"
import {instanceOf} from "prop-types";
import {NotificationTarget, Notification} from "../Notification";

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
     *
     */
    status!:"running" | "stopped"
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

        // Qemu:
        ide: {clazz: Disk},
        sata: {clazz: Disk},
        scsi: {clazz: Disk},
        virtio: {clazz: Disk},
        efidisk: {clazz: Disk},
        tpmstate: {clazz: Disk},
        unused: {clazz: Disk},
        vmstate: {clazz: Disk},
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

        const section2record = Guest._configString_to_sections2Record(cfgContent, configFile.path);

        // Safety check if parser functions are consistent:
        if(!isDeepEqual(section2record, Guest._configString_to_sections2Record(Guest._sections2Record_to_configString(section2record), configFile.path))) {
            throw new Error("Config parsing/serializing functions do not deliver consistent result for " + configFile.path + ". Reserialized output:\n" + Guest._sections2Record_to_configString(section2record));
        }

        // Create guest instances and add them to snapshotRoot:
        const snapshotRoot = new SnapshotRoot();
        for(const sectionName of section2record.keys()) {
            const section = section2record.get(sectionName)!;
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
        for(const sectionName of section2record.keys()) {
            const guest = snapshotRoot.snapshots.get(sectionName)! || throwError("Illegal state. Expected guest/sectionsnapshot to exist");

            const section = section2record.get(sectionName)!;
            const parentName = section.get("parent") as string | undefined;
            if(parentName) {
                guest._parentSnapshotName = parentName;
                guest.parentSnapshot?.childSnapshots.push(guest);
            }
        }

        const liveGuest = snapshotRoot.snapshots.get(undefined)!;
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
        const configObj = new Map( [...this.snapshotRoot.snapshots.entries()].map(([section, guest]) => [section, guest._configRecord]) );
        const configContent = Guest._sections2Record_to_configString(configObj as any);
        this.configFile.content = configContent;
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
        return this.node.getFile(`/etc/pve/nodes/${this.node.name}/${this.type === "lxc"?"lxc":(this.type === "qemu"?"qemu-server":throwError("unsupported type"))}/${this.id}.conf`);
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

    abstract get type(): "lxc" | "qemu"

    /**
     * @param fields fields from resource store (classic pve)
     */
    _updateFieldsFromResourceStore(fields: any) {
        const fieldsToCopy: (keyof this)[] = ["cpu","disk","diskread", "diskwrite", "hastate", "maxcpu", "maxdisk", "maxmem", "mem", "netin", "netout", "status", "uptime"];
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

    async start() {
        getElectrifiedApp().currentNode.execCommand`${this.manageCmd} start ${this.id}`;
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