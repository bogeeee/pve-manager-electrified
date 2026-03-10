import {Guest} from "./Guest";
import {Disk} from "./hardware/Disk";

/**
 * A qemu virtual machine guest.
 * <p>
 * Besides the listed fields, all values from the config file (/etc/pve/quemu-server/xxx.conf) are represented as fields with the same name. Even if they are not listed in this **class**.
 * For those non-listed + boolean fields: They will have a 1/0 values instead of true/false.
 * </p>
 */
export class Qemu extends Guest{
    static NAME_CONFIGURATION_KEY = "name";

    /**
     * Used memory in bytes from the point of view of the host
     */
    memhost?: number

    /**
     * Ide disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "ide0: ... , ide2: ..."
     * </p>
     */
    ide: Disk[] = [];
    /**
     * Sata disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "sata0: ... , sata2: ..."
     * </p>
     */
    sata: Disk[] = [];
    /**
     * Scsi disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "scsi0: ... , scsi2: ..."
     * </p>
     */
    scsi: Disk[] = [];
    /**
     * Virtio disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "virtio0: ... , virtio2: ..."
     * </p>
     */
    virtio: Disk[] = [];
    /**
     * Efi disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "efi0: ... , efi2: ..."
     * </p>
     */
    efidisk: Disk[] = [];
    /**
     * Tpm state disks
     * <p>
     *  Array can have gaps, i.e. when the config file says: "tpmstate0: ... , tpmstate2: ..."
     * </p>
     */
    tpmstate: Disk[] = [];

    vmstate?: Disk

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

    get manageCmd() {
        return "qm"
    }

}