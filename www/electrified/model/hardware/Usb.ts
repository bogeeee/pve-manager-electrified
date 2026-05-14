import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";
import {t} from "../../globals";

export class Usb extends Hardware {

    get configRecord() {
        const tokens = this.rawConfigString.split(",");

        const configRecord = new Map<string, string>();
        tokens.forEach(t => {
            const v = t.split("=");
            if (v.length === 1) {
                configRecord.set(v[0], "true");
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

    get isSpice() {
        return this.configRecord.has("spice");
    }

    /**
     *
     */
    get host() {
        return this.configRecord.get("host");
    }

    /**
     * mapping name when using mapped devices. Otherwise undefined
     */
    get mapping() {
        return this.configRecord.get("mapping");
    }

    get ui_type() {
        return t`usb device`;
    }
    get ui_pluralType() {
        return t`usb devices`;
    }

    ui_toString() {
        return t`usb device ${this.toString()} in ${this.parent.ui_toString()}`;
    }

    conflictsWith_whenGuestIsRunning(other: this) {
        if(this.mapping && this.mapping === other.mapping) {
            return `Mapped device name: ${this.mapping}`;
        }
        if(this.host && this.host === other.host) {
            return `Vendor/Device ID/Port: ${this.host}`;
        }
        return false;
    }



    faIcon = "usb";
}