import {AsyncConstructableClass} from "../../util/AsyncConstructableClass";
import type {Guest} from "../Guest";

export class Hardware extends AsyncConstructableClass{
    index!: number;

    parent!: Guest

    /**
     *
     */
    rawConfigString!: string;

    /**
     * For preserve
     */
    get key() {
        return this.index;
    }
}