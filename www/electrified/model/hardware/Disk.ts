import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";
import {getElectrifiedApp} from "../../globals";
import {Storage} from "../Storage";

export class Disk extends Hardware {
    /**
     * ... mp = lxc mount point
     */
    type!: "ide" | "sata" | "scsi" | "virtio" | "efidisk" | "tpmstate" | "rootfs" | "mp" | "unused";
    static diskTypes = ["ide", "sata", "scsi", "virtio", "efidisk", "tpmstate", "rootfs", "mp", "unused"];
    static isDisk = true;

    /**
     * ... can be a string when an old configuration / snapshot was used
     */
    storageName!: string;

    /**
     * File id under storage. I.e. vm-827-disk-2
     */
    fileId!: string;

    rawOptions!: Record<string, string>;

    set rawConfigString(rawConfigString: string) {
        const throwIllegalConfig = () => throwError(`illegal/unsupported config string for disk: ${rawConfigString}. Guest: ${this.parent}`);

        // *** Parse raw config string into fields ***
        let splitPoint = rawConfigString.indexOf(",");
        if(splitPoint === -1) {
            splitPoint = rawConfigString.length;
        }
        // Parse storage and file id:
        const main = rawConfigString.substring(0, splitPoint).split(":");
        main.length === 2 || throwIllegalConfig();
        const [storageName, fileId] = main;
        this.storageName = storageName;
        this.fileId = fileId;
        // Parse raw options:
        this.rawOptions = {}
        if(splitPoint < rawConfigString.length) { // Options not empty?
            const optionTokens = rawConfigString.substring(splitPoint + 1).split(",");
            for (const token of optionTokens) {
                const [key, value] = token.split("=");
                this.rawOptions[key] = value;
            }
        }
    }

    get rawConfigString(): string {
        const optionTokens = Object.keys(this.rawOptions).map(key => `${key}=${this.rawOptions[key]}`);
        return [`${this.storageName}:${this.fileId}`, ...optionTokens].join(",");
    }

    set storage(value: Storage | undefined) {
        if(!value) {
            throw new Error("Storage must not be undefined");
        }

        this.storageName = value.name;
    }

    /**
     * Can be undefined when an old storage was configured
     */
    get storage() {
        return getElectrifiedApp().datacenter.getStorage(this.storageName);
    }

}