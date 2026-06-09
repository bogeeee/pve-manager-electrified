import {ConfigTab, ContextMenuItem, Plugin, TreeColumn} from "./Plugin"
import React, {CSSProperties, ReactNode} from "react";
import {
    bind,
    binding,
    load,
    READS_INSIDE_LOADER_FN,
    useWatchedState,
    ValueOnObject,
    watched,
    watchedComponent
} from "react-deepwatch"
import {
    Button,
    ButtonGroup, Checkbox,
    Classes,
    HTMLSelect,
    Icon,
    InputGroup,
    Intent, Label, Menu, MenuDivider, MenuItem,
    NumericInput,
    Popover, Position,
    Slider, Tooltip
} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {getElectrifiedApp, t} from "./globals";
import "./styles.css"
import {Guest} from "./model/Guest";
import {Node} from "./model/Node";
import {
    formatMem,
    getUniqueName,
    HoverTooltip, LoadingSpinner,
    newDefaultMap,
    ObjectHTMLSelect, RememberChoiceButton, RetryableError, retryTilSuccess,
    showBlueprintDialog,
    showMuiDialog, sleep, SmallErrorIndicator, spawnWithErrorHandling,
    throwError, toError
} from "./util/util";
import _ from "underscore";
import {Pool} from "./model/Pool";
import {Storage} from "./model/Storage"
import {ElectrifiedJsonConfig} from "pveme-nodejsserver/Common";
import {
    DialogActions,
    DialogContent,
    DialogContentText,
    Table, TableBody, TableCell,
    TableContainer,
    TableHead,
    TableRow, TableSortLabel
} from "@mui/material";
import {retsync2promise} from "proxy-facades/retsync";
import {Datacenter, DiagnosisTask} from "./model/Datacenter";
import {UserCapabilities} from "./Application";
import {Notification, NotificationFilter, NotificationSettings} from "./Notification";
import {Qemu} from "./model/Qemu";
import {createValueBarTreeColumn, ValueBarTreeColumnConfig} from "./ui/ReactResourceTree";
import {Record} from "@blueprintjs/icons/lib/esnext/generated/16px/paths";

/**
 * Offers nice features.
 * This internal Plugin is always loaded. It's just like a user plugin. Every feature that electrified wants to offer and which can be delivered by a plugin, (i.e. CPU usage Column in the tree) is done through here
 */
export class ElectrifiedFeaturesPlugin extends Plugin {
    /**
     * Still in development
     */
    static feature_diskSpaceAssistant = false;
    static feature_diskEncriptionDialog = false;

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
    userConfig = new class {
        cpuBars= {
            /**
             * Shows the total / grayed out background bars
             */
            showBackground: {
                datacenter: true,
                pool: true,
                node: true,
                guest: true,
            },

            width: 4,

            styleVariant: "A"
        };

        memBars = new ValueBarTreeColumnConfig();

        resourceTreeCommandButtons = {
            start: true,
            pause: false,
            hibernate: false,
            shutdown: true,
            stop: true,
            reboot: true,
            reset: true,
        };

        fastClone= {
            start: false,
            /**
             * Start when cloning with ram?
             */
            start_withRam:true,
            withRam_forOlderSnapshots: false,
            withRam_forCurrent: false,
            createInitialSnapshot: true,
            randomizeMacAddresses: true,
            randomizeVmGenId: true,
            listInBackupJobs: true,
        }

        notificationSettings: {
            filter: NotificationFilter,
            settings: NotificationSettings
        }[] = [];
        /**
         * Never show notifications as popup.<p>They are still shown in the resource tree and under the "warnings" configuration tab.</p>
         */
        hideNotificationPopups = false;

        startWithResourceConflictOptions = {
            forceStop: false,
            forceStopAfterSeconds: 60,
            alternatingMode: false,
        }

        deleteGuestDialog = {
            purge: false,
            destroyUnreferencedDisks: false,
        }

        shutdownGuestWithoutConfirm = false;
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
        ramHeadroomWhenStartingGuestsInMib: 2000,
        disks: [],
    }

    /**
     * Datacenter-/cluster wide configuration for this plugin.
     * Will be stored under /etc/pve/manager/plugins/[plugin name].json.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications on disk are immediately updated to this field.
     * Accessing this field may throw an error, if the cluster is currently out-of-sync.
     *
     * Because this field may be updated to a new object instance (on external config change), make sure to to not **hold* references to sub-objects over a long time. I.e. <WRONG>const myLongTermConst = this.datacenterConfig.treeColumnConfigs;</WRONG>
     */
    datacenterConfig = new class {
        notificationSettings: {
            filter: NotificationFilter,
            settings: NotificationSettings
        }[] = [];
        /**
         * For, when starting new guests and calculating the available memory:
         * 0 = Only look at guests actual used memory. Ignore the risk that the balloonable memory will grow.
         * 1 = Assume, all running guests take all their balooned memory
         */
        ramHeadroomWhenStartingGuests_balooningRiskFaktor = 0.4;
    }

    async earlyInit(): Promise<void> {
        if(ElectrifiedFeaturesPlugin.feature_diskEncriptionDialog) {
            DecryptStorageTask.plugin = this;
            DecryptStorageTask.registerInApp();
        }
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
            // Command buttons:
            this.getCommandButtonsColumn(),
            // CPU bars:
            {
                text: t`CPU bars`,
                key: "cpu_bars",
                cellStyle: {paddingTop: "5px", paddingBottom: "5px"},
                cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {
                    const getContainerClassName = (hasBackround: boolean) => `cpu-bars-container ${thisPlugin.userConfig.cpuBars.styleVariant?`bars-style-${thisPlugin.userConfig.cpuBars.styleVariant}`:""} cpu-bars-container-${hasBackround?"with":"no"}-background`;
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

                        return <div className={getContainerClassName(showUnusedBackground)}>{getBars(layers)}</div>;
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

                        return <div className={getContainerClassName(thisPlugin.userConfig.cpuBars.showBackground.pool)}>{getBars(layers)}</div>;
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
                            return <div style={{opacity: getOpacity(item.electrifiedStats)}} className={getContainerClassName(thisPlugin.userConfig.cpuBars.showBackground.guest)}>{getBars(layers)}</div>
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
                                    <h3 style={{margin: "0px"}}>{t`Background`}</h3> {t`Show unused cpu background bars for`}:<br/>
                                    {[{key: "datacenter", text: t`Datacenter`}, {key: "pool", text: t`Pools`}, {key: "node", text: t`Nodes`}, {key: "guest", text: t`Guests`}].map(item =>
                                        <div>&#160;<input type="checkbox" {...bind((plugin.userConfig.cpuBars.showBackground as any)[item.key])} /> {item.text}</div>
                                    )}

                                    <br/>{t`Bar style`}:&#160;
                                    <select {...bind(plugin.userConfig.cpuBars.styleVariant)}>
                                        <option key="default" value={undefined}>Default</option>
                                        <option key="B" value={"B"}>B</option>
                                        <option key="C" value={"C"}>C: {t`red bars for host's own cpu`}</option>
                                        <option key="green" value={"green"}>{t`Green`}</option>
                                    </select>

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
                cellStyle: {paddingTop: "5px", paddingBottom: "5px"},
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
            },
            this.getMemBarTreeColumn(),
            // Raw fields:
            ...(window.localStorage.getItem("electrified_offerRawFieldTreeColumns") === "true"?this.getRawFieldTreeColumns():[])
            ]
    }

    getMemBarTreeColumn() {
        return createValueBarTreeColumn({
            text: t`Mem bars`,
            key: "mem_bars",
            width: 140,
            valueFn: (item) => {
                return item.mem;
            },
            maxValueFn: (item) => {
                return item.maxmem
            },
            formatTextFn: formatMem,
            configKey: "memBars",
        });
    }



    getCommandButtonsColumn(): TreeColumn {
        const app = getElectrifiedApp();
        type ButtonDef = {
            text: string,
            key: string,
            iconCls: string,
            hidden: (guest: Guest) => boolean,
            disabled: (guest: Guest) => boolean,
            handler: (guest: Guest) => Promise<void>,
        };

        const buttonGroupsAndDefs: {key: string, buttons: ButtonDef[]}[] = [{
            key: "powerManagement",
            buttons: [
                {
                    text: t`Start/resume`,
                    key: "start",
                    iconCls: 'fa-play',
                    hidden: (guest: Guest) => false,
                    disabled: (guest: Guest) => guest.status === "running",
                    handler: async (guest) => {
                        await guest.startOrResume();
                    },
                },

                {
                    text: t`Pause`,
                    key: "pause",
                    iconCls: 'fa-pause',
                    hidden: (guest: Guest) => !(guest instanceof Qemu),
                    disabled: (guest: Guest) => guest.status !== "running",
                    handler: async (guest: Guest) => {
                        if (app.userConfig.shutdownGuestWithoutConfirm || await app._showConfirmDialog(t`Pause ${guest.ui_toString()}`, "start-stop")) {
                            await guest.suspend();
                        }
                    },
                },

                {
                    text: t`Hibernate`,
                    key: "hibernate",
                    iconCls: 'fa-download',
                    hidden: (guest: Guest) => !(guest instanceof Qemu),
                    disabled: (guest: Guest) => guest.status === "stopped" || guest.status === "suspended",
                    handler: async (guest: Guest) => {
                        if (app.userConfig.shutdownGuestWithoutConfirm || await app._showConfirmDialog(t`Hibernate ${guest.ui_toString()}`, "start-stop")) {
                            await guest.suspend(true);
                        }
                    },
                },
                {
                    text: t`Shutdown`,
                    key: "shutdown",
                    iconCls: 'fa-power-off',
                    hidden: (guest: Guest) => false,
                    disabled: (guest: Guest) => !(guest.status === "running" && guest.status_extended !== "shutting_down" && guest.status_extended !== "rebooting" && guest.status_extended !== "stopping") ,
                    handler: async (guest: Guest) => {
                        if (app.userConfig.shutdownGuestWithoutConfirm || await app._showConfirmDialog(t`Shutdown ${guest.ui_toString()}`, "start-stop")) {
                            try {
                                await guest.shutdown();
                            } catch (e) {
                                // Don't care, i.e. if it is interrupted or the task timed out
                            }
                        }
                    },
                },
                {
                    text: t`Stop`,
                    key: "stop",
                    iconCls: 'fa-stop',
                    hidden: (guest: Guest) => false,
                    disabled: (guest: Guest) => guest.status === "stopped",
                    handler: async (guest: Guest) => {
                        if (app.userConfig.shutdownGuestWithoutConfirm || await app._showConfirmDialog(t`Stop ${guest.ui_toString()}`, "start-stop")) {
                            await guest.stop();
                            ;
                        }
                    },
                },
                {
                    text: t`Reboot`,
                    key: "reboot",
                    iconCls: 'fa-refresh',
                    hidden: (guest: Guest) => false,
                    disabled: (guest: Guest) => !(guest.status === "running" && guest.status_extended === undefined),
                    handler: async (guest: Guest) => {
                        if (app.userConfig.shutdownGuestWithoutConfirm || await app._showConfirmDialog(t`Reboot ${guest.ui_toString()}`, "start-stop")) {
                            try {
                                await guest.reboot();
                            } catch (e) {
                                // Don't care, i.e. if it is interrupted or the task timed out
                            }
                        }
                    },
                },
                {
                    text: t`Reset`,
                    key: "reset",
                    iconCls: 'fa-bolt',
                    hidden: (guest: Guest) => !(guest instanceof Qemu),
                    disabled: (guest: Guest) => !(guest.status !== "stopped" && guest.status_extended !== "shutting_down"),
                    handler: async (guest: Guest) => {
                        if (app.userConfig.shutdownGuestWithoutConfirm || await app._showConfirmDialog(t`Reset ${guest.ui_toString()}`, "start-stop")) {
                            await guest.reset();
                        }
                    },
                },

            ]
        }];

        return {
            text: t`Commands`,
            key: "command_buttons",
            width: 140,
            cellStyle: {paddingTop: "1px", paddingBottom: "1px"},
            hidden: true,
            cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {
                const guest = props.item as Guest;
                const userConfig = watched(app.userConfig);
                if(guest === null || !(guest instanceof Guest)) {
                    return;
                }

                return buttonGroupsAndDefs.map(group => <ButtonGroup key={group.key} style={{minHeight: "initial", minWidth: "initial", height:"100%"}}>
                    {group.buttons.filter(b => ((userConfig.resourceTreeCommandButtons as any)[b.key] === true) && !b.hidden(guest)).map(buttonDef =>
                        <Button key={buttonDef.key} style={{minHeight: "initial", minWidth: "initial", height:"100%", width: "24px"}} aria-label={buttonDef.text} disabled={buttonDef.disabled(guest)} onClick={() => spawnWithErrorHandling(async () => await buttonDef.handler(guest))}>
                            <span className={`fa fa-fw ${buttonDef.iconCls}`}/>
                        </Button>
                    )}
                </ButtonGroup>);
                /*
                return <div style={{display: "flex", flexDirection: "row", height: "100%", alignItems: "center", gap: "0px"}}>
                    {buttonDefs.map(buttonDef => {
                            return <div class={`x-unselectable x-btn-default-toolbar-small`} style={{height: "23px", width:"23px", display:"block"}}>
                                <span onClick={() => spawnWithErrorHandling(async () => await buttonDef.handler())}
                                   className={`fa fa-fw ${buttonDef.iconCls}`}/>
                            </div>

                        })}
                </div>
                */
            },
            showConfig() {
                const result = showMuiDialog(t`Show/hide command buttons`, {}, (props) => {
                    const userConfig = watched(app.userConfig);
                    return <React.Fragment>
                        <DialogContent>
                            {buttonGroupsAndDefs.map(group => <div key={group.key}>
                                {group.buttons.map(buttonDef =>
                                    <div key={buttonDef.key} style={{display: "fley"}}>
                                        <input type="checkbox" {...bind((userConfig.resourceTreeCommandButtons as any)[buttonDef.key])}/>
                                        <span className={`fa fa-fw ${buttonDef.iconCls}`}/>
                                        <span>{buttonDef.text}</span>
                                    </div>
                                )}
                            </div>)}
                        </DialogContent>
                        <DialogActions>
                            <Button type="submit" onClick={() => props.resolve(true)}>{t`Close`}</Button>
                        </DialogActions>
                    </React.Fragment>
                });
            },
        }
    }

    getRawFieldTreeColumns(): TreeColumn[] {
        return (window as any).PVE.data.ResourceStore.model.fields.map((modelField: any) => {
            const name = modelField.name as string;
            return {
                /**
                 * Column header text
                 */
                text: `${name} (raw)`,

                /**
                 * This is the key for, when saving and restoring the state (width / show / hide)
                 */
                key: `rawfield_${name}`,

                defaultWidth: 180,

                /**
                 * Hide by default (state will be saved in the localstorage)
                 */
                hidden: true,

                cellStyle: { paddingTop: "5px", paddingBottom: "5px"},

                /**
                 * React component function that renders the cell. It will be wrapped in a {@link watchedComponent} with suspense and error handling.
                 * <p>
                 * Note, that **the whole resource tree, which is a legacy Extjs component, is completely rebuild every ~3 seconds** and all cell component's are recreated from scratch. So their state is lost! Meaning, it's not possible to show an ui like a dropdown box there.
                 * Write me, if you need improvement here. In theory, it's possible to handle all situations and only rebuild when i.e. a new vm is added or removed.
                 * </p>
                 */
                cellRenderFn: (props: {item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown>}) => {
                    const record = (props.item as any).rawDataRecord || props.rawItemRecord;
                    const isLiveUpdated = record !== props.rawItemRecord
                    return <span style={{opacity: isLiveUpdated?1:0.3}}>{record[name] as string | number | boolean}</span>
                },


            }
        })
    }

    getGuestMenuItems(guest: Guest): (ContextMenuItem | "menuseparator")[] {
        return [

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

    getGuestConfigTabs(caps: UserCapabilities): ConfigTab<Guest>[] {
        return [...(ElectrifiedFeaturesPlugin.feature_diskSpaceAssistant?[this.getDiskAssistantTab(caps)]:[])];
    }

    getNodeConfigTabs(caps: UserCapabilities): ConfigTab<Node>[] {
        return [...(ElectrifiedFeaturesPlugin.feature_diskSpaceAssistant?[this.getDiskAssistantTab(caps)]:[])];
    }

    getDatacenterConfigTabs(caps: UserCapabilities): ConfigTab<Datacenter>[] {
        return [...(ElectrifiedFeaturesPlugin.feature_diskSpaceAssistant?[this.getDiskAssistantTab(caps)]:[])];
    }

    getDiskAssistantTab(caps: UserCapabilities) {
        return {
            title: t`Disk space assistant`,
            key: "disk_assistant",
            iconCls: "fa fa-fw fa-hdd-o",
            componentFn: (props: any) => {
                const starter:  Datacenter | Pool | Node | Guest = props.item;
                const state = useWatchedState(new class {
                    filterUsageType?: undefined | "disks" | "diskSnapshots" | "mem";
                    filterStorage?: undefined | string;
                    filterText = ""; // Searchfilter
                    test = false;
                });
                const rows:any[] = [{},{},{},{},{},{},{},{},{},{},{},{}];
                const filterCheckbox = (label: string, bind: any) => <div style={{display: "flex", alignItems:"center"}}><Checkbox style={{height: "9px"}} {...bind}/>{label}</div>
                const headerCell = (label: ReactNode, sortKey?: string) => <TableCell>{sortKey?<a style={{textDecoration: "none"}} onClick={()=>{}} >{label}<TableSortLabel active={true} direction={'asc'} /></a>:label}</TableCell>

                return <div style={{width: "100%", height: "100%", display: "flex", flexDirection: "column"}}>
                    {/* Filter row*/}
                    <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px", padding: "8px", borderBottom:"1px solid #cfcfcf" }}>
                        <div style={{display: "flex", alignItems: "center", gap: "4px"}}>
                            <div className="electrified_diskasssistantent_filterLabel">{t`Storage`}</div>
                            <HTMLSelect title={t`Type`} {...bind(state.filterStorage)}>
                                <option value={undefined}>{t`All`}</option>
                                <option value={"zfs"}>{t`Zfs`}</option>
                                <option value={"Other"}>{t`Other`}</option>
                            </HTMLSelect>
                        </div>

                        {filterCheckbox(t`Disks`, bind(state.test))}
                        {filterCheckbox(t`Disks snapshots`, bind(state.test))}
                        {filterCheckbox(t`Ram (snapshot state)`, bind(state.test))}
                        {filterCheckbox(t`Guests's unused disks`, bind(state.test))}
                        {filterCheckbox(t`Abandoned volumes`, bind(state.test))}

                        <div style={{flexGrow:1}}></div>
                        <InputGroup type="search" leftIcon={"search"} placeholder={t`Search`} {...bind(state.filterText)} />
                    </div>

                    {/* Table row*/}
                    <TableContainer style={{ flexGrow: 1 }} >
                        <Table sx={{ minWidth: 650}} aria-label="Disks table" size={"small"} stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t`Usage type`}</TableCell>
                                    <TableCell>{t`Storage`}</TableCell>
                                    <TableCell>{t`Guest`}</TableCell>
                                    <TableCell>{t`Slot`}</TableCell>
                                    {headerCell(<strong>{t`Used`}</strong>, "used")}
                                    {headerCell(t`Max size`,"maxSize")}
                                    <TableCell>{t`Discard`}</TableCell>
                                    <TableCell align="right">{t`Action`} <Popover position={Position.BOTTOM_LEFT} content={<Menu><MenuItem icon="new-text-box" text="New text box" onClick={() => console.log("New text box")} /><MenuItem icon="new-object" text="New object" onClick={() => console.log("New object")} />
                                        <MenuItem icon="new-link" text="New link" onClick={() => console.log("New link")} />
                                    </Menu>}><Button rightIcon="caret-down">Bulk actions</Button></Popover></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {rows.map(row => {
                                    const cellStyle: CSSProperties = {verticalAlign: "top"}
                                    return <TableRow key={"TODO"} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                        <TableCell style={cellStyle}>
                                            Test
                                        </TableCell>
                                    </TableRow>
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    {/* Button bar row*/}
                    <div style={{margin: "8px"}}>
                        <div className={Classes.DIALOG_FOOTER_ACTIONS} style={{alignItems: "center"}}>
                            <div>{t`Listing total`}: <strong>123Gb</strong></div>
                            <Button icon={"refresh"}>{t`Refresh list`}</Button>
                            <ButtonGroup><Button intent={Intent.PRIMARY}>Apply actions</Button>
                            </ButtonGroup>
                        </div>
                    </div>
                </div>
            }
        }
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}
let debug_renderCounter = 0;

class DecryptStorageNotification extends Notification {
    encryptableDevices!: string[];
    get title() {return t`Decrypt storage`}
}

class DecryptStorageTask extends DiagnosisTask<Datacenter> {
    static producesNotifications = [DecryptStorageNotification];
    static runForEach = Datacenter;
    static runInRegularInterval = 10000;
    static initialEstimatedDuration=10;

    async run(datacenter: Datacenter) {
        console.log("running")
        if(!getElectrifiedApp().userIsAdmin) {
            return;
        }

        const nodes2encryptableDisksState = new Map<Node, Awaited<ReturnType<Node["getEncryptableDisksStatus"]>>>();
        for(const node of datacenter.nodes) {
            if(!node.supportsElectrifiedClient) {
                continue;
            }
            this.watched(node).udevEventsCount; // Watch this field
            nodes2encryptableDisksState.set(node, await node.getEncryptableDisksStatus());
        }


        if(![...nodes2encryptableDisksState.values()].some(row => row.some(row => !row.isDecrypted))) { // All disks are already decrypted?
            return;
        }

        window.obj = nodes2encryptableDisksState;

        new class DecryptDisksNotification extends Notification {
            get title() {return t`Encrypted disks were found`}
            Content = watchedComponent(() => {
                const state = useWatchedState(new class {
                    password = "";
                    showPassword = false;
                });

                function tryDecrypt() {

                }

                return <div>
                    <span>{t`The following encrypted disks were found:`}</span><br/><br/>
                    {[...watched(nodes2encryptableDisksState).entries()].map(([node, rows]) =>
                        <div key={node.name}><span className={`fa fa-fw fa-${node.faIcon}`}/> <strong>{node.name}</strong>
                            <TableContainer style={{width: "1000px"}} >
                                <Table aria-label="Devices table table" size={"small"} stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>{t`Type`}</TableCell>
                                            <TableCell>{t`Device`}</TableCell>
                                            <TableCell>{t`Mapped device`}</TableCell>
                                            <TableCell>{t`Status`}</TableCell>
                                            <TableCell></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {rows.map(row => <TableRow key={row.disk}>
                                            <TableCell>{row.ui_type}</TableCell>
                                            <TableCell><HoverTooltip tooltip={row.ui_toolTipInfo && <div>{Object.keys(row.ui_toolTipInfo).map(key => <div key={key}><strong>{key}:</strong> {(row.ui_toolTipInfo! as any)[key]}</div>)}</div>}><span>{row.disk} {row.id !== row.disk && <i>({row.id})</i>}</span></HoverTooltip></TableCell>
                                            <TableCell>{row.mappedDisk || <span style={{opacity: 0.5}}>/dev/mapper/{row.getDefaultMappedLuksDiskName()}</span>}</TableCell>
                                            <TableCell>
                                                {(row.isDecrypted || row._uiState === "success")?<Icon icon="unlock" color={"#06cd06"}/>:<Icon icon="lock"/>}
                                                {row._uiState === "isDecrypting" && <LoadingSpinner/>}
                                                {(row._uiState instanceof Error) && <SmallErrorIndicator error={row._uiState} />}
                                            </TableCell>
                                            <TableCell><Button disabled={row.isDecrypted} icon={"cog"} onClick={() => row.ui_showDiskSettings()}/></TableCell>
                                        </TableRow>)}
                                    </TableBody>
                                </Table>
                            </TableContainer><br/><br/>
                        </div>)}

                    <form onKeyDown={(event) => {if(event.key === "Enter") { event.preventDefault();tryDecrypt() }}} style={{display: "flex", gap: "4px"}}>
                        <InputGroup  {...bind(state.password)}  autoFocus={true}
                                             placeholder={t`Password...`}
                                             rightElement={
                                                 <Tooltip
                                                     content={`${state.showPassword ? "Hide" : "Show"} Password`}
                                                 >
                                                     <Button
                                                         icon={state.showPassword ? "unlock" : "lock"}
                                                         intent={Intent.WARNING}
                                                         onClick={() => state.showPassword = !state.showPassword}
                                                         variant="minimal"
                                                     />
                                                 </Tooltip>
                                             }
                                             type={state.showPassword ? "text" : "password"} />

                        <Button onClick={() => tryDecrypt()} disabled={state.password === ""}>{t`Decrypt`}</Button>
                    </form>
                </div>
            });
        }({about: datacenter}).registerAndShow();
    }
}

//@ts-ignore
var Ext = window.Ext;
//@ts-ignore
var PVE = window.PVE;
//@ts-ignore
var Proxmox = window.Proxmox;