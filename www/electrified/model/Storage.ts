import {ModelBase} from "./ModelBase";
import {preserve} from "react-deepwatch";
import {getElectrifiedApp, t} from "../globals";
import {Node} from "./Node"
import type {Datacenter} from "./Datacenter"
import {Notification, NotificationTarget} from "../Notification";

export class Storage extends ModelBase implements NotificationTarget {
    name!: string;
    content!: string[];
    /**
     * Used disk space in bytes
     */
    disk!: number;

    /**
     * Storage size in bytes
     */
    maxdisk!: number;

    /**
     * "zfspool", ...
     */
    plugintype!: string;


    /**
     * Note: Saw a strange behaviour where "available" was reported as "unknown"
     */
    status!: "available" | "unknown" | unknown;

    node!: Node | undefined

    constructor(name: string) {
        super();
        this.name = name;
    }

    /**
     * The raw data record from the ResourceStore that was returned by the api https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources
     * <p>
     *     If you find some information there, that is not also available directly as a field here, report this as a bug. I.e a new classic-pve feature that is not yet covered in electrified.
     * </p>
     */
    rawDataRecord!: Record<string, unknown>

    toString() {
        return `Storage: ${this.name}`;
    }

    /**
     * "zfspool", ...
     */
    get type() {
        return this.plugintype;
    }

    // *** <Notification interface> ***
    get id() {
        return this.name;
    }
    get parent() {
        return getElectrifiedApp().datacenter;
    }
    get ui_pluralType() {
        return t`storages`;
    }
    ui_toString() {
        return t`storage ${this.name}`;
    }
    faIcon = "database"; // Implemented in subclass
    /**
     * TODO: keep content when preserving
     */
    notifications = new Map<string, Notification>();
    // *** </Notification interface> ***

    /**
     * Internal
     * @param fields fields from resource store
     */
    _updateFields(fields: any, datacenter: Datacenter) {
        const fieldsToCopy: (keyof this)[] = ["disk", "maxdisk","plugintype", "status"];
        for(const key of fieldsToCopy) {
            //@ts-ignore
            this[key] = fields[key];
        }

        this.node = fields.node?datacenter.getNode(fields.node):undefined;

        this.content = fields.content.split(",");

        this.rawDataRecord = preserve(this.rawDataRecord, fields, {destroyObsolete: false});

        this._fireUpdate();
    }
}