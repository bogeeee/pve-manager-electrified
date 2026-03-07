import {ContextMenuItem, Plugin} from "./Plugin"
import React, {CSSProperties, ReactNode} from "react";
import {bind, binding, useWatchedState, watched} from "react-deepwatch"
import {Button, ButtonGroup, Classes, Icon, InputGroup, Intent, NumericInput, Popover, Slider} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {t} from "./globals";
import "./styles.css"
import {Guest} from "./model/Guest";
import {Node} from "./model/Node";
import {
    HoverTooltip,
    newDefaultMap,
    ObjectHTMLSelect, RememberChoiceButton,
    showBlueprintDialog,
    showMuiDialog,
    throwError, toError
} from "./util/util";
import _ from "underscore";
import {Pool} from "./model/Pool";
import {Storage} from "./model/Storage"
import {ElectrifiedJsonConfig} from "pveme-nodejsserver/Common";
import {DialogActions, DialogContent, DialogContentText} from "@mui/material";
import {retsync2promise} from "proxy-facades/retsync";

/**
 * Offers nice features.
 * This internal Plugin is always loaded. It's just like a user plugin. Every feature that electrified wants to offer and which can be delivered by a plugin, (i.e. CPU usage Column in the tree) is done through here
 */
export class ElectrifiedFeaturesPlugin extends Plugin {

    static packageName = "pveme-ui-plugin-electrified-features"

    needsAdminPermissions = false;

    /**
     * For animations. Gets updated every 250ms.
     */
    timeForComponentAnimations = new Date().getTime();

    /**
     * User-wide configuration for this plugin.
     * Will be stored in the browser's localstorage under the key plugin_[plugin name]_config.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications to the localstorage entry (i.e. by other browser tabs) are updated to this field.
     *
     * Because this field may be updated to a new object instance (on external config change), make sure to to not **hold* references to sub-objects over a long time. I.e. <WRONG>const myLongTermConst = this.userConfig.treeColumnConfigs;</WRONG>
     */
    userConfig = {
        cpuBars: {
            /**
             * Shows the total / grayed out background bars
             */
            showBackground: {
                datacenter: true,
                pool: true,
                node: true,
                guest: true,
            },

            width: 4
        },

        fastClone: {
            start: false,
            randomizeMacAddresses: true,
            randomizeVmGenId: true,
        }
    }

    /**
     * Node wide configuration for this plugin.
     * Will be stored under /etc/pve/local/manager/plugins/[plugin name].json.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications on disk are immediately updated to this field.
     *
     * Because this field may be updated to a new object instance (on external config change), make sure to to not **hold* references to sub-objects over a long time. I.e. <WRONG>const myLongTermConst = this.nodeConfig.treeColumnConfigs;</WRONG>
     */
    nodeConfig: ElectrifiedJsonConfig = {
        plugins: [],
    }

    /**
     * Datacenter-/cluster wide configuration for this plugin.
     * Will be stored under /etc/pve/manager/plugins/[plugin name].json.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications on disk are immediately updated to this field.
     * Accessing this field may throw an error, if the cluster is currently out-of-sync.
     *
     * Because this field may be updated to a new object instance (on external config change), make sure to to not **hold* references to sub-objects over a long time. I.e. <WRONG>const myLongTermConst = this.datacenterConfig.treeColumnConfigs;</WRONG>
     */
    datacenterConfig = {

    }

    /**
     * Initializes this plugin. Prefer this point, instead of the constructor.
     * At this point of the time, a user is logged in.
     * The xxxConfig fields have already been initialized at this time.
     * @see onUiReady
     */
    async init() {
        // Set default values when a config from an old version was used:
        this.userConfig.cpuBars.width ||=  4;

        setInterval(() => this.timeForComponentAnimations = new Date().getTime(), 250);
    }

    async onUiReady() {
    }


