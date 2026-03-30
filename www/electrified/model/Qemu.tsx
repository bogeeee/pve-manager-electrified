import {Guest} from "./Guest";
import {Disk} from "./hardware/Disk";
import {t} from "../globals";

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

    ui_toString() {
        return t`VM ${this.id}`;
    }

    faIcon = "desktop"; // Implemented in subclass

    get manageCmd() {
        return "qm"
    }

    /**
     * Sets a new vmGenId in the format: 0e7a9f0f-8b56-46c3-bc21-f0c21b61fad9
     * You need to call writeConfig() afterwards
     */
    async randomizeVmGenId() {
        if(!this.isSnapshot()) {
            await this.node.execCommand`qm set ${this.id} -vmgenid 1`;
            return;
        }

        const digit = () => Math.floor(Math.random() * 16).toString(16);
        const digits = (repeat: number) => {
            let result = "";
            for(let i=0;i<repeat;i++) {
                result+=digit();
            }
            return result;
        }

        const newVmGenId = `${digits(8)}-${digits(4)}-${digits(4)}-${digits(4)}-${digits(12)}`

        this._rawConfigRecord.set("vmgenid", newVmGenId);
    }

    /**
     * ..., does not physically delete the disks (not implemented)
     */
    async _deleteRunningState() {
        // Delete keys starting with "running"
        for(const key of [...this._rawConfigRecord.keys()]) {
            if(key.startsWith("running")) {
                this._rawConfigRecord.delete(key);
            }
        }

        this.vmstate = undefined;
    }

}