import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";
import {t} from "../../globals";

/**
 * PCI (passthrough)-device
 */
export class HostPci extends Hardware {

    get configRecord() {
        const tokens = this.rawConfigString.split(",");

        const configRecord = new Map<string, string>();
        tokens.forEach(t => {
            const v = t.split("=");
            if (v.length === 1) {
                configRecord.set("deviceId", v[0]);
            }
            else if (v.length === 2) {
                configRecord.set(v[0], v[1]);
            }
            else {
                throwError(`Illegal config token: ${configRecord} in ${this}`);
            }
        })

        return configRecord;
    }

    /**
     * Device id or undefined if a mapped device is used
     */
    get deviceId() {
        return this.configRecord.get("deviceId")
    }

    /**
     * Mapped device name or undefined if a device id is directly used (no mapping)
     */
    get mapping() {
        return this.configRecord.get("mapping")
    }

    get ui_type() {
        return t`pci-device`;
    }
    get ui_pluralType() {
        return t`pci-devices`;
    }

    ui_toString() {
        return t`pci-device ${this.toString()} in ${this.parent.ui_toString()}`;
    }

    conflictsWith_whenGuestIsRunning(other: this) {
        if(this.mapping && this.mapping === other.mapping) {
            return `Mapped device name: ${this.mapping}`;
        }
        if(this.deviceId && this.deviceId === other.deviceId) {
            return `Device ID: ${this.deviceId}`;
        }
        return false;
    }

    faIcon = "pve-itype-icon-pci";

    get iconClass(): string {
        return "pve-itype-icon-pci";
    }
}