import {Guest} from "./Guest";

/**
 * A lxc guest
 * <p>
 * Besides the listed fields, all values from the config file (/etc/pve/lxc/xxx.conf) are represented as fields with the same name. Even if they are not listed in this **class**.
 * For those non-listed + boolean fields: They will have a 1/0 values instead of true/false.
 * </p>
 *
 */
export class Lxc extends Guest {
    get type(): "lxc" {
        return "lxc";
    }
}