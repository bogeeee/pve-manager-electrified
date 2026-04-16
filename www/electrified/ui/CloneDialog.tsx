import React, {CSSProperties} from "react";
import {bind, binding, load, READS_INSIDE_LOADER_FN, useWatchedState, watched} from "react-deepwatch"
import {Button, ButtonGroup, Classes, Icon, InputGroup, Intent, NumericInput} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {getElectrifiedApp, t} from "../globals";
import "../styles.css"
import {Guest} from "../model/Guest";
import {Node} from "../model/Node";
import {
    getUniqueName,
    ObjectHTMLSelect,
    RememberChoiceButton,
    RetryableError,
    retryTilSuccess,
    showBlueprintDialog,
    sleep,
    throwError,
    toError
} from "../util/util";
import {Pool} from "../model/Pool";
import {Storage} from "../model/Storage"
import {retsync2promise} from "proxy-facades/retsync";
import {Qemu} from "../model/Qemu";


export class CloneDialogResult {
    targetNode!: Node;
    pool!: Pool | undefined;
    _snapshot!: Guest;
    id!: number;
    name!: string;
    targetStorage!: Storage | undefined;
    start!: boolean;
    _withRam!: boolean;
    _createInitialSnapshot!: boolean;
    randomizeMacAddresses!:boolean;
    randomizeVmGenId!:boolean;
    pauseOld!:boolean;
    listInBackupJobs!:boolean;

    fastClonePossible() {
        if (this.targetNode !== this.origGuest.node) {
            return t`Different target node.`;
        }
        if (this.targetStorage !== undefined) {
            return t`Can only fast clone when storage ist the same as source.`;
        }
        for(const disk of this._snapshot.disks) {
            if(disk.type === "unused") {
                continue;
            }
            if(disk.media === "cdrom") {
                continue;
            }
            if(!disk.storage) {
                return t`Disk ${disk.type}${disk.index} uses a storage that was not found: ${disk.storageName}.`;
            }
            if(disk.storage.type !== "zfspool") {
                return t`Disk ${disk.type}${disk.index} is not stored on ZFS. Instead: ${disk.storage.type}.`;
            }
        }
        return true;
    }

    get snapshot(): Guest {
        return this._snapshot;
    }

    set snapshot(value: Guest) {
        this._snapshot = value;
    }

    get withRam(): boolean {
        return this._withRam;
    }

    set withRam(value: boolean) {
        this._withRam = value;
    }

    get withRamPossible() {
        if(!this.isOlderSnapshot) {
            return this.origGuest.isRunning();
        }

        const snapshot = this.snapshot;
        return snapshot instanceof Qemu && snapshot.vmstate?.storage?.type === "zfspool";
    }

    get isOlderSnapshot() {
        return this.snapshot !== this.origGuest;
    }

    get createInitialSnapshot(): boolean {
        if(this._withRam && this.withRamPossible) {
            return true;
        }
        return this._createInitialSnapshot;
    }

    set createInitialSnapshot(value: boolean) {
        this._createInitialSnapshot = value;
    }

    get origGuest() {
        return this.snapshot.liveGuest;
    }

    /**
     * @returns string Initial value for the name field, like "orig_name-2"
     */
    getSuggestedName() {
        const exists = (name: string) => getElectrifiedApp().datacenter.nodes.some(node => node.guests.some(g => g.name === name))
        let startName = this.origGuest.name;
        const idx2name = (idx: number) => `${startName}-${idx}`;
        if(this.snapshot.isSnapshot()) {
            startName = `${this.origGuest.name}-${this.snapshot.snapshotName}`
            if(!exists(startName)) {
                return startName;
            }
        }

        let idx = 2;
        while(exists(idx2name(idx))) {
            idx++;
        }
        return idx2name(idx)
    }
}

