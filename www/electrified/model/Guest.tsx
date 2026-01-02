import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {getElectrifiedApp, MeteredValue} from "../globals";
import {ModelBase} from "./ModelBase";
import {preserve} from "react-deepwatch";
import type {Node} from "./Node"
import {spawnAsync, throwError} from "../util/util";
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

    // There are also non-listed fields which come from the config file

    /**
     * Array can have gaps, i.e. when the config file says: "disk0: ... , disk2: ..."
     */
    disks!: Disk[]

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
     * The pool name
     */
    pool?:string
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

        /**
         * @returns config sections with keys->values. The main/non-snapshot section is under: undefined
         */
        function parseConfigToSections2Record() {
            const result = newDefaultMap((s: string | undefined) => new Map<string, string | string[]>() );

            let section = result.get(undefined);
            for(let line of cfgContent.split("\n")) {
                line = line.trim();
                const sectionMatch = line.match(/^\[(.*)]$/);
                if(sectionMatch) {
                    !result.has(sectionMatch[1]) || throwError(`duplicate ${line} in config file ${configFile.path}`)
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
                    throw new Error(`Invalid line in config file ${configFile.path}:\n${line}`);
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
                    !existingValue || throwError(`Duplicate key: ${key} in config file ${configFile.path}`);
                    section.set(key, value);
                }
            }
            return result;
        }


        const section2record = parseConfigToSections2Record();

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

        const hardwareKeys2Classes: {[key: string]: typeof Hardware} = {net: NetworkInterface, disk: Disk}

        for(const key of configEntries.keys()) {
            let value: string | string[] | number = configEntries.get(key)!;

            // Convert numeric value to number:
            if(typeof value === "string") {
                if(!Number.isNaN(Number(value))) {
                    value = Number(value);
                }
            }

            if(Array.isArray(value)) { // Multiple?
                // Treat as hardware:
                const hardware: Hardware[] = [];
                for(const i in value) {
                    const clazz = hardwareKeys2Classes[key] || Hardware;
                    hardware[i] = await clazz.create({index: Number(i), rawConfigString: value[i], parent: this});
                }
                //@ts-ignore
                this[key] = hardware;
            }
            else {
                if(!Object.hasOwnProperty(key)) { // Not initialized by other code?
                    // @ts-ignore
                    this[key] = value;
                }
            }
        }
    }

    async _reReadFromConfig() {
        if(this.isSnapshot()) {
            throw new Error("Can only call it on the live guest");
        }
        const guestFromConfig = await Guest._fromConfig(this.configFile, this.constructor as any);
        guestFromConfig._node = this.node;
        guestFromConfig._id = this.id;
        const preserved = preserve(this, guestFromConfig)
        preserved === this || throwError("Illegal state");
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
       return this.childSnapshots.find(s => s.liveGuest) || throwError("Illegal state: no life guest found");
    }

    get id() {
        return this.liveGuest._id!;
    }

    get node() {
        return this.liveGuest._node!;
    }

    get configFile(): File {
        return this.node.getFile(`/etc/pve/nodes/${this.node.name}/${this.type === "lxc"?"lxc":(this.type === "qemu"?"qemu-server":throwError("unsupported type"))}/${this.id}.conf`);
    }

    abstract get type(): "lxc" | "qemu"

    /**
     * @param fields fields from resource store (classic pve)
     */
    _updateFieldsFromResourceStore(fields: any) {
        const fieldsToCopy: (keyof this)[] = ["name", "cpu","disk","diskread", "diskwrite", "hastate", "lock", "maxcpu", "maxdisk", "maxmem", "mem", "netin", "netout","pool","status", "uptime"];
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
}

class SnapshotRoot {
    snapshots = new Map<string | undefined, Guest>();
}