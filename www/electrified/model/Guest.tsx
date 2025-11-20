import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {getElectrifiedApp} from "../globals";

export class Guest extends AsyncConstructableClass{
    id!: number;
    name!: string;

    /**
     * The raw data record from the ResourceStore that was returned by the api https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources
     * <p>
     *     If you find some information there, that is not also available directly as a field here, report this as a bug. I.e a new classic-pve feature that is not yet covered in electrified.
     * </p>
     */
    rawDataRecord!: Record<string, unknown>

    // *** Fields from ResourceStore / https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources: ***
    /**
     * CPU utilization
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
     * Internal
     * @param fields fields from resource store
     */
    _updateFields(fields: any) {
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

        this.rawDataRecord = fields;
    }
}