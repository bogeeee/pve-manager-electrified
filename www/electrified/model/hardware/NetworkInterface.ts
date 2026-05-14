import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";
import {t} from "../../globals";

export class NetworkInterface extends Hardware {

    randomizeMacAddress() {
        // Quick and dirty implementation:
        const match = /^(.*)=([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})(,.*)?$/.exec(this.rawConfigString) || throwError(`Invalid config string for NetworkInterface: ${this.rawConfigString}`);
        this.rawConfigString = `${match[1]}=${NetworkInterface.generateRandomMacAddress()}${match[4] || ""}`;
    }


    /**
     *
     * @param individualGroupBit true = group/multicast device
     */
    static generateRandomMacAddress(individualGroupBit = false) {
        let result: string[] = [];
        for(let i=0;i<6;i++) {
            const firstDigit = Math.floor(Math.random() * 16);

            let secondDigit = Math.floor(Math.random() * 16);
            if(i == 0) {
                // Set I/G bit:
                secondDigit = (Math.floor(secondDigit / 2) * 2) // Clean last bit
                secondDigit+=individualGroupBit?1:0;
            }

            result.push(firstDigit.toString(16) + secondDigit.toString(16))
        }
        return result.join(':').toUpperCase();
    }

    get ui_type() {
        return t`network interface`;
    }
    get ui_pluralType() {
        return t`network interfaces`;
    }

    ui_toString() {
        return t`network interface ${this.toString()} in ${this.parent.ui_toString()}}`;
    }

    faIcon = "hdd-o"; // Implemented in subclass

    get macAddress() {
        const tokens = this.rawConfigString.split(",");

        if(this.parent.type === "lxc") {
            const configRecord = new Map<string, string>();
            tokens.forEach(t => {
                const v = t.split("=");
                if (v.length !== 2) {
                    return; // ignore
                }
                configRecord.set(v[0], v[1]);
            })

            return configRecord.get("hwaddr");
        }
        else if(this.parent.type === "qemu"){
            // return ignoredKey=<mac address> from the first token:
            const t = tokens[0];
            const v = t.split("=");
            if (v.length !== 2) {
                return undefined; // ignore
            }
            return v[1];
        }
        else {
            throwError("Unsupported guest")
        }
    }

    conflictsWith_whenGuestIsRunning(other: this) {
        if (this.macAddress && this.macAddress === other.macAddress) {
            return t`Mac address: ${this.macAddress}`
        }

        return false;
    }

}