export async function showCloneDialog(param_source: Guest) {
    const param_origGuest = param_source.liveGuest; // TODO: Remove redundant const / clarify the name.

    const app = getElectrifiedApp();
    const node = param_origGuest.node;

    const backupJobs = (await app.datacenter._getBackupJobs());
    const affectedIncludeBackupJobs = backupJobs.filter(b => b.includedGuests.some(g => g === param_origGuest));
    const affectedExcludeBackupJobs = backupJobs.filter(b => b.excludedGuests.some(g => g === param_origGuest));



    const result = await showBlueprintDialog<CloneDialogResult>({title: t`Clone ${param_origGuest.name} (${param_origGuest.id})`, style: {minWidth: "750px"}},(props) => {
        const origGuest = watched(param_origGuest);
        const fastCloneUserConfig = watched(app.userConfig.fastClone);

        const state = useWatchedState(new class extends CloneDialogResult {
            targetNode = origGuest.node;
            pool = origGuest.pool;
            _snapshot = watched(param_source);
            id = app.datacenter.getFreeGuestId(origGuest.id);

            /**
             * Undefined = same as source
             */
            targetStorage: Storage | undefined;
            _createInitialSnapshot = fastCloneUserConfig.createInitialSnapshot !== undefined?fastCloneUserConfig.createInitialSnapshot:false;
            randomizeMacAddresses = fastCloneUserConfig.randomizeMacAddresses !== undefined?fastCloneUserConfig.randomizeMacAddresses:true;
            randomizeVmGenId = fastCloneUserConfig.randomizeVmGenId !== undefined?fastCloneUserConfig.randomizeVmGenId:true;
            pauseOld = false;
            listInBackupJobs = (affectedExcludeBackupJobs.length > 0 || affectedIncludeBackupJobs.length > 0) && fastCloneUserConfig.listInBackupJobs !== undefined?fastCloneUserConfig.listInBackupJobs:true;

            constructor() {
                super();
                this.withRam = this.withRamPossible && (origGuest instanceof Qemu?(fastCloneUserConfig.withRam_forCurrent !== undefined?fastCloneUserConfig.withRam_forCurrent:false):false);
                this.name = this.getSuggestedName();
            }

            get snapshot(): Guest {
                return this._snapshot;
            }

            set snapshot(value: Guest) {
                const nameFieldWasChangedByUser = this.getSuggestedName() !== this.name;

                if(this.snapshot === origGuest && value !== origGuest) { // Flank to older snapshot?
                    this._withRam = fastCloneUserConfig.withRam_forOlderSnapshots;
                }
                else if(this.snapshot !== origGuest && value === origGuest) { // Flank to current?
                    this._withRam = this.origGuest.isRunning() && fastCloneUserConfig.withRam_forCurrent;
                }
                this._snapshot = value;

                if(!nameFieldWasChangedByUser) {
                    this.name = this.getSuggestedName();
                }

            }

            get withRam(): boolean {
                return this._withRam;
            }

            set withRam(value: boolean) {
                const hasChanged = this._withRam !== value;
                this._withRam = value;

                if(hasChanged) {
                    this.start = this.withRam?(fastCloneUserConfig.start_withRam !== undefined?fastCloneUserConfig.start_withRam:true):(fastCloneUserConfig.start !== undefined?fastCloneUserConfig.start:false);
                }
            }
        });

        function isValid() {
            if(app.datacenter.getGuest(state.id)) {
                return false;
            }
            if(!state.name.match(Proxmox.Utils.DnsName_match)) {
                return false;
            }
            return true;
        }

        const iconFixStyle = {position: "relative", top: "-2px"}
        const cellStyle: CSSProperties = {verticalAlign: "top"}

        return <div>
            <div className={Classes.DIALOG_BODY} >
                <table>
                    <tbody>
                    <tr>
                        {/* Target node: */}
                        <td className="electrifiedFormLabel">{t`Target node`}:</td>
                        <td><ObjectHTMLSelect binding={binding(state.targetNode)} items={app.datacenter.nodes.map(node => {return {value:node, content: node.name}})} fill={true}/></td>

                        <td className="electrifiedDialogSpacer"/>

                        {/* Snapshot: */}
                        <td className="electrifiedFormLabel">{t`Snapshot`}:</td>
                        <td><ObjectHTMLSelect binding={binding(state.snapshot)} items={[...load(() => origGuest.snapshotRoot.getSnapshotsSorted(),{preserve: false, deps: [READS_INSIDE_LOADER_FN], fallback: []})].reverse().map(snap => {return {value: snap, content: snap.isSnapshot()?snap.snapshotName:t`Current`}})} fill={true} /></td>
                    </tr>
                    <tr>
                        {/* Guest Id: */}
                        <td className="electrifiedFormLabel">{t`Guest ID`}:</td>
                        <td><NumericInput value={state.id} onValueChange={(val) => state.id = val} min={0} max={99999} fill={true}/></td>

                        <td className="electrifiedDialogSpacer"/>

                        {/* Target storage: */}
                        <td className="electrifiedFormLabel">{t`Target storage`}:</td>
                        <td><ObjectHTMLSelect binding={binding(state.targetStorage)} items={[{value: undefined, content: t`Same as source`}, ...app.datacenter.storages.filter(s => s.content.some(c => c === (origGuest.type === "qemu"?"images":"rootdir"))).map(storage => {return {value: storage, content: storage.name}})]} fill={true} /></td>
                    </tr>
                    <tr>
                        {/* Name: */}
                        <td className="electrifiedFormLabel">{t`Name`}:</td>
                        <td colSpan={4}><InputGroup {...bind(state.name)} fill={true}/> </td>


                    </tr>
                    <tr>
                        {/* Resource pool: */}
                        <td className="electrifiedFormLabel">{t`Resource pool`}:</td>
                        <td colSpan={4}><ObjectHTMLSelect binding={binding(state.pool)} items={[{value: undefined, content: t`No pool`}, ...app.datacenter.pools.map(pool => {return {value: pool, content: pool.name}})]} fill={true}/></td>
                    </tr>
                    <tr><td colSpan={99}><hr/></td></tr>
                    </tbody></table>
                <table style={{width: "100%"}}><tbody>
                {origGuest instanceof Qemu &&
                <tr>
                    {/* With RAM: */}
                    <td className="electrifiedFormLabel"><span className="fa pve-itype-icon-memory" style={{width: "14px", height: "8px", position: "relative", left: "-4px"}}/>  {t`With RAM`}:</td>
                    <td style={{...cellStyle, whiteSpace: "nowrap"}}><input type="checkbox" {...bind(state.withRam)} disabled={!state.withRamPossible}/>&#160;<span
                        style={iconFixStyle as any}><RememberChoiceButton
                        currentValue={state.withRam}
                        storageBind={state.isOlderSnapshot?binding(fastCloneUserConfig.withRam_forOlderSnapshots):binding(fastCloneUserConfig.withRam_forCurrent)}
                        tooltip={state.isOlderSnapshot?t`Set as default for this dialog for cloning from an older snapshot`:t`Set as default for this dialog when cloning from **current** state`}
                        disabled={!state.withRamPossible}
                    /></span></td>
                </tr>
                }
                <tr>
                    {/* Take initial snapshot: */}
                    <td className="electrifiedFormLabel"><span className="fa fa-history"/> {t`Take an initial snapshot, named "cloned"`}:</td>
                    <td style={{...cellStyle, whiteSpace: "nowrap"}}><input type="checkbox" {...bind(state.createInitialSnapshot)} disabled={state.withRam && state.withRamPossible}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.createInitialSnapshot} storageBind={binding(fastCloneUserConfig.createInitialSnapshot)} disabled={state.withRam && state.withRamPossible}/></span></td>
                    <td width="100%"></td>
                </tr>
                <tr>
                    {/* Randomize mac addresses: */}
                    <td style={cellStyle} className="electrifiedFormLabel"><span className="fa fa-random"/> {t`Randomize MAC address(es)`}:</td>
                    <td style={{...cellStyle, whiteSpace: "nowrap"}}>
                        <input type="checkbox" {...bind(state.randomizeMacAddresses)}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.randomizeMacAddresses} storageBind={binding(fastCloneUserConfig.randomizeMacAddresses)}/></span>
                    </td>
                    <td style={cellStyle}>
                        {(state.withRamPossible && state.withRam && origGuest.isRunning())&& <div><span className={"fa fa-exclamation-triangle"}/> {t`This won't affect your cloned **running** state, so you might still have address conflicts until you stop and re-start the clone.`}</div>}
                    </td>
                </tr>
                {origGuest.type === "qemu" &&
                <tr>
                    {/* Randomize vmgenId: */}
                    <td className="electrifiedFormLabel"><span className="fa fa-random"/> {t`Randomize VM gen id`}:</td>
                    <td style={{...cellStyle, whiteSpace: "nowrap"}}>
                        <input type="checkbox" {...bind(state.randomizeVmGenId)}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.randomizeVmGenId} storageBind={binding(fastCloneUserConfig.randomizeVmGenId)}/></span>
                    </td>
                </tr>
                }
                <tr>
                    {/* Start guest: */}
                    <td className="electrifiedFormLabel"><span className="fa fa-play"/> {t`Start guest`}:</td>
                    <td style={{...cellStyle, whiteSpace: "nowrap"}}><input type="checkbox" {...bind(state.start)}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.start} storageBind={state.withRam?binding(fastCloneUserConfig.start_withRam):binding(fastCloneUserConfig.start)} tooltip={state.withRam?t`Set as default for this dialog for when cloning **With RAM**`:t`Set as default for this dialog when cloning **without RAM**`}/></span></td>
                </tr>
                <tr>
                    {/* Include in same backups as source */}
                    <td className="electrifiedFormLabel" style={{...cellStyle, maxWidth: "200px"}}><span className="fa fa-save"/> {t`List in same backup jobs as source`}:</td>
                    <td style={{...cellStyle, whiteSpace: "nowrap"}}><input type="checkbox" {...bind(state.listInBackupJobs)} disabled={affectedIncludeBackupJobs.length === 0 && affectedExcludeBackupJobs.length === 0} />&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.listInBackupJobs} storageBind={binding(fastCloneUserConfig.listInBackupJobs)} disabled={affectedIncludeBackupJobs.length === 0 && affectedExcludeBackupJobs.length === 0}/></span></td>
                </tr>
                <tr>
                    <td colSpan={99} className="electrifiedFormLabel" style={{...cellStyle, maxWidth: "200px"}}>
                        <div style={{paddingLeft: "24px", whiteSpace: "initial", position:"relative", top: "-4px"}}><i>
                            {affectedIncludeBackupJobs.length > 0 && <div>{t`${affectedIncludeBackupJobs.length} job(s) list ${origGuest.id}`} for include → <span style={{textDecoration: state.listInBackupJobs?undefined:"line-through"}}>{t`This will add the clone to the include list as well.`}</span></div>}
                            {affectedExcludeBackupJobs.length > 0 && <div>{t`${affectedExcludeBackupJobs.length} job(s) list ${origGuest.id}`} for exclude → <span style={{textDecoration: state.listInBackupJobs?undefined:"line-through"}}>{t`This will add the clone to the exclude list as well.`}</span></div>}
                            {backupJobs.some(b => b.all && !b.excludedGuests.some(g => g.id === origGuest.id)) && <div>{t`${backupJobs.filter(b => b.all && !b.excludedGuests.some(g => g.id === origGuest.id)).length} jobs(s) include all guests (and eventually exclude some irrelevant ones) → No action necessary.`}</div>}
                            {origGuest.pool && origGuest.pool.name === state.pool?.name && backupJobs.some(b => b._hasPool(origGuest.pool)) && <div>{t`${backupJobs.filter(b => b._hasPool(origGuest.pool)).length} job(s) cover the pool: ${origGuest.pool.name} → No action necessary.`}</div>}
                            {origGuest.pool && origGuest.pool.name !== state.pool?.name && backupJobs.some(b => b._hasPool(origGuest.pool)) && <div><span className={"fa fa-exclamation-triangle"}/> {t`${backupJobs.filter(b => b._hasPool(origGuest.pool)).length} job(s) cover the pool: ${origGuest.pool.name} → The clone will not be covered by these job(s). Please check the datacenter backup jobs manually.`}</div>}
                        </i>
                        </div>
                    </td>
                </tr>
                </tbody>
                </table>
                <br/>
                <div style={{textAlign: "right"}}>&#160;{state.fastClonePossible()!==true?<span><Icon icon={"issue"}/> {t`Fast clone not possible:`} {state.fastClonePossible()}</span>:undefined}</div>
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <div style={{alignSelf: "center"}}>
                            <a onClick={() => {props.close(); (window as any).PVE.window.Clone.wrap(origGuest.node.name, origGuest.id, origGuest.name, origGuest.template, origGuest.type)}}>{t`Show classic dialog`}</a>
                        </div>
                        <Button onClick={() => props.resolve(state)} intent={Intent.PRIMARY} disabled={!isValid()}>{state.fastClonePossible() === true?t`Fast clone`:t`Clone`}</Button>
                    </ButtonGroup>
                </div>
            </div>
        </div>;
    });

    if(!result) {
        return;
    }

    app.datacenter.hasQuorum || throwError("Cannot clone. Datacenter has no quorum."); // Check quorum
    const origGuest = param_origGuest;
    const withRam = result.withRamPossible && result.withRam;

    // Exec zfs clone command(s)
    const destroyDataset = async (dataSetOrSnapshot: string) => {
        while (true) {
            try {
                await node.execCommand`zfs destroy ${dataSetOrSnapshot}`;
                return;
            }
            catch (e) {
                if((e as Error)?.message?.indexOf("dataset is busy") >= 0) {
                    await sleep(200);
                    continue; // try again
                }
                throw e;
            }
        }
    }

    const rollbackFns: (() => Promise<void>)[] = [];
    const finallyFns: (() => Promise<void>)[] = [];
    try {
        let sourceSnapshot: Guest = result.snapshot;
        if(result.fastClonePossible() === true) {
            let sourceSnapshotName = result.snapshot.snapshotName;
            if(sourceSnapshotName === undefined) {
                sourceSnapshotName =getUniqueName(`fork_${result.id}_${result.name}`, new Set(origGuest.snapshotRoot.snapshots.keys()), 40);
                sourceSnapshot = await origGuest.createSnapshot(sourceSnapshotName, t`Guest ${result.id} ${result.name} was forked/cloned from here using ZFS cloning (copy-on-write)`, withRam);
                rollbackFns.push(async () => await sourceSnapshot!.deleteSnapshot());
            }

            let clone = await Guest._fromConfig(origGuest.configFile, origGuest.constructor as any); // Construct clone in memory. Like in the Guest#_reReadFromConfig:

            clone = clone.snapshotRoot.snapshots.get(sourceSnapshotName) || throwError(`Object not found for snapshotname: ${sourceSnapshotName}`); // Use the specified snapshot as root

            clone.name = result.name;
            clone.comment = result.snapshot.comment;

            //Make clone the root and delete all other snapshots:
            clone.snapshotName = undefined;
            clone.snapshotRoot.snapshots = new Map([[undefined, clone]]);
            clone._parentSnapshotName = undefined;
            clone.childSnapshots = [];

            // Set id and node like in the Guest#_reReadFromConfig:
            clone._node = origGuest.node;
            clone._id = result.id;
            rollbackFns.push(async () => {clone._id = undefined; clone._node = undefined}); // Clean up possible mess


            // Copy firewall configuration:
            if (await retsync2promise(() => node.getFile(`/etc/pve/firewall/${origGuest.id}.fw`).exists)) {
                await node.execCommand`cp /etc/pve/firewall/${origGuest.id}.fw /etc/pve/firewall/${clone.id}.fw`;
                rollbackFns.push(async () => {await node.execCommand`rm /etc/pve/firewall/${clone.id}.fw`;});
            }

            clone.unused = []; // Remove unused disks

            // ZFS Clone disks
            for(const disk of clone.disks) {
                if(disk.media === "cdrom") {
                    continue;
                }
                if(disk.type === "vmstate") {
                    continue; // Will be handled, see below
                }
                (disk.storage && disk.storage?.status === "available" || disk.storage?.status === "unknown" /* Strange behaviour: despite beeing available, it is reported as unknwon  */) || throwError(`Storage ${disk.storageName} is not available`);
                if(disk.storage === undefined) throwError("not available");
                disk.storage.type === "zfspool" || throwError(`Disk ${disk} is not zfs`);

                const datasetFilePath = await disk.zfsGetDatasetFilePath();
                const filePathMatch = /^(.*)\/(.*)-([0-9]+)-(.*)$/.exec(datasetFilePath) || throwError(`Dataset file of disk ${disk} has invalid format: ${datasetFilePath}`);
                const clonedDatasetFilePath = `${filePathMatch[1]}/${filePathMatch[2]}-${clone.id}-${filePathMatch[4]}`;
                await node.execCommand`zfs clone ${datasetFilePath}@${sourceSnapshotName} ${clonedDatasetFilePath}`
                rollbackFns.push(async () => {
                    while (true) {
                        try {
                            await node.execCommand`zfs destroy ${clonedDatasetFilePath}`;
                            return;
                        }
                        catch (e) {
                            if((e as Error)?.message?.indexOf("dataset is busy") >= 0) {
                                await sleep(200);
                                continue; // try again
                            }
                            throw e;
                        }
                    }
                });
                // Set new file id in config:
                const fileIdMatch = /^(.*)-([0-9]+)-(.*)$/.exec(disk.fileId) || throwError(`FileId of disk ${disk} has invalid format: ${disk.fileId}`);
                disk.fileId = `${fileIdMatch[1]}-${clone.id}-${fileIdMatch[3]}`;
            }

            if(clone instanceof Qemu) {
                await clone._deleteRunningState();
            }

            // Write config:
            await retsync2promise(() => clone._writeConfig(), {checkSaved: false});

            await result.pool?.addGuest(clone); // add to pool
        }
        else {
            const params: Record<string, unknown> = {
                newid: result.id
            };

            if (result.snapshot.isSnapshot()) {
                params.snapname = result.snapshot.snapshotName;
            }

            if (result.pool) {
                params.pool = result.pool.name;
            }

            if (origGuest.type === 'lxc') {
                params.hostname = result.name;
            } else {
                params.name = result.name;
            }

            params.target = result.targetNode.name;
            params.full = 1;
            if(result.targetStorage) {
                params.storage = result.targetStorage.name;
            }

            await(app.currentNode.awaitTask(await node.api2fetch("POST", '/' + origGuest.type + '/' + origGuest.id + '/clone', params) as string));
        }

        // Freshly retrieve clone:
        const clone = await retryTilSuccess(async () => {
            await app.datacenter.ensureUp2Date();
            return app.datacenter.getGuest(result.id) || throwError(new RetryableError("Guest not found after clone"));
        },{maxTime: 30000});

        // Minor: Add rollback fn:
        if(result.fastClonePossible() !== true) {
            rollbackFns.push(async () => await clone.delete());
        }

        if(result.randomizeMacAddresses) {
            clone.net.forEach(networkInterface => networkInterface.randomizeMacAddress())
        }

        if(result.randomizeVmGenId && clone instanceof Qemu) {
            await clone.randomizeVmGenId();
        }

        // Write config:
        await retsync2promise(() => clone._writeConfig(), {checkSaved: false});

        let initialSnapshot: Guest | undefined = undefined;
        if(result.createInitialSnapshot) {
            // Take initial snapshot named "cloned":
            initialSnapshot = await clone.createSnapshot("cloned", t`Cloned from ${origGuest.id} ${origGuest.name}${sourceSnapshot.isSnapshot() ? `@${sourceSnapshot.snapshotName}` : ""}`, false)
            rollbackFns.push(async () => await initialSnapshot!.delete());

            if (withRam) {
                // Copy running state fields:
                const initialSnapshotConfigRecord = initialSnapshot._configRecord;
                for(const key of sourceSnapshot._configRecord.keys()) {
                    if(key.startsWith("running") || key.startsWith("vmstate")) {
                        const value = sourceSnapshot._configRecord.get(key)!;
                        initialSnapshotConfigRecord.set(key, value)
                    }
                }
                await initialSnapshot._applyConfigValues(initialSnapshotConfigRecord); // Re-apply the plain record. this will i.e. initialize the vmstate disk
                await retsync2promise(() => initialSnapshot!._writeConfig(), {checkSaved: false});

                const sourceVmStateDisk = (sourceSnapshot as Qemu).vmstate!;
                const datasetFilePath = await sourceVmStateDisk.zfsGetDatasetFilePath();
                const filePathMatch = /^(.*)\/(.*)-([0-9]+)-state-(.*)$/.exec(datasetFilePath) || throwError(`Dataset file of disk ${sourceVmStateDisk} has invalid format: ${datasetFilePath}`);
                const clonedDatasetFilePath = `${filePathMatch[1]}/${filePathMatch[2]}-${clone.id}-state-cloned`;
                // Create snapshot for cloning:
                const tempSnapshotName = `_forCloning`
                try {
                    await node.execCommand`zfs list ${datasetFilePath}@${tempSnapshotName}`; // Check if snapshot exists. This may be left from a previous clone
                } catch (e) { // Snapshot does not exist?
                    await node.execCommand`zfs snapshot ${datasetFilePath}@${tempSnapshotName}` // Create
                    rollbackFns.push(async () => destroyDataset(`${datasetFilePath}@${tempSnapshotName}`));
                }
                // Clone vmstate volume:
                //finallyFns.push(async () => destroyDataset(`${datasetFilePath}@${tempSnapshotName}`)); // Cannot destroy snapshot //TODO: add it to diagnosis to be able to clean it up later
                await node.execCommand`zfs clone ${datasetFilePath}@${tempSnapshotName} ${clonedDatasetFilePath}`
                rollbackFns.push(async () => destroyDataset(clonedDatasetFilePath));

                const fileIdMatch = /^(.*)-([0-9]+)-state-(.*)$/.exec(sourceVmStateDisk.fileId) || throwError(`FileId of disk ${sourceVmStateDisk} has invalid format: ${sourceVmStateDisk.fileId}`);
                (initialSnapshot as Qemu).vmstate!.fileId = `${fileIdMatch[1]}-${clone.id}-state-cloned`;


            }
            else {
                if(clone instanceof Qemu) {
                    await (initialSnapshot as Qemu)._deleteRunningState();
                }
            }
            await retsync2promise(() => initialSnapshot!._writeConfig(), {checkSaved: false}); // Write config
        }

        await retsync2promise(() => initialSnapshot!._writeConfig(), {checkSaved: false}); // Write config

        // List in backups:
        {
            // Re-retrieve list (to be surely up2date if the dialog took a while):
            const backupJobs = (await app.datacenter._getBackupJobs());
            const affectedIncludeBackupJobs = backupJobs.filter(b => b.includedGuests.some(g => g === param_origGuest));
            const affectedExcludeBackupJobs = backupJobs.filter(b => b.excludedGuests.some(g => g === param_origGuest));

            affectedIncludeBackupJobs.forEach(b => b.updateIncludedGuests([...b.includedGuests, clone]));
            affectedExcludeBackupJobs.forEach(b => b.updateExcludedGuests([...b.excludedGuests, clone]));
        }


        await app.datacenter.ensureUp2Date();
        await app.refreshResourceTree();
        if(result.fastClonePossible() === true) { // Used fast clone / it didn't take long, so we can do jumpy stuff on the screen without disturbing the user?
            app.workspace.down('pveResourceTree').selectById(`${clone.type}/${clone.id}`); // Select clone in tree
        }

        if(result.start) {
            if(withRam) {
                await initialSnapshot!.rollBack(true);
            }
            else {
                await clone.start();
            }
        }
    }
    catch (e) {
        // Roll back everything:
        e = toError(e);
        rollbackFns.reverse();
        for(const fn of rollbackFns) {
            try {
                await fn();
            }
            catch (rollbackError) {
                e.message+= `\n\nThere was also a rollback error: ${toError(rollbackError).message}`;
            }
        }
        if(rollbackFns.length > 0) { e.message+="\n\nClone actions were rolled back after this error."}
        throw e;
    }
    finally {
        // Run finallyFns:
        finallyFns.reverse();
        const errors: Error[] = [];
        for(const fn of finallyFns) {
            try {
                await fn();
            }
            catch (err) {
                errors.push(toError(err));
            }
        }

        if(errors.length > 0) {
            const firstErr = errors[0];
            if(errors.length > 1) {
                firstErr.message+=`\n** more errors by finallyFns: ${errors.slice(1).map(e => e.message).join("; ")}`
            }
            throw firstErr;
        }
    }
}

//@ts-ignore
var Ext = window.Ext;
//@ts-ignore
var PVE = window.PVE;
//@ts-ignore
var Proxmox = window.Proxmox;