import {Guest} from "./Guest";

/**
 * A qemu virtual machine guest
 */
export class Qemu extends Guest{
    /**
     * Used memory in bytes from the point of view of the host
     */
    memhost?: number

    /**
     * Internal
     * @param fields fields from resource store
     */
    _updateFieldsFromResourceStore(fields: any) {
        super._updateFieldsFromResourceStore(fields);

        const fieldsToCopy: (keyof this)[] = ["memhost"];
        for(const key of fieldsToCopy) {
            //@ts-ignore
            this[key] = fields[key];
        }
    }

    get type(): "qemu" {
        return "qemu";
    }
}