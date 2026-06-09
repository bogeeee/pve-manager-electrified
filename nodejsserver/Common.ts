/**
 * Config for one node.
 * Reflects /etc/pve/local/electrified.json
 */
export class ElectrifiedJsonConfig {
    static readonly filePath = "/etc/pve/local/electrified.json";
    plugins: {
        name: string,
        version: string,
        codeLocation: "local"|"datacenter"|"npm",
    }[] = []

    /**
     * Refuse to start guests when the node has not enough ram
     */
    ramHeadroomWhenStartingGuestsInMib?: number = 2000;

    disks: DiskConfig[] = [];
}


export type DiskConfig = {
    /**
     * I.e. {selector: "file", value: "/dev/sda3"} or {selector: "uuid", value: "/dev/sda3"}
     */
    identifier: { type: "file" | "uuid" | "label", value: string }

    /**
     * For luks encrypted disk. Where should this be mapped under /dev/mapper/[name] ?
     */
    luksMappedName: string

    /**
     * Does not show the popup dialog or try any decryption
     */
    noDecrypt: boolean
};