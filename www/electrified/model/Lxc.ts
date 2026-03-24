import {Guest} from "./Guest";
import {Disk} from "./hardware/Disk";
import {t} from "../globals";

/**
 * A lxc guest
 * <p>
 * Besides the listed fields, all values from the config file (/etc/pve/lxc/xxx.conf) are represented as fields with the same name. Even if they are not listed in this **class**.
 * For those non-listed + boolean fields: They will have a 1/0 values instead of true/false.
 * </p>
 *
 */
export class Lxc extends Guest {

    static NAME_CONFIGURATION_KEY: string = "hostname";

    /**
     *
     */
    rootfs!: Disk;

    /**
     * Mount points
     * <p>
     * Array can have gaps, i.e. when the config file says: "mp0: ... , mp2: ..."
     * </p>
     */
    mp:Disk[] = [];

    get type(): "lxc" {
        return "lxc";
    }

    ui_toString() {
        return t`LXC ${this.id}`;
    }

    faIcon = "cube"; // Implemented in subclass

    get manageCmd() {
        return "pct"
    }
}