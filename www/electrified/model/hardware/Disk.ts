import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";
import {getElectrifiedApp, t} from "../../globals";
import {Storage} from "../Storage";

export class Disk extends Hardware {
    /**
     * ... mp = lxc mount point
     */
    type!: "ide" | "sata" | "scsi" | "virtio" | "efidisk" | "tpmstate" | "rootfs" | "mp" | "unused";
    static diskTypes = ["ide", "sata", "scsi", "virtio", "efidisk", "tpmstate", "rootfs", "mp", "vmstate", "unused"];
    static isDisk = true;

    /**
     * Storage name or undefined which was observed in old configs for lxcs that had just the path. I.e. "/rpool/subvol-150-disk-1/some/path"
     */
    storageName?: string;

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
        const volumeId = rawConfigString.substring(0, splitPoint).split(":");
        if(volumeId.length === 1) { // Observed some old configs for lxcs that had just the path. I.e. "/rpool/subvol-150-disk-1/some/path"
            this.storageName = undefined;
            this.fileId = volumeId[0];
        }
        else if(volumeId.length === 2) {
            const [storageName, fileId] = volumeId;
            this.storageName = storageName;
            this.fileId = fileId;
        }
        else {
            throwIllegalConfig();
        }

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
        return [this.volumeId, ...optionTokens].join(",");
    }

    set storage(value: Storage | undefined) {
        if(!value) {
            throw new Error("Storage must not be undefined");
        }

        this.storageName = value.name;
    }

    /**
     * Can be undefined when an old storage was configured or an old format was used
     */
    get storage() {
        if(!this.storageName) {
            return undefined;
        }
        return getElectrifiedApp().datacenter.getStorage(this.storageName);
    }

    get media() {
        return this.rawOptions["media"];
    }

    /**
     * @returns I.e. `myZfsPool:vm-123-disk-0`
     */
    get volumeId() {
        return this.storageName?`${this.storageName}:${this.fileId}`:this.fileId;
    }

    /**
     * @returns I.e. `/dev/zvol/myStorage/myPool/vm-123-disk-0`
     */
    async _getVolumeFileOrDatasetPath() {
        return this.parent.node.execCommand`pvesm path ${this.volumeId}`;
    }

    /**
     * @returns I.e. `myStorage/myPool/vm-123-disk-0`
     */
    async zfsGetDatasetFilePath() {
        const volPath = await this._getVolumeFileOrDatasetPath();
        if(volPath.startsWith("/dev/zvol/")) {
            const match = /^\/dev\/zvol\/(.*)$/.exec(volPath) || throwError(`Invalid volume file path: ${volPath}`);
            return match[1];
        }
        else { // Directly
            return volPath.replace(/^\//,""); // Remove leading slash
        }
    }

    get ui_type() {
        return t`disk`;
    }
    get ui_pluralType() {
        return t`disks`;
    }
    ui_toString() {
        return t`disk ${this.toString()} in ${this.parent.ui_toString()}}`;
    }

    faIcon = "hdd-o"; // Implemented in subclass

}