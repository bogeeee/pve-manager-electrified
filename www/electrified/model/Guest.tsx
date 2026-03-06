import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {getElectrifiedApp, MeteredValue} from "../globals";
import {ModelBase} from "./ModelBase";
import {preserve} from "react-deepwatch";
import type {Node} from "./Node"
import {isDeepEqual, spawnAsync, throwError} from "../util/util";
import {Disk} from "./hardware/Disk";
import {File} from "./File";
import {newDefaultMap} from "../util/util";
import {retsync2promise} from "proxy-facades/retsync";
import {Hardware} from "./hardware/Hardware";
import {NetworkInterface} from "./hardware/NetworkInterface";

export abstract class Guest extends ModelBase {
    _id?: number;

    name!: string;

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
     */
    _rawConfigRecord!: Map<string, string | string[]>;

    snapshotRoot!: SnapshotRoot;
    /**
     * Undefined when live guest
     */
    snapshotName?: string;
    parentSnapshot?: Guest
    childSnapshots: Guest[] = [];

    // *** Hardware ***

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
    lock!: string
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
    status!: string
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

    protected async constructAsync(): Promise<void> {
        await super.constructAsync();

        (this._id && this._node) || throwError("Id/node not set"); // Validity check

        await this._reReadFromConfig();

        this.configFile.onChange(() => spawnAsync( () => this._reReadFromConfig()));
    }

    /**
     * @returns Guest tree (guest + snapshots). Id and node are not yet set
     */
    static async _fromConfig(configFile: File, guestClazz: typeof Guest): Promise<Guest> {
        const cfgContent = await retsync2promise(() => configFile.content);

        const section2record = Guest._configString_to_sections2Record(cfgContent, configFile.path);

        // Safety check if parser functions are consistent:
        if(!isDeepEqual(section2record, Guest._configString_to_sections2Record(Guest._sections2Record_to_configString(section2record), configFile.path))) { // Note: convert to map, cause _.isEqual does not compare map subclasses
            throw new Error("Config parsing/serializing functions do not deliver consistent result for " + configFile.path + ". Reserialized output:\n" + Guest._sections2Record_to_configString(section2record));
        }

        // Create guest instances and add them to snapshotRoot:
        const snapshotRoot = new SnapshotRoot();
        for(const sectionName of section2record.keys()) {
            const section = section2record.get(sectionName)!;
            //@ts-ignore
            const guest: Guest = new guestClazz(); // use the non-async constructor
            guest.snapshotName = sectionName;
            guest.name = section.get("name") as string;

            await guest._applyConfigValues(section);

            snapshotRoot.snapshots.set(sectionName, guest); //Register
            guest.snapshotRoot = snapshotRoot;
        }

        // Set guest.parentSnapshot for all entries:
        for(const sectionName of section2record.keys()) {
            const guest = snapshotRoot.snapshots.get(sectionName)! || throwError("Illegal state. Expected guest/sectionsnapshot to exist");

            const section = section2record.get(sectionName)!;
            const parentName = section.get("parent") as string | undefined;
            if(parentName) {
                guest.parentSnapshot = snapshotRoot.snapshots.get(parentName);
                guest.parentSnapshot?.childSnapshots.push(guest);
            }
        }

        const liveGuest = snapshotRoot.snapshots.get(undefined)!;
        return liveGuest;
    }

    /**
     * ... must use it on fresh objects only.
     * @param configEntries entries from the config file (only one section/snapshot)
     * @see constructAsync
     */
    async _applyConfigValues(configEntries: Map<string, string | string[]>) {

        this._rawConfigRecord = configEntries;

        const hardwareKeys2Classes: {[key: string]: {clazz: typeof Hardware}} = {
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
        }

        for(const key of configEntries.keys()) {
            let value: string | string[] | number = configEntries.get(key)!;

            // Convert numeric value to number:
            if(typeof value === "string") {
                if(!Number.isNaN(Number(value))) {
                    value = Number(value);
                }
            }

            const createHardwareObject = async(key: string, rawConfigString: string, index?: number) => {
                const clazz = hardwareKeys2Classes[key]?.clazz || Hardware;
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

            if(Array.isArray(value)) { // Multiple?
                // Treat as hardwareArray:
                const hardwareArray: Hardware[] = [];
                for(const i in value) {
                    hardwareArray[i] = await createHardwareObject(key, value[i], Number(i));
                }
                //@ts-ignore
                this[key] = hardwareArray;
            }
            else {
                if(!Object.hasOwnProperty(key)) { // Not initialized by other code?
                    // @ts-ignore
                    this[key] = hardwareKeys2Classes[key]?await createHardwareObject(key, value):value;
                }
            }
        }
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
    }

    /**
     * Writes this._rawConfigRecord back to the config file
     */
    _writeConfig() {
        const configObj = new Map( [...this.snapshotRoot.snapshots.entries()].map(([section, guest]) => [section, guest._rawConfigRecord]) );
        const configContent = Guest._sections2Record_to_configString(configObj as any);
        this.configFile.content = configContent;
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
            if(line.match(/^\s*#.*/)) { // Comment ?
                continue;
            }

            const entryMatch = line.match(/^(\w+?)([0-9]*)\s*:(.*)$/);
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

    /**
     * @returns the life guest that is not a snapshot.
     */
    get liveGuest(): Guest {
       if(!this.isSnapshot()) {
           return this;
       }
       return this.childSnapshots.find(s => s.liveGuest) || throwError("Illegal state: no life guest found. Note that this error can occur after taking a snapshot, after which the config config file is **temporarily** in an illegal state (proxmox does not write the changes atomically).");
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
                [...diskOrDisks].forEach(disk => {
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
        const fieldsToCopy: (keyof this)[] = ["name", "cpu","disk","diskread", "diskwrite", "hastate", "lock", "maxcpu", "maxdisk", "maxmem", "mem", "netin", "netout", "status", "uptime"];
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
                    throw new Error("Illegal parent");
                }
            }
        }
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
}

class SnapshotRoot {
    snapshots = new Map<string | undefined, Guest>();
}