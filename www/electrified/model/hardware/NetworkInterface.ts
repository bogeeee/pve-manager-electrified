import {Hardware} from "./Hardware";
import {throwError} from "../../util/util";

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

}