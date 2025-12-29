import {ModelBase} from "./ModelBase";
import {getElectrifiedApp} from "../globals";
import {spawnAsync, throwError} from "../util/util";
import {Guest} from "./Guest";
import {Lxc} from "./Lxc";
import {Qemu} from "./Qemu";
import type {Datacenter} from "./Datacenter";
import type {Node} from "./Node";
import type {Pool} from "./Pool";

/**
 * Base for Node and Pool
 */
export abstract class GuestsContainerBase extends ModelBase{
    protected _guests!: Map<number, Guest>

    /**
     * @param datacenter needed by pool in early init phase
     */
    async _initWhenLoggedOn(datacenter?: Datacenter) {
        this._guests = new Map();
        await this._handleResourceStoreDataChanged(datacenter);
        getElectrifiedApp()._resourceStore.on("datachanged", () => spawnAsync(() => this._handleResourceStoreDataChanged()));
    }

    get guests() {
        return [...this._guests.values()];
    }


    getGuest(id: number) : Guest | undefined{
        return this._guests.get(id);
    }

    getGuest_existing(id: number){
        return this.getGuest(id) || throwError(`Guest with id ${id} does not exist on ${this.toString()}`);
    }

    /**
     *
     * @param datacenter needed in early init phase
     * @protected
     */
    protected async _handleResourceStoreDataChanged(datacenter?: Datacenter) {
        const guestsSeenInResourceStore = new Set<number>()
        const app = getElectrifiedApp();
        for (const item of app._resourceStore.getData().getRange()) { // Iterate all items from the resource store
            const dataRecord: any = item.data;
            const type = dataRecord.type as string;

            // Filter, if the item is for this container:
            if(this.type === "node") {
                if (dataRecord.node !== (this as any as Node).name) { // Not for this node?
                    continue
                }
            }
            else if(this.type === "pool") {
                if (dataRecord.pool !== (this as any as Pool).name) { // Not for this pool?
                    continue
                }
            }
            else {
                throw new Error("Unhandled")
            }

            if (type === "lxc" || type == "qemu") { // is a guest?
                const id = dataRecord.vmid as number;
                guestsSeenInResourceStore.add(id);
                let guest = this.getGuest(id);

                if (!guest) { // Guest is new?
                    if(this.type === "node") {
                        const node = this as any as Node;
                        // Create new guest object:
                        if (type === "lxc") {
                            guest = await Lxc.create({_id: id, _node: node});
                        } else if (type === "qemu") {
                            guest = await Qemu.create({_id: id, _node: node});
                        } else {
                            throw new Error("Unhandled type")
                        }
                    }
                    else {
                        datacenter = datacenter || app.datacenter;
                        guest = datacenter.getNode_existing(dataRecord.node).getGuest(id) || throwError("Expected guest to exist: " + id); // Get existing guest from datacenter
                    }

                    this._guests.set(id, guest);
                }

                guest._updateFieldsFromResourceStore(dataRecord);
            }
        }

        // Delete guests that don't exist anymore:
        [...this._guests.keys()].forEach(id => {
            if(!guestsSeenInResourceStore.has(id)) {
                this._guests.delete(id);
            }
        })
    }

    abstract toString(): string;


    abstract get type(): "pool" | "node"
}