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
    _updateFields(fields: any) {
        super._updateFields(fields);

        const fieldsToCopy: (keyof this)[] = ["memhost"];
        for(const key of fieldsToCopy) {
            //@ts-ignore
            this[key] = fields[key];
        }
    }
}