    getResourceTreeColumns() {
        const thisPlugin = this;

        const getOpacity = (electrifiedStats?: Node["electrifiedStats"] | Guest["electrifiedStats"]) => {
            if(!electrifiedStats?.currentCpuUsage) {
                return 0;
            }
            watched(this).timeForComponentAnimations; const now = new Date().getTime() // Access timer only to force regular refresh.
            const ageTimeStamp = electrifiedStats.clientTimestamp - electrifiedStats.currentCpuUsage.ageMs;
            const ageInSeconds = ((now - ageTimeStamp) / 1000) - 2; // -1 = fluctuations the first second window should be still at full opacity. Otherwise it flickers too much
            return Math.min(1, 1 / Math.pow(2, ageInSeconds / 4)); // Half the opacity after 4 seconds
        }

        function getIconClass(type: string) {
            return (window as any).PVE.tree.ResourceTree.typeDefaults[type]?.iconCls || throwError("No icon for " + type);
        }

        return [
            // CPU bars:
            {
                text: t`CPU bars`,
                key: "cpu_bars",
                cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {
                    function getSummedUpBars(nodes2guests: Map<Node, Set<Guest>>, showUnusedBackground: boolean) {
                        const layers: Layer[] = [];
                        let nodes = [...nodes2guests.keys()];
                        let allGuests = [...nodes2guests.keys()].map(k => [...nodes2guests.get(k)!.values()]).flat();
                        //nodes = [...nodes, ...nodes]; allGuests = [...allGuests, ...allGuests]; // Debug: double entries

                        if(showUnusedBackground){
                            // Stack up unused cores / background:
                            let current = 0;
                            for(const node of nodes) {
                                const opacity = getOpacity(node.electrifiedStats)
                                layers.push({
                                    start: current,
                                    end: current+= node.maxcpu,
                                    cssClass: "cpu-bar-unused",
                                    css: {
                                        opacity
                                    }
                                });
                            }
                        }

                        {
                            // stack up host cpu usages:
                            let current = 0;
                            const nodesStats = nodes.filter(g => g.electrifiedStats?.currentCpuUsage?.value).map(node => {
                                return node.electrifiedStats!
                            });
                            nodesStats.sort((a, b) => getOpacity(b) - getOpacity(a)); // Sort by opacity
                            for(const stats of nodesStats) {
                                const opacity = getOpacity(stats);
                                layers.push({
                                    start: current,
                                    end: current+=stats.currentCpuUsage!.value,
                                    cssClass: "cpu-bar-host",
                                    css: {
                                        opacity
                                    }
                                });
                            }
                        }

                        // Stack up the guest cpu as layers:
                        {
                            const guestsStats = allGuests.filter(g => g.electrifiedStats?.currentCpuUsage?.value).map(guest => {
                                return guest.electrifiedStats!
                            });
                            guestsStats.sort((a, b) => getOpacity(b) - getOpacity(a)); // Sort by opacity
                            let current = 0;
                            for (const electrifiedStats of guestsStats) {
                                const opacity = getOpacity(electrifiedStats);
                                if (opacity > 0) {
                                    layers.push({
                                        start: current,
                                        end: current+= electrifiedStats.currentCpuUsage!.value,
                                        cssClass: "cpu-bar-cpu",
                                        css: {
                                            opacity
                                        }

                                    });
                                }
                            }
                        }

                        return <div className="cpu-bars-container">{getBars(layers)}</div>;
                    }
                    function getSummedUpBarsForPool(pool: Pool) {
                        const layers: Layer[] = [];
                        let nodeInfo = newDefaultMap<Node, {guestCores: number}>((n) => {return {guestCores: 0}})
                        for(const guest of pool.guests) {
                            const info = nodeInfo.get(guest.node);
                            info.guestCores+=guest.maxcpu;
                        }

                        if(thisPlugin.userConfig.cpuBars.showBackground.pool){
                            // Stack up unused cores / background:
                            let current = 0;
                            for(const node of nodeInfo.keys()) {
                                const opacity = getOpacity(node.electrifiedStats)
                                const maxUsableCpuForNode = Math.min(node.maxcpu, nodeInfo.get(node).guestCores);
                                layers.push({
                                    start: current,
                                    end: current+= maxUsableCpuForNode,
                                    cssClass: "cpu-bar-unused",
                                    css: {
                                        opacity
                                    }
                                });
                            }
                        }

                        // Stack up the guest cpu as layers:
                        {
                            const guestsStats = pool.guests.filter(g => g.electrifiedStats?.currentCpuUsage?.value).map(guest => {
                                return guest.electrifiedStats!
                            });
                            guestsStats.sort((a, b) => getOpacity(b) - getOpacity(a)); // Sort by opacity
                            let current = 0;
                            for (const electrifiedStats of guestsStats) {
                                const opacity = getOpacity(electrifiedStats);
                                if (opacity > 0) {
                                    layers.push({
                                        start: current,
                                        end: current+= electrifiedStats.currentCpuUsage!.value,
                                        cssClass: "cpu-bar-cpu",
                                        css: {
                                            opacity
                                        }

                                    });
                                }
                            }
                        }

                        return <div className="cpu-bars-container">{getBars(layers)}</div>;
                    }


                    const item = props.item;
                    if (item instanceof this.app.classes.model.Guest) {
                        if(item.electrifiedStats?.currentCpuUsage) {
                            const layers: Layer[] = [];
                            // Unused / background:
                            if(thisPlugin.userConfig.cpuBars.showBackground.guest) {
                                layers.push({
                                    start: 0,
                                    end: item.maxcpu,
                                    cssClass: "cpu-bar-unused",
                                });
                            }
                            // Cpu:
                            layers.push({
                                start: 0,
                                end: item.electrifiedStats.currentCpuUsage.value,
                                cssClass: "cpu-bar-cpu",
                            });
                            return <div style={{opacity: getOpacity(item.electrifiedStats)}} className="cpu-bars-container">{getBars(layers)}</div>
                        }
                    } else if(item instanceof this.app.classes.model.Node) {
                        const node = item;
                        return getSummedUpBars(new Map([[node, new Set(node.guests)]]), thisPlugin.userConfig.cpuBars.showBackground.node)
                    } else if(item instanceof this.app.classes.model.Datacenter) {
                        const node2guests = new Map(item.nodes.map(node => [node, new Set(node.guests)]));
                        //const node2guests = new Map([[watched(this.app.currentNode), new Set(watched(this.app.currentNode).guests)]]); // debug: only use current node
                        return getSummedUpBars(node2guests, thisPlugin.userConfig.cpuBars.showBackground.datacenter)
                    }
                    else if (item instanceof this.app.classes.model.Pool) {
                        return getSummedUpBarsForPool(item);
                    }
                    else {
                        return undefined;
                    }
                    type Layer = {start: number, end: number, cssClass: string, css?: CSSProperties};
                    function getBars(layers: Layer[]) {
                        //
                        function squeezeLayers(layers: Layer[]) {
                            const result: Layer[] = [];
                            for(let i = 0;i<layers.length;i++) {
                                if(i === 0) {
                                    result.push(layers[i]);
                                    continue;
                                }

                                const layer = layers[i];
                                const lastLayer = result[result.length -1];
                                if(_.isEqual(lastLayer, {...layer, start:lastLayer.start, end: layer.start})) { // can be squeezed to lastLayer?
                                    lastLayer.end = layer.end;
                                }
                                else {
                                    result.push(layer)
                                }
                            }
                            return result;
                        }
                        layers = squeezeLayers(layers);


                        const result: ReactNode[] = [];
                        const maxHeight = 15;

                        /**
                         * Note: Converting to pixels rather than using % prevents quirky rendering by the browser (
                         * @param value between 0 and 1;
                         */
                        function toBarPixels(value: number) {
                            value*=maxHeight;
                            value = Math.round(value);
                            // Make sure, it is in range
                            Math.max(0, value);
                            Math.min(maxHeight, value);
                            return value;
                        }
                        const max = Math.ceil(layers.reduce((max,current) => Math.max(max, current.end),0));
                        let layerKey =0;
                        for(let barIndex = 0;barIndex<max;barIndex++) {
                            result.push(<div key={barIndex} className="cpu-bar" style={{width: thisPlugin.userConfig.cpuBars.width, minWidth: thisPlugin.userConfig.cpuBars.width}}>{layers.map(layer => {
                                if(!(layer.start <= barIndex+1 && layer.end > barIndex)) { // layer outside range?
                                    return;
                                }
                                let relativeStart = Math.max(0, layer.start - barIndex) * maxHeight;
                                let relativeEnd = Math.min(1, layer.end - barIndex);
                                return <div key={layerKey++} className={layer.cssClass} style={{position: "absolute", width: "100%", bottom: `${toBarPixels(relativeStart)}px`, height: `${toBarPixels(relativeEnd - relativeStart)}px`, ...(layer.css || {})}}/>
                            })}</div>)
                        }

                        return result;
                    }
                },
                showConfig() {
                    const result = showMuiDialog(t`CPU bar configuration`, {}, (props) => {
                        const plugin = watched(thisPlugin);
                        return <React.Fragment>
                            <DialogContent>
                                <DialogContentText>
                                    {t`Show unused cpu background bars for`}:<br/>
                                    {[{key: "datacenter", text: t`Datacenter`}, {key: "pool", text: t`Pools`}, {key: "node", text: t`Nodes`}, {key: "guest", text: t`Guests`}].map(item =>
                                        <div>&#160;<input type="checkbox" {...bind((plugin.userConfig.cpuBars.showBackground as any)[item.key])} /> {item.text}</div>
                                    )}

                                    <br/>{t`Bar width`}:
                                    <Slider {...bind(plugin.userConfig.cpuBars.width)} min={1} max={8} stepSize={1}/>


                                </DialogContentText>
                            </DialogContent>
                            <DialogActions>
                                <Button type="submit" onClick={() => props.resolve(true)} >{t`Close`}</Button>
                            </DialogActions>
                        </React.Fragment>
                    });
                },
            },
            // CPU:
            {
                text: t`Host CPU usage`,
                key: "cpu_text",
                hidden: true,
                cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {
                    /**
                     * @returns Cpu formatted to a fixed width + the core symbol
                     */
                    function formatCpu(cpu: number, showUnit = true) {
                        cpu = Math.max(0, cpu);
                        const intDigits = Math.max(1, String(Math.round(cpu)).length);
                        const fractiondigits = Math.max(0, 3 - intDigits);
                        let formattedNumber = new Intl.NumberFormat(undefined, {minimumIntegerDigits: 1, minimumFractionDigits:  fractiondigits, maximumFractionDigits:fractiondigits}).format(cpu).trim();
                        // TODO: use monopaced font, that does not look ugly like style={{fontFamily: "'Cascadia Code', Consolas, 'Courier New', Courier, monospace"}}. I.e. https://github.com/weiweihuanghuang/fragment-mono
                        return <span>{formattedNumber}{intDigits === 3?<span style={{visibility: "hidden"}}>.</span>:undefined}{showUnit?<span className="fa fa-fw pmx-itype-icon-processor pmx-icon"/>:undefined}</span>;
                    }
                    function getGuestAndHostSummary(nodes2guests: Map<Node, Set<Guest>>) {
                        let nodes = [...nodes2guests.keys()];
                        let allGuests = [...nodes2guests.keys()].map(k => [...nodes2guests.get(k)!.values()]).flat();
                        //nodes = [...nodes, ...nodes]; allGuests = [...allGuests, ...allGuests]; // Debug: double entries

                        // Compute nodesOpacity and nodesCpuUsage:
                        let nodesOpacity = 1;
                        let nodesCpuUsage = 0;
                        for(const node of nodes) {
                            nodesOpacity = Math.min(nodesOpacity, getOpacity(node.electrifiedStats));
                            if(nodesOpacity <= 0 || node.electrifiedStats?.currentCpuUsage === undefined) {
                                break;
                            }
                            nodesCpuUsage+= node.electrifiedStats.currentCpuUsage.value;
                        }
                        
                        // Compute guestsOpacity and guestsCpuUsage:
                        let guestsOpacity = 1;
                        let guestsCpuUsage = 0;
                        for(const guest of allGuests) {
                            if(!guest.electrifiedStats) {
                                continue;
                            }
                            guestsOpacity = Math.min(guestsOpacity, getOpacity(guest.electrifiedStats));
                            if(guestsOpacity <= 0 || guest.electrifiedStats.currentCpuUsage === undefined) {
                                break;
                            }
                            guestsCpuUsage+= guest.electrifiedStats.currentCpuUsage.value;
                        }

                        const smallSpace = <div style={{display: "inline-block", width:"2px"}} />

                        return (nodesOpacity > 0 && guestsOpacity > 0) ?
                            <span style={{opacity: guestsOpacity}}>
                                {formatCpu(guestsCpuUsage, false)}{smallSpace}<span className={`fa fa-fw ${getIconClass("qemu")}`} style={{width: "10px"}}/><span className={`fa fa-fw ${getIconClass("lxc")}`}/>
                                &#160;&#160;+&#160;&#160;
                                {formatCpu(nodesCpuUsage - guestsCpuUsage, false)}{smallSpace}<span className={`fa fa-fw ${getIconClass("node")}`}/>
                            </span>
                            :
                            <span style={{opacity: nodesOpacity}}>
                                {formatCpu(nodesCpuUsage)}
                            </span>
                    }
                    function getGuestAndHostSummaryForPool(pool: Pool) {
                        // Compute opacity and cpuUsage:
                        let opacity = 1;
                        let cpuUsage = 0;
                        for(const guest of pool.guests) {
                            if(!guest.electrifiedStats) {
                                continue;
                            }
                            opacity = Math.min(opacity, getOpacity(guest.electrifiedStats));
                            if(opacity <= 0 || guest.electrifiedStats.currentCpuUsage === undefined) {
                                break;
                            }
                            cpuUsage+= guest.electrifiedStats.currentCpuUsage.value;
                        }

                        return <span style={{opacity: opacity}}>{formatCpu(cpuUsage)}</span>
                    }

                    const item = props.item;
                    if(item instanceof this.app.classes.model.Node) {
                        const node = item;
                        return getGuestAndHostSummary(new Map([[node, new Set(node.guests)]]))
                    }
                    else if(item instanceof this.app.classes.model.Pool) {
                        return getGuestAndHostSummaryForPool(item);
                    }
                    else if(item instanceof this.app.classes.model.Datacenter) {
                        const node2guests = new Map(item.nodes.map(node => [node, new Set(node.guests)]));
                        //const node2guests = new Map([[watched(this.app.currentNode), new Set(watched(this.app.currentNode).guests)]]); // debug: only use current node
                        return getGuestAndHostSummary(node2guests)
                    }
                    else if (item instanceof this.app.classes.model.Guest) {
                        if(item.electrifiedStats?.currentCpuUsage) {
                            return <div style={{opacity: getOpacity(item.electrifiedStats)}}>{formatCpu(item.electrifiedStats.currentCpuUsage.value)}</div>
                        }
                    } else {
                        return undefined;
                    }

                },
            }]
    }

    async showFastCloneDialog(param_origGuest: Guest) {
        const app = this.app;
        const node = param_origGuest.node;

        /**
         * @returns string like "orig_name_2"
         */
        const getInitialSuggestedName = () => {
            const idx2name = (idx: number) => `${param_origGuest.name}-${idx}`;
            let idx = 2;
            while(this.app.datacenter.nodes.some(node => node.guests.some(g => g.name === idx2name(idx)))) {
                idx++;
            }
            return idx2name(idx)
        }

        interface DialogResult {
            targetNode: Node;
            pool: Pool | undefined;
            snapshot: Guest;
            id: number;
            name: string;
            targetStorage: Storage | undefined;
            start: boolean;
            randomizeMacAddresses:boolean;
            randomizeVmGenId:boolean;
            pauseOld:boolean;
            fastClonePossible(): string | boolean;
        }

        const result = await showBlueprintDialog<DialogResult>({title: t`Clone ${param_origGuest.name} (${param_origGuest.id})`, style: {minWidth: "750px"}},(props) => {
            const origGuest = watched(param_origGuest);
            const fastCloneUserConfig = watched(this.userConfig.fastClone);

            const state = useWatchedState(new class implements DialogResult {
                targetNode = origGuest.node;
                pool = origGuest.pool;
                snapshot = origGuest;
                id = app.datacenter.getFreeGuestId(origGuest.id);
                name = getInitialSuggestedName();

                /**
                 * Undefined = same as source
                 */
                targetStorage: Storage | undefined;

                start = fastCloneUserConfig.start !== undefined?fastCloneUserConfig.start:false;
                randomizeMacAddresses = fastCloneUserConfig.randomizeMacAddresses !== undefined?fastCloneUserConfig.randomizeMacAddresses:true;
                randomizeVmGenId = fastCloneUserConfig.randomizeVmGenId !== undefined?fastCloneUserConfig.randomizeVmGenId:true;
                pauseOld = false;

                fastClonePossible() {
                    if (this.targetNode !== origGuest.node) {
                        return t`Different target node.`;
                    }
                    if (this.targetStorage !== undefined) {
                        return t`Can only fast clone when storage ist the same as source.`;
                    }
                    for(const disk of this.snapshot.disks) {
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

            return <div>
                <div className={Classes.DIALOG_BODY} >
                    <table>
                        <tbody>
                            <tr>
                                {/* Target node: */}
                                <td className="electrifiedFormLabel">{t`Target node`}:</td>
                                <td><ObjectHTMLSelect binding={binding(state.targetNode)} items={this.app.datacenter.nodes.map(node => {return {value:node, content: node.name}})} fill={true}/></td>

                                <td className="electrifiedDialogSpacer"/>

                                {/* Snapshot: */}
                                <td className="electrifiedFormLabel">{t`Snapshot`}:</td>
                                <td><ObjectHTMLSelect binding={binding(state.snapshot)} items={[origGuest, ...[...origGuest.snapshotRoot.snapshots.values()].reverse().filter(g => g !== origGuest) /* bring them into the correct order*/].map(snap => {return {value: snap, content: snap.isSnapshot()?snap.snapshotName:t`Current`}})} fill={true} /></td>
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
                            <tr>
                                {/* Randomize mac addresses: */}
                                <td className="electrifiedFormLabel">{t`Randomize MAC address(es)`}:</td>
                                <td><input type="checkbox" {...bind(state.randomizeMacAddresses)}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.randomizeMacAddresses} storageBind={binding(fastCloneUserConfig.randomizeMacAddresses)}/></span></td>

                                <td className="electrifiedDialogSpacer"/>
                                <td className="electrifiedFormLabel"></td>
                                <td></td>

                            </tr>
                            <tr>
                                {/* Randomize vmgenId: */}
                                <td className="electrifiedFormLabel">{t`Randomize VM gen id`}:</td>
                                <td><input type="checkbox" {...bind(state.randomizeVmGenId)}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.randomizeVmGenId} storageBind={binding(fastCloneUserConfig.randomizeVmGenId)}/></span></td>

                                <td className="electrifiedDialogSpacer"/>
                                <td className="electrifiedFormLabel"></td>
                                <td></td>

                            </tr>
                            <tr>
                                {/* Start guest: */}
                                <td className="electrifiedFormLabel"><span className="fa fa-play"/> {t`Start guest`}:</td>
                                <td><input type="checkbox" {...bind(state.start)}/>&#160;<span style={iconFixStyle as any}><RememberChoiceButton currentValue={state.start} storageBind={binding(fastCloneUserConfig.start)}/></span></td>

                                <td className="electrifiedDialogSpacer"/>
                                <td className="electrifiedFormLabel"></td>
                                <td></td>

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

        if(result.fastClonePossible() === true) {
            const rollbackFns: (() => Promise<void>)[] = [];
            const finallyFns: (() => Promise<void>)[] = [];
            try {
                let tempSnapshotName: string | undefined = undefined;
                if(result.snapshot.snapshotName === undefined) {
                    let tempSnapshotName = `temp_for_cloning_${Math.floor(Math.random() * 10000000)}`;
                    const tempSnapshot = await origGuest.createSnapshot(tempSnapshotName, `By PVE-Electrified. Will usually be deleted after cloning. Otherwise report this as a bug`, false);
                    finallyFns.push(async () => await tempSnapshot.deleteSnapshot());
                }

                let clone = await Guest._fromConfig(origGuest.configFile, origGuest.constructor as any); // Construct clone in memory. Like in the Guest#_reReadFromConfig:

                clone = clone.snapshotRoot.snapshots.get(tempSnapshotName || result.snapshot.snapshotName) || throwError(`Object not found for snapshotname: ${result.snapshot.snapshotName}`); // Use the specified snapshot as root

                // Delete all other snapshots:
                clone.snapshotRoot.snapshots = new Map([[undefined, clone]]);
                clone.parentSnapshot = undefined;
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
                    disk.storage && disk.storage?.status === "available" || throwError(`Storage ${disk.storageName} is not available`);
                    if(disk.storage === undefined) throwError("not available");
                    disk.storage.type === "zfspool" || throwError(`Disk ${disk} is not zfs`);

                    const datasetFilePath = await disk.zfsGetDatasetFilePath();
                    const filePathMatch = /^vm-([0-9+])-(.*)$/.exec(datasetFilePath) || throwError(`Dataset file of disk ${disk} has invalid format: ${datasetFilePath}`);
                    const clonedDatasetFilePath = `vm-${clone.id}-${filePathMatch[2]}`;

                }

                // Write config:
                await retsync2promise(() => clone._writeConfig(), {checkSaved: false});
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
                }
            }
        }
        else {
            const params: Record<string, unknown> = {
                newid: result.id
            };

            if (result.snapshot) {
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

            await app.currentNode.api2fetch("POST", '/' + origGuest.type + '/' + origGuest.id + '/clone', params);
        }

        await app.datacenter.ensureUp2Date();
    }

    getGuestMenuItems(guest: Guest): (ContextMenuItem | "menuseparator")[] {
        return [
            "menuseparator",
            // Fast clone
            {
                text: t`Fast clone`,
                iconCls: 'fa fa-fw fa-clone',
                handler: async () => {
                    await this.showFastCloneDialog(guest);
                }
            },
        ]
    }

    get _localStorageConfigKey() {
        return `electrified_config`
    }

    get _nodeConfigFilePath() {
        return `/etc/pve/local/electrified.json`
    }

    get _datacenterConfigFilePath() {
        return `/etc/pve/manager/electrified.json`
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}
let debug_renderCounter = 0;

//@ts-ignore
export var Ext = window.Ext;
//@ts-ignore
export var PVE = window.PVE;
//@ts-ignore
export var Proxmox = window.Proxmox;