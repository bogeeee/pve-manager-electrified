import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {spawnAsync, throwError} from "../util/util";
import {Node} from "./Node"
import {getElectrifiedApp} from "../globals";


export class Datacenter extends AsyncConstructableClass{
    nodes!: Map<string, Node>;

    getGuest(id: number): Guest | undefined {
        for(const node of this.nodes.values()) {
            const guest = node.getGuest(id);
            if(guest) {
                return guest;
            }
        }
    }

    protected async constructAsync(): Promise<void> {

        this.nodes = new Map<string, Node>();
        this.nodes.set((window as any).Proxmox.NodeName, getElectrifiedApp().currentNode); // Must re-use this instance  / don't let it auto-crate a new one

        await this.handleResourceStoreDataChanged();
        getElectrifiedApp()._resourceStore.on("datachanged", () => spawnAsync(() => this.handleResourceStoreDataChanged()));
    }

    protected async handleResourceStoreDataChanged() {
        const nodesSeenInResourceStore = new Set<string>()
        for(const nodeDesc of getElectrifiedApp()._resourceStore.getNodes()) {
            const name = nodeDesc.node as string || throwError("Name not set");

            nodesSeenInResourceStore.add(name);

            // Create if not exists:
            if(!this.nodes.has(name)) {
                const node = await Node.create({name});
                await node._initWhenLoggedOn();
                this.nodes.set(name, node); // Create it
            }

            // Update node fields:
            this.getNode(name)!._updateFields(nodeDesc);
        }

        // Delete nodes that don't exist anymore:
        [...this.nodes.keys()].forEach(name => {
            if(!nodesSeenInResourceStore.has(name)) {
                this.nodes.delete(name);
            }
        })
    }

    getNode(name: string) {
        return this.nodes.get(name);
    }

    getNode_existing(name: string) {
        return this.nodes.get(name) || throwError(`Node does not exist: ${name}`);
    }

    /**
     * Synchronous / live
     * @return hasQuorum / cluster is in sync (from this node's perspective)
     */
    get hasQuorum() {
        return true; // TODO
    }

    onOnlineStatusChanged(listener: (online: boolean)=> void) {
        // TODO
    }
}