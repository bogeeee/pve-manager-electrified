import {ModelBase} from "./ModelBase";
import {getElectrifiedApp} from "../globals";
import {spawnAsync, throwError} from "../util/util";
import {Guest} from "./Guest";
import {Lxc} from "./Lxc";
import {Qemu} from "./Qemu";
import {Node} from "./Node"

/**
 * Base for Node and Pool
 */
export abstract class GuestsContainerBase extends ModelBase{
    protected _guests!: Map<number, Guest>

    async _initWhenLoggedOn() {
        this._guests = new Map();
        await this.handleResourceStoreDataChanged();
        getElectrifiedApp()._resourceStore.on("datachanged", () => spawnAsync(() => this.handleResourceStoreDataChanged()));
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

    protected async handleResourceStoreDataChanged() {
        const guestsSeenInResourceStore = new Set<number>()
        for (const item of getElectrifiedApp()._resourceStore.getData().getRange()) { // Iterate all items from the resource store
            const dataRecord: any = item.data;
            const type = dataRecord.type as string;
            // Check if the item is for this container:
            if(this instanceof Node) {
                if (dataRecord.node !== this.name) { // Not for this node?
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
                    if (type === "lxc") {
                        guest = await Lxc.create({id});
                    } else if (type === "qemu") {
                        guest = await Qemu.create({id});
                    } else {
                        throw new Error("Unhandled type")
                    }
                    this._guests.set(id, guest);
                }

                guest._updateFields(dataRecord);
            }
        }
    }

    abstract toString(): string;
}