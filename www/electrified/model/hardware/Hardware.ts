import {AsyncConstructableClass} from "../../util/AsyncConstructableClass";
import type {Guest} from "../Guest";
import {throwError} from "../../util/util";
import {Notification, NotificationTarget} from "../../Notification";
import {t} from "../../globals";

export class Hardware extends AsyncConstructableClass implements NotificationTarget {

    /**
     * Index from the config.
     * This is set in subclasses when there there can be multiple items in the config. I.e. for disks: scsi0, scsi1, ...
     */
    index?: number;

    /**
     * i.e. "ide"
     */
    type!: string;

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

    get id() {
        return `${this.parent.id}/${this.type}${this.index || ""}`
    }

    get ui_type() {
        return t`hardware`;
    }
    get ui_pluralType() {
        return this.type + "s";
    }

    toString() {
        return `${this.type}${this.index !== undefined?this.index:""}`;
    }

    ui_toString() {
        return t`hardware ${this.toString()} in ${this.parent.ui_toString()}}`;
    }

    faIcon = "desktop"; // Implemented in subclass

    /**
     * TODO: keep content when preserving
     */
    notifications = new Map<string, Notification>();
}