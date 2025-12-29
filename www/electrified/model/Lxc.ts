import {Guest} from "./Guest";

/**
 * A lxc guest
 */
export class Lxc extends Guest {
    get type(): "lxc" {
        return "lxc";
    }
}