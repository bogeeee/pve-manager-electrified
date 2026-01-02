import {Guest} from "./Guest";

/**
 * A qemu virtual machine guest.
 * <p>
 * Besides the listed fields, all values from the config file (/etc/pve/quemu-server/xxx.conf) are represented as fields with the same name. Even if they are not listed in this **class**.
 * For those non-listed + boolean fields: They will have a 1/0 values instead of true/false.
 * </p>
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