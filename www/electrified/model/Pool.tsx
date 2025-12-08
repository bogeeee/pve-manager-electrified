import {Guest} from "./Guest";
import {GuestsContainerBase} from "./GuestsContainerBase";
import {preserve} from "react-deepwatch";

export class Pool extends GuestsContainerBase{
    name!: string;

    /**
     * The raw data record from the ResourceStore that was returned by the api https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources
     * <p>
     *     If you find some information there, that is not also available directly as a field here, report this as a bug. I.e a new classic-pve feature that is not yet covered in electrified.
     * </p>
     */
    rawDataRecord!: Record<string, unknown>

    constructor(name: string) {
        super();
        this.name = name;
    }

    toString() {
        return `Pool: ${this.name}`;
    }

    get type(): "pool" {
        return "pool";
    }

    /**
     * Internal
     * @param fields fields from resource store
     */
    _updateFields(fields: any) {
        const fieldsToCopy: (keyof this)[] = [];
        for(const key of fieldsToCopy) {
            //@ts-ignore
            this[key] = fields[key];
        }

        this.rawDataRecord = preserve(this.rawDataRecord, fields, {destroyObsolete: false});

        this._fireUpdate();
    }
}