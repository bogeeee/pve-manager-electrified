import {AsyncConstructableClass} from "../../util/AsyncConstructableClass";
import type {Guest} from "../Guest";
import {throwError} from "../../util/util";

export class Hardware extends AsyncConstructableClass{

    /**
     * Index from the config.
     * This is set in subclasses when there there can be multiple items in the config. I.e. for disks: scsi0, scsi1, ...
     */
    index?: number;

    parent!: Guest

    /**
     *
     */
    private _rawConfigString?: string;

    /**
     * For preserve
     */
    get key() {
        return this.index;
    }

    get rawConfigString(): string {
        return this._rawConfigString || throwError("Illegal state: _rawConfigString not set.");
    }

    set rawConfigString(value: string) {
        this._rawConfigString = value;
    }

    static isDisk = false;
}