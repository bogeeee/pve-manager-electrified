import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {spawnAsync, throwError} from "../util/util";
import {Node} from "./Node"
import {getElectrifiedApp} from "../globals";
import {ModelBase} from "./ModelBase";


export class Datacenter extends ModelBase {
    static STATUS_REFRESH_INTERVAL = 3000; // In ms

    nodes!: Map<string, Node>;
    protected _hasQuorum?:boolean;

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

        await this.refreshStatus();
        setInterval(() => spawnAsync(async () => await this.refreshStatus()), Datacenter.STATUS_REFRESH_INTERVAL); // Refresh status regularly
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

        this._fireUpdate();
    }

    protected async refreshStatus() {
        const fetchResult = await getElectrifiedApp().api2fetch("GET", "/cluster/status") as any[];
        let clusterData = fetchResult.filter(r => r.type === "cluster");
        clusterData.length === 1 || throwError("Illegal response from server");
        this._hasQuorum = clusterData[0].quorate == 1;
    }

    getNode(name: string) {
        return this.nodes.get(name);
    }

    getNode_existing(name: string) {
        return this.nodes.get(name) || throwError(`Node does not exist: ${name}`);
    }

    /**
     *
     * @return hasQuorum / cluster is in sync (from this node's perspective). The value may be some seconds old.
     * @see queryHasQuorum
     */
    get hasQuorum() {
        return this._hasQuorum;
    }

    /**
     * @return hasQuorum / cluster is in sync (from this node's perspective). The value is queried from the server
     * @see hasQuorum
     */
    async queryHasQuorum() {
        await this.refreshStatus();
        return this.hasQuorum;
    }
}