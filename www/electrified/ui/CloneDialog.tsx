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
                {state.snapshot.hasPendingChanges && <div style={{textAlign: "right"}}>&#160;<Icon icon={"issue"}/> {t`The guest has pending hardware changes. These will not be taken into the clone. Please stop the guest first, to apply them.`}</div>}
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
    await param_origGuest.clone(result, true);
}

//@ts-ignore
var Ext = window.Ext;
//@ts-ignore
var PVE = window.PVE;
//@ts-ignore
var Proxmox = window.Proxmox;