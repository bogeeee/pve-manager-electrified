import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {ClassOf, FetchError, isSubclassOf, newDefaultMap, spawnAsync, sum, throwError, toError} from "../util/util";
import {Node} from "./Node"
import {getElectrifiedApp, t} from "../globals";
import {ModelBase, objectIsDestroyed} from "./ModelBase";
import {ExternalPromise} from "restfuncs-common";
import {Pool} from "./Pool";
import {Storage} from "./Storage"
import _ from "underscore"

import {Notification, NotificationTarget} from "../Notification";
import {preserve} from "react-deepwatch";
import type {Plugin} from "../Plugin";
import {RecordedRead, WatchedProxyFacade} from "proxy-facades";
import createRBTree from "functional-red-black-tree";


export class Datacenter extends ModelBase implements NotificationTarget{
    /**
     * Fast stats means: Electrified does additional polling calls with `usr/bin/ps`, to query for cpu, network, and guest status (running/not running). Cause the cluster cluster/resources's stats are too lame (~30 second average or so).
     */
    static ELECTRIFIED_GUEST_STATS_REFRESH_INTERVAL = 250; // In ms
    static STATUS_REFRESH_INTERVAL = 3000; // In ms
    static TASKS_STORE_REFRESH_INTERVAL = 500; // In ms. PVE default is 3000

    /**
     * The tasks that you see in the south panel (not the clusterlog)
     */
    tasks = new class {
        running: PveClusterTask[] = []
        byTargetId = new Map<string, PveClusterTask[]>();
        get all(): PveClusterTask[] {
            throw new Error("Not yet implemented / costs too much performance. Say so if needed.")
        }
    }

    _nodes!: Map<string, Node>;
    _pools!: Map<string, Pool>;
    _storages!: Map<string, Storage>;
    
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

    getFreeGuestId(start: number) {
        while(this.getGuest(start)) {
            start++;
        }
        return start;
    }

    protected async constructAsync(): Promise<void> {
        const app = getElectrifiedApp();

        this._nodes = new Map<string, Node>();
        this._pools = new Map<string, Pool>();
        this._storages = new Map<string, Storage>();

        this._nodes.set((window as any).Proxmox.NodeName, app.currentNode); // Must re-use this instance  / don't let it auto-crate a new one
        app.currentNode._parent = this;

        await this._handleResourceStoreDataChanged();
        app._resourceStore.on("datachanged", () => spawnAsync(() => this._handleResourceStoreDataChanged()));

        // Refresh status regularly:
        await this._refreshStatus();
        setInterval(() => spawnAsync(async () => {
            try {
                await this._refreshStatus();
            }
            catch (e) {
                if(e !== null && e instanceof FetchError && e.httpStatusCode === 401)  { // Failed because no ticket? (logged out in the meanwhile)
                    return; // Don't spam the log with messages
                }
                throw e;
            }

        }), Datacenter.STATUS_REFRESH_INTERVAL); // Refresh status regularly


        // Refresh electrufied stats regularly:
        setInterval(() => {
            window.localStorage.setItem("debug_electrified_datacenter_refreshResourceStatsTimer_called_1", String(Number((window.localStorage.getItem("debug_electrified_datacenter_refreshResourceStatsTimer_called_1") || 0)) + 1));
            spawnAsync(async () => {
                try {
                    window.localStorage.setItem("debug_electrified_datacenter_refreshResourceStatsTimer_called_2", String(Number((window.localStorage.getItem("debug_electrified_datacenter_refreshResourceStatsTimer_called_2") || 0)) + 1));
                    await this._refreshElectrifiedResourceStats();
                }
                catch (e) {
                    if(e !== null && e instanceof FetchError && e.httpStatusCode === 401)  { // Failed because no ticket? (logged out in the meanwhile)
                        return; // Don't spam the log with messages
                    }
                    if(e !== null && e instanceof Error && e.message.startsWith("Socket connection has been closed"))  { // Socket connection closed in the middle of a call? Observed sometimes with firefox and in production mode (not ideal)
                        // Just log (no error popup):
                        console.error(e);
                        return;
                    }
                    throw e;
                }

            })
        }, Datacenter.ELECTRIFIED_GUEST_STATS_REFRESH_INTERVAL); // Refresh status regularly

        this._taskStore.rstore.interval = Datacenter.TASKS_STORE_REFRESH_INTERVAL; // Boost the refresh rate
        this._taskStore.on("datachanged", () => this._updateTasksFromPveTaskStore()); // Subscribe to task store
        this._updateTasksFromPveTaskStore(); // refresh once now
    }

    get _taskStore() {
        return getElectrifiedApp().workspace.down("pveClusterTasks").getStore(); // Note: There is pveClusterTasks and pveClusterTasks
    }

    /**
     * Takes the items from the pve task store and populates this.tasks
     */
    _updateTasksFromPveTaskStore() {
        const newTasksObj: this["tasks"] = new (this.tasks.constructor as any)
        for(const item of this._taskStore.getData().getRange()) {
            const data = item.data;
            const task = new PveClusterTask(data);

            newTasksObj.running.push(task);
            if(task.id) {
                newTasksObj.byTargetId.has(task.id) || newTasksObj.byTargetId.set(task.id, []); // Fill default value
                newTasksObj.byTargetId.get(task.id)!.push(task);
            }
        }

        preserve(this.tasks,newTasksObj,{destroyObsolete: false, ignoresIds: true});

    }

    protected async _handleResourceStoreDataChanged() {
        // Nodes:
        {
            const nodesSeenInResourceStore = new Set<string>()
            for (const nodeDesc of getElectrifiedApp()._resourceStore.getNodes()) {
                const name = nodeDesc.node as string || throwError("Name not set"); // Note: "Name not set" has been observed

                nodesSeenInResourceStore.add(name);

                // Create if not exists:
                if (!this._nodes.has(name)) {
                    const node = await Node.create({name, _parent: this});
                    await node._initWhenLoggedOn(this);
                    this._nodes.set(name, node); // Create it
                }

                // Update node fields:
                this.getNode(name)!._updateFields(nodeDesc);
            }

            // Delete nodes that don't exist anymore:
            [...this._nodes.keys()].forEach(name => {
                if (!nodesSeenInResourceStore.has(name)) {
                    // Health check:
                    if(name === getElectrifiedApp().currentNode.name) {
                        console.warn(`Current node ${name} not seen in resource store. Unusual -> refusing to delete it from the model. If you have renamed this node, reload this page`);
                        return;
                    }

                    console.warn(`Deleting node ${name} because it was not seen in the resource store. Did you rename it or remove it from the cluster? Please reload the page to make sure, pve-electrified runs stable.`);
                    this._nodes.delete(name);
                }
            })
        }

        // Pools
        {
            const poolsSeenInResourceStore = new Set<string>()
            for (const record of getElectrifiedApp()._resourceStore.getData().getRange().map((r: any) => r.data)) { // Iterate all items from the resource store
                if (record.type !== "pool") {
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

        // Storages:
        {
            const storagesSeenInResourceStore = new Set<string>()
            for (const record of getElectrifiedApp()._resourceStore.getData().getRange().map((r: any) => r.data)) { // Iterate all items from the resource store
                if (record.type !== "storage") {
                    continue;
                }

                const name = record.storage as string || throwError("storage not set");

                storagesSeenInResourceStore.add(name);

                // Create if not exists:
                if (!this._storages.has(name)) {
                    const storage = new Storage(name);
                    this._storages.set(name, storage); // Create it
                }

                // Update storage fields:
                this.getStorage(name)!._updateFields(record, this);
            }

            // Delete storages that don't exist anymore:
            [...this._storages.keys()].forEach(name => {
                if (!storagesSeenInResourceStore.has(name)) {
                    this._storages.delete(name);
                }
            })
        }

        this.nodes.forEach(node => node._handleResourceStoreDataChanged(this));
        this.pools.forEach(pool => pool._handleResourceStoreDataChanged(this));

        this._fireUpdate();
    }

    protected async _refreshStatus() {
        if(!getElectrifiedApp().loginData?.cap.nodes["Sys.Audit"]) {
            return; // /cluster/status needs that permission so we can't do anything here. Quorum related method will check for this permission also
        }

        await getElectrifiedApp().checkLoggedOut();

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

    // *** <Notification interface> ***
    get id() {
        return "datacenter";
    }
    get type() {
        return "datacenter";
    }
    get parent() {
        return undefined;
    }
    get ui_type() {
        return t`datacenter`;
    }
    get ui_pluralType() {
        return "";
    }
    ui_toString() {
        return t`the datacenter`;
    }
    faIcon = "server"; // Implemented in subclass
    /**
     * TODO: keep content when preserving
     */
    notifications = new Map<string, Notification>();
    // *** </Notification interface> ***

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

    get storages() {
        return [...this._storages.values()];
    }

    getStorage(name: string) {
        return this._storages.get(name);
    }

    getStorage_existing(name: string) {
        return this._storages.get(name) || throwError(`Storage does not exist: ${name}`);
    }

    /**
     *
     * @return hasQuorum / cluster is in sync (from this node's perspective). The value may be some seconds old.
     * @see queryHasQuorum
     */
    get hasQuorum() {
        getElectrifiedApp().loginData?.cap.nodes["Sys.Audit"] || throwError("Cannot determine hasQuorum status. No Sys.Audit permission."); // Permission check

        return this._hasQuorum  === true;
    }

    /**
     * @return hasQuorum / cluster is in sync (from this node's perspective). The value is queried from the server
     * @see hasQuorum
     */
    async queryHasQuorum() {
        await this._refreshStatus();
        return this.hasQuorum;
    }

    /**
     * Fulfilled when the datacenter has quorum
     * <p>
     * Usage: await app.datacenter.quorumPromise
     * </p>
     */
    get quorumPromise(): Promise<void> {
        getElectrifiedApp().loginData?.cap.nodes["Sys.Audit"] || throwError("Cannot determine hasQuorum status. No Sys.Audit permission."); // Permission check

        if(this._hasQuorum === true) {
            return (async() => {})();
        }
        return this._hasQuorum;
    }

    /**
     * Forces a big refresh.
     * <p>
     * Warning: Still some things are stale after the call. I.e. cloned guests don't appear. You may have to wait and retry till you see the desired data.
     * </p>
     */
    async ensureUp2Date() {
        await this._refreshStatus();
        // Call resourceStore.startUpdate() to force a refresh and wait till we receive an update:
        await new Promise<void>((resolve, reject) => {
            const updateListener = () => {this.offUpdate(updateListener);resolve(); }
            this.onUpdate(updateListener);
            try {
                getElectrifiedApp()._resourceStore.startUpdate(); // Force reload
            }
            catch (e) {
                this.offUpdate(updateListener);
                reject(e);
            }
        });
    }

    get mem() {
        return sum(this.nodes.map(n => n.mem));
    }

    get maxmem() {
        return sum(this.nodes.map(n => n.maxmem));
    }

    async _getBackupJobs() {
        return ((await getElectrifiedApp().api2fetch("GET", "/cluster/backup")) as any[]).map(cfg => new class {
            id!:string;
            pool?: string;
            all: boolean;

            /**
             * Comma separated list of vm ids
             */
            exclude?: string;

            /**
             * Comma separated list of vm ids
             */
            vmid?: string;

            constructor(cfg: any) {
                _.extend(this, cfg);
                this.all = cfg.all?true:false;
            }

            /**
             * Explicitly included guests
             */
            get excludedGuests() {
                return this._idsToGuests(this.exclude);
            }

            /**
             * Explicitly included guests
             */
            get includedGuests() {
                return this._idsToGuests(this.vmid);
            }

            _idsToGuests(ids: string | undefined): Guest[] {
                if(!ids) {
                    return [];
                }
                const result: Guest[] = [];
                for(const id of ids.split(",")) {
                    const guest = getElectrifiedApp().datacenter.getGuest(Number(id));
                    if(guest) {
                        result.push(guest);
                    }
                }
                return result;
            }

            get pools(): Pool[] {
                if(!this.pool) {
                    return [];
                }
                const result: Pool[] = [];
                for(const name of this.pool.split(",")) {
                    const pool = getElectrifiedApp().datacenter.getPool(name);
                    if(pool) {
                        result.push(pool);
                    }
                }
                return result;
            }

            _hasPool(pool: Pool | undefined) {
                if(!pool) {
                    return false;
                }
                return this.pools.some(p => p.name === pool.name)
            }

            async updateIncludedGuests(guests: Guest[]) {
                await getElectrifiedApp().api2fetch("PUT", `/cluster/backup/${this.id}`, {
                    vmid: guests.map(g => String(g.id)).join(","),
                });
            }
            async updateExcludedGuests(guests: Guest[]) {
                await getElectrifiedApp().api2fetch("PUT", `/cluster/backup/${this.id}`, {
                    exclude: guests.map(g => String(g.id)).join(","),
                });
            }
        }(cfg))
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
            return node.getGuest(record.vmid) || throwError(`Guest does not exist: ${record.vmid}`);
        }
        else {
            return record as (Record<string, unknown> & typeof record);
        }
    }
}

export class PveClusterTask {
    /**
     * Id of the item which the task is about. I.e. the guest's id. I.e. "820"
     */
    id!: string;

    get key() {
        return this.upid
    }

    duration!: number;

    /**
     * Save as number because react-deepwatch still has a bug for Date handling
     */
    _endtime?: number;
    get endtime(): Date | null {
        return this._endtime?new Date(this._endtime):null;
    }
    set endtime(value) {
        this._endtime = value?.getTime();
    }

    node?: string
    pid?: number
    /**
     * I.e. "1"
     */
    saved?: "1"

    starttime!: Date;

    /*
     * Ok, or error status I.e. "unexpected status"
     */
    status!: string;

    /**
     * I.e. "startall"
     */
    type!: string;

    /**
     * I.e. "UPID:pveWohnungTest:0001D387:0008D22C:6A16CA41:startall::root@pam:"
     */
    upid!:string

    /**
     * I.e. "root@pam"
     */
    user?: string

    get running() {
        return this.endtime === null;
    }

    get finishedSuccessful() {
        return !this.running && this.status == "OK"
    }

    constructor(initialFields: Partial<PveClusterTask>) {
        _.extend(this, initialFields)
    }
}

/**
 * ... a task instance is created for each runForEach ModelBase instance. Therefore, you can also store item associated runtime/cache fields here.
 * You can let it run in a regular interval or make it immediately react to relevant model changes, using {@link DiagnosisTask#watched} or both.
 * All time values in the config are in milliseconds.
 * <p>
 *     Example:
 * </p>
 * <pre><code>
     async earlyInit(): Promise<void> {
        const thisPlugin = this;

        class LowRamNotification extends Notification {
            get title() {return t`Low on ram`}
        }

        (class LowRamDiagnosisTask extends DiagnosisTask<Datacenter> {
            static plugin = thisPlugin;
            static producesNotifications = [LowRamNotification];
            static runForEach = Node;
            static runInRegularInterval = undefined; // No need, we watch what we need
            static initialEstimatedDuration=4; // 4ms

            async run(node: Node) {
                console.log(`Diagnosis task running for ${node}`)
                node = this.watched(node);
                // ...watch every other object that we need. I.e. this.watched(getElectrifiedApp().datacenter)

                if(node.mem > node.maxmem * 0.8) {
                    new LowRamNotification({
                        plugin: thisPlugin,
                        about: node,
                        textContent: t`Node ${node.name} is low on ram`,
                    }).registerAndShow();
                }
            }
        }).registerInApp();
    }
 *
 * </code></pre>
 *
 * @see Notification
 */
export abstract class DiagnosisTask<M extends ModelBase> {
    /**
     * So the user know which plugin provides this (or is to blame if stuff gets slow ;) )
     */
    static plugin: Plugin;

    /**
     * In ms
     */
    static runInRegularInterval?: number

    static maxInterval = 30 * 60 * 1000

    /**
     * To be nice and not consume too much cpu, we specify to what fraction of the time this should be throttled
     * I.e. 0.001 means, if consumes max. 0.1% cpu (or other resources) of the host/client.
     * Overrules {@link runInRegularInterval} but not  {@link maxInterval}
     * @see niceFactor
     */
    static maxTimeFraction = 0.001;

    /**
     * Like {@link maxTimeFraction} but for, when a watched object was changed
     */
    static maxTimeFraction_forTriggeredEvents = 0.05;

    /**
     * The higher the value, the nicer and less priority does it take over other tasks
     */
    static niceFactor = 1;


    static runForEach: ClassOf<ModelBase>;

    static producesNotifications: (typeof Notification)[]

    static tasksForItems = new WeakMap<ModelBase, DiagnosisTask<any>>()



    /**
     * To prevent triggering too much or to give it some time (i.e. till the config file writes are settled)
     */
    static minDelayWhenTriggered = 0;

    /**
     *
     */
    static initialEstimatedDuration: number = undefined as any as number;

    _itemRef: WeakRef<M>

    diag_lastError?: Error;
    static diag_lastErroredTask?: DiagnosisTask<any>;

    _currentRun?: {
        startTime: number;
        /**
         * Re-run needed because the model has changed while running
         */
        needsRerun?: boolean;
    }

    /**
     * In ms
     */
    _lastRunDuration?: number;

    get item(): M | undefined {
        return this._itemRef.deref();
    }

    constructor(item: M) {
        this._itemRef = new WeakRef(item);

        if(objectIsDestroyed(item)) {
            return;
        }

        this.scheduleForNow(); // The scheduler will then also schedule it for later after the first run
    }

    static _createAndScheduleTask(item: ModelBase) {
        if(objectIsDestroyed(item)) {
            return;
        }

        //@ts-ignore
        const taskInstance = new this(item);
    }

    get isRunning() {
        return !!this._currentRun
    }

    get estimatedDuration(): number {
        if(this._currentRun) {
            const currentDuration = performance.now() - this._currentRun.startTime;
            return Math.max(currentDuration, this._lastRunDuration || this.clazz.initialEstimatedDuration || 0);
        }
        else {
            return this._lastRunDuration || this.clazz.initialEstimatedDuration || 0
        }
    }

    get _scheduler() {
        return getElectrifiedApp().diagnosisTaskScheduler;
    }

    static validate() {
        this.plugin || throwError(`You must specify the plugin field`);
        this.runForEach || throwError(`You must specify the runForEach field`);
        //@ts-ignore
        if(!(isSubclassOf(this.runForEach, ModelBase))) {
            throwError(`The (runForEach-) class ${this.runForEach.name || this.runForEach} is not supported`);
        }
        this.producesNotifications || throwError(`You must specify the producesNotifications field`);
    }


    /**
     * Registers it in the application
     */
    static registerInApp() {
        this.validate();
        getElectrifiedApp().diagnosisTasksClasses.add(this);
    }

    /**
     * While running, make
     * @see watched. You should watch the item or other objects while running to automatically trigger a re-run
     * @param item
     */
    abstract run(item: M): Promise<void>;

    _cleanUp() {
        this._cleanUpBeforeNextRun();
    }

    _cleanUpBeforeNextRunFns: (() => void)[] = [];
    _cleanUpBeforeNextRun() {
        this._cleanUpBeforeNextRunFns.forEach(f => f());
    }

    _runtime_proxyFacade?: WatchedProxyFacade;

    /**
     * User this.watched(obj) to get a proxy of any object that watches for any deep changes and triggers another run
     * Also make sure to not write into these proxied objects to prevent an endless triggering of this task.
     * @param obj
     */
    watched<T extends object>(obj: T): T {
        this._runtime_proxyFacade || throwError(`Cannot use watched while this task is not running. Has the run(...) method finished in the meanwhile and you're calling from an async fork`)
        return this._runtime_proxyFacade!.getProxyFor(obj);
    }

    async _runOnce() {
        if(this._currentRun) {
            return; // Prevent running twice in parralel
        }

        this._cleanUpBeforeNextRun();

        const item = this.item;
        if(!item || objectIsDestroyed(item)) { // Item was garbage collected or destroyed in the meanwhile ?
            this._cleanUp();
            return;
        }

        // Create facade that watches all reads and triggers the rerun:
        const facade = this._runtime_proxyFacade = new WatchedProxyFacade();
        const readListener = (read: RecordedRead) => {
            // Subscribe / unsubscribe to when something changes:
            read.onAfterChange(this._handleModelChangedFn,true);
            this._cleanUpBeforeNextRunFns.push(() => read.offAfterChange(this._handleModelChangedFn))
        };
        facade.onAfterRead(readListener);

        try {
            this._currentRun = {
                startTime: performance.now()
            }

            await this.run(item);
            this.diag_lastError = undefined;
        }
        catch (e) {
            this.diag_lastError = toError(e);
            this.clazz.diag_lastErroredTask = this;
            throw e;
        }
        finally {
            this._currentRun || throwError("Illegal state. Is run running twice in parrallel?")
            this._lastRunDuration = performance.now() - this._currentRun!.startTime;
            if(this._currentRun!.needsRerun) {
                this.scheduleForNow();
            }
            this._currentRun = undefined;
            facade.offAfterRead(readListener)
            this._runtime_proxyFacade = undefined;
        }

        if(!this.clazz.initialEstimatedDuration) {
            throwError(`The static field initialEstimatedDuration was not specified in your DiagnosisTask. You can use the following value / this run was benchmarked to initialEstimatedDuration=${this._lastRunDuration}`)
        }
    }

    _handleModelChanged() {
        if(this._currentRun) {
            this._currentRun.needsRerun = true; // This will schedule it after the run
        }
        else {
            this._cleanUpBeforeNextRun(); // Now that we
            this.scheduleForNow();
        }
    }
    _handleModelChangedFn = this._handleModelChanged.bind(this);

    /**
     * Schedules the next run for now / asap. According to estimatedDuration, nice factor and the other tasks this can be delayed a bit
     */
    scheduleForNow() {
        let delay = this.estimatedDuration / this.clazz.maxTimeFraction_forTriggeredEvents
        if(getElectrifiedApp().debug) {
            delay = Math.min(2000, delay); // This prevents accidentially increasing measured last duration because hanging in the debugger
        }
        if(!this._lastRunDuration) { // Task is running the first time ?
            delay = Math.random() * delay; // We could immediately start but let's rather smooth the task-run room by randomizing
        }
        this._scheduler.scheduleTask(new Schedule(performance.now() + Math.max(delay, this.clazz.minDelayWhenTriggered), delay * this.clazz.niceFactor), this);
    }

    /**
     * Schedules in the configured interval
     */
    scheduleRegularly() {
        const item = this.item;
        if(!item || objectIsDestroyed(item)) { // Item was garbage collected or destroyed in the meanwhile ?
            this._cleanUp();
            return;
        }

        if(this.clazz.runInRegularInterval) {
            const delay = Math.min(this.clazz.maxInterval, Math.max(this.clazz.runInRegularInterval, this.estimatedDuration / this.clazz.maxTimeFraction))
            this._scheduler.scheduleTask(new Schedule(performance.now() + delay, delay * this.clazz.niceFactor), this);
        }
    }

    get clazz() {
        return this.constructor as typeof DiagnosisTask;
    }
}

let idGen = 1;

/**
 * Comparabe specification when and how nice we want to start the next run
 */
class Schedule {
    id = idGen++;

    /**
     * Ideal
     */
    idealStartTime: number

    /**
     * How much can we delay it?
     */
    priorityDelay: number


    constructor(idealStartTime: number, priorityDelay: number) {
        this.idealStartTime = idealStartTime;
        this.priorityDelay = priorityDelay;
    }
}


export class DiagnosisTaskScheduler {
    tasks = createRBTree<Schedule, DiagnosisTask<any>>(DiagnosisTaskScheduler.compare) // This lib provides a sortable data structure (in place / without re-sorting the whole thing each time)
    task2schedule = new WeakMap<DiagnosisTask<any>, Schedule>();
    processNextTimer?: any;

    /**
     * Which task should be run first ?
     * @param a
     * @param b
     */
    static compare(a: Schedule, b: Schedule): number {
        const result = (a.idealStartTime + a.priorityDelay) - (b.idealStartTime + b.priorityDelay);
        if(result === 0) {
            return a.id - b.id; // Different instances must never return 0
        }
        return result
    }

    processNext() {
        const now = performance.now();

        const retryLater = (delay: number)=> {
            clearTimeout(this.processNextTimer); // Clear any other timers
            this.processNextTimer = setTimeout(() => this.processNext(), delay);
        }

        // Fetch first entries from the tasks list:
        const iterator = this.tasks.begin;
        const mostUrgendSchedule = iterator.key
        const mostUrgentTask = iterator.value
        if(!(mostUrgendSchedule && mostUrgentTask)) { // Task list is empty?
            return;
        }

        if(mostUrgendSchedule.idealStartTime > now) { // Not yet ready to start?
            retryLater(mostUrgendSchedule.idealStartTime - now);
            return;
        }

        // Run task and process next:
        this.tasks = this.tasks.remove(mostUrgendSchedule);
        spawnAsync(async () => {
            try {
                await mostUrgentTask._runOnce();
            }
            catch (e) {
                console.error(toError(e));
            }
            finally {
                mostUrgentTask.scheduleRegularly(); // Re-schedule (if it has an interval)
            }

            this.processNext();
        }, false)

    }

    scheduleTask(schedule: Schedule, task: DiagnosisTask<any>) {
        const existingSchedule = this.task2schedule.get(task);
        if(existingSchedule) {
            this.tasks = this.tasks.remove(existingSchedule); // Don't let the task be scheduled twice
        }

        this.task2schedule.set(task, schedule);
        this.tasks = this.tasks.insert(schedule, task);
        getElectrifiedApp().initializedAndLoggedOnPromise.then( // Wait till ...
            () => this.processNext()
        );
    }
}