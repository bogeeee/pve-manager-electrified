import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {FetchError, spawnAsync, throwError} from "../util/util";
import {Node} from "./Node"
import {getElectrifiedApp} from "../globals";
import {ModelBase} from "./ModelBase";
import {ExternalPromise} from "restfuncs-common";


export class Datacenter extends ModelBase {
    static STATUS_REFRESH_INTERVAL = 3000; // In ms

    nodes!: Map<string, Node>;
    /**
     * When not true, we save the listeners that are called when flipped to true
     * @protected
     */
    protected _hasQuorum:true|ExternalPromise<void> = new ExternalPromise<void>();

    /**
     * Internal. For early handlers that must execute before {@see quorumPromise}
     */
    _earlyOnQuorumHandlers = new Set<() => Promise<void >>();

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

        // Refresh status regularly:
        await this.refreshStatus();
        setInterval(() => spawnAsync(async () => {
            try {
                await this.refreshStatus();
            }
            catch (e) {
                if(e !== null && e instanceof FetchError && e.httpStatusCode === 401)  { // Failed because no ticket? (logged out in the meanwhile)
                    return; // Don't spam the log with messages
                }
                throw e;
            }

        }), Datacenter.STATUS_REFRESH_INTERVAL); // Refresh status regularly
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
        let newHasQuorum = true;
        if(clusterData.length === 0) { // No cluster set up?
        }
        else if(clusterData.length === 1) { // A cluster is set up
            newHasQuorum = clusterData[0].quorate == 1;
        }
        else {
            throw new Error("Illegal response from server");
        }

        const changed = newHasQuorum !== (this._hasQuorum === true)
        if(newHasQuorum && this._hasQuorum !== true) { // Enter quorum?

            // Call early handlers:
            for(const l of this._earlyOnQuorumHandlers) {await l()}
            this._earlyOnQuorumHandlers.clear();

            this._hasQuorum.resolve();
            this._hasQuorum = true;
        }
        else if(!newHasQuorum && this._hasQuorum === true) { // Leave quorum?
            this._hasQuorum = new ExternalPromise<void>();
        }

        if(changed) {
            this._fireUpdate();
        }
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
        return this._hasQuorum  === true;
    }

    /**
     * @return hasQuorum / cluster is in sync (from this node's perspective). The value is queried from the server
     * @see hasQuorum
     */
    async queryHasQuorum() {
        await this.refreshStatus();
        return this.hasQuorum;
    }

    /**
     * Fulfilled when the datacenter has quorum
     * <p>
     * Usage: await app.datacenter.quorumPromise
     * </p>
     */
    get quorumPromise(): Promise<void> {
        if(this._hasQuorum === true) {
            return (async() => {})();
        }
        return this._hasQuorum;
    }

    /**
     *
     * @param record Record, returned from https://pve.proxmox.com/pve-docs/api-viewer/#/cluster/resources
     */
    _getItemForResourceRecord(record: {id: string, type: string, node: string, vmid: number}) {
        if(record.type === "node") {
            return this.getNode(record.node) || throwError( `Node does not exist: ${record.node}`)
        }
        else if(record.type === "qemu" || record.type === "lxc") {
            const node = this.getNode(record.node) || throwError( `Node does not exist: ${record.node}`)
            return node.getGuest(record.vmid) || throwError(`Guest does not exist: ${record.id}`);
        }
        else {
            return record as (Record<string, unknown> & typeof record);
        }
    }
}