import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {FetchError, spawnAsync, throwError} from "../util/util";
import {Node} from "./Node"
import {getElectrifiedApp} from "../globals";
import {ModelBase} from "./ModelBase";
import {ExternalPromise} from "restfuncs-common";
import {Pool} from "./Pool";


export class Datacenter extends ModelBase {
    /**
     * Fast stats means: Electrified does additional polling calls with `usr/bin/ps`, to query for cpu, network, and guest status (running/not running). Cause the cluster cluster/resources's stats are too lame (~30 second average or so).
     */
    static ELECTRIFIED_GUEST_STATS_REFRESH_INTERVAL = 250; // In ms
    static STATUS_REFRESH_INTERVAL = 3000; // In ms

    _nodes!: Map<string, Node>;
    _pools!: Map<string, Pool>;
    /**
     * When not true, we save the listeners that are called when flipped to true
     * @protected
     */
    protected _hasQuorum:true|ExternalPromise<void> = new ExternalPromise<void>();

    /**
     * Internal. For early handlers that must execute before {@see quorumPromise}
     */
    _earlyOnQuorumHandlers = new Set<() => Promise<void >>();

    _cpuUsageWasNeeded = false;

    getGuest(id: number): Guest | undefined {
        for(const node of this._nodes.values()) {
            const guest = node.getGuest(id);
            if(guest) {
                return guest;
            }
        }
    }

    protected async constructAsync(): Promise<void> {
        const app = getElectrifiedApp();

        this._nodes = new Map<string, Node>();
        this._pools = new Map<string, Pool>();

        this._nodes.set((window as any).Proxmox.NodeName, app.currentNode); // Must re-use this instance  / don't let it auto-crate a new one

        await this.handleResourceStoreDataChanged();
        app._resourceStore.on("datachanged", () => spawnAsync(() => this.handleResourceStoreDataChanged()));

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


        // Refresh electrufied stats regularly:
        setInterval(() => spawnAsync(async () => {
            try {
                await this._refreshElectrifiedResourceStats();
            }
            catch (e) {
                if(e !== null && e instanceof FetchError && e.httpStatusCode === 401)  { // Failed because no ticket? (logged out in the meanwhile)
                    return; // Don't spam the log with messages
                }
                throw e;
            }

        }), Datacenter.ELECTRIFIED_GUEST_STATS_REFRESH_INTERVAL); // Refresh status regularly
    }

    protected async handleResourceStoreDataChanged() {
        // Nodes:
        {
            const nodesSeenInResourceStore = new Set<string>()
            for (const nodeDesc of getElectrifiedApp()._resourceStore.getNodes()) {
                const name = nodeDesc.node as string || throwError("Name not set");

                nodesSeenInResourceStore.add(name);

                // Create if not exists:
                if (!this._nodes.has(name)) {
                    const node = await Node.create({name});
                    await node._initWhenLoggedOn(this);
                    this._nodes.set(name, node); // Create it
                }

                // Update node fields:
                this.getNode(name)!._updateFields(nodeDesc);
            }

            // Delete nodes that don't exist anymore:
            [...this._nodes.keys()].forEach(name => {
                if (!nodesSeenInResourceStore.has(name)) {
                    this._nodes.delete(name);
                }
            })
        }
        
        // Pools
        {
            const poolsSeenInResourceStore = new Set<string>()
            for (const record of getElectrifiedApp()._resourceStore.getData().getRange().map((r:any) => r.data)) { // Iterate all items from the resource store
                if(record.type !== "pool") {
                    continue;
                }

                const name = record.pool as string || throwError("pool not set");

                poolsSeenInResourceStore.add(name);

                // Create if not exists:
                if (!this._pools.has(name)) {
                    const pool = new Pool(name);
                    await pool._initWhenLoggedOn(this);
                    this._pools.set(name, pool); // Create it
                }

                // Update pool fields:
                this.getPool(name)!._updateFields(record);
            }

            // Delete pools that don't exist anymore:
            [...this._pools.keys()].forEach(name => {
                if (!poolsSeenInResourceStore.has(name)) {
                    this._pools.delete(name);
                }
            })
        }

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

    /**
     * ElectrifiedResourceStats are additional stats with cpu usage and [running/not running]. Cause the cluster cluster/resources's stats are too lame (~30 second average or so).
     * <p>
     *     Works only for electrified nodes
     * </p>
     * @protected
     */
    protected async _refreshElectrifiedResourceStats() {
        for(const node of this.nodes) {
            // Skip non-electrified nodes:
            try {
                node.electrifiedClient
            }
            catch (e) {
                continue;
            }

            await node._refreshElectrifiedResourceStats(this._cpuUsageWasNeeded)
        }
        this._cpuUsageWasNeeded = false;
    }

    getNode(name: string) {
        return this._nodes.get(name);
    }

    getNode_existing(name: string) {
        return this._nodes.get(name) || throwError(`Node does not exist: ${name}`);
    }

    get nodes() {
        return [...this._nodes.values()];
    }

    get pools() {
        return [...this._pools.values()];
    }

    getPool(name: string) {
        return this._pools.get(name);
    }

    getPool_existing(name: string) {
        return this._pools.get(name) || throwError(`Pool does not exist: ${name}`);
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
    _getItemForResourceRecord(record: {id: string, type: string, node: string, pool: string, vmid: number}) {
        if(record.id === "root") {
            return this;
        }
        else if(record.type === "node") {
            return this.getNode(record.node) || throwError( `Node does not exist: ${record.node}`)
        }
        else if(record.type === "pool") {
            return this.getPool(record.pool) || throwError( `Pool does not exist: ${record.pool}`)
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