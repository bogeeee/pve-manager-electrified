import {ConfigTab, ContextMenuItem, Plugin} from "./Plugin"
import React, {CSSProperties, ReactNode} from "react";
import {bind, binding, load, READS_INSIDE_LOADER_FN, useWatchedState, ValueOnObject, watched} from "react-deepwatch"
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
    Slider
} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {getElectrifiedApp, t} from "./globals";
import "./styles.css"
import {Guest} from "./model/Guest";
import {Node} from "./model/Node";
import {
    getUniqueName,
    HoverTooltip,
    newDefaultMap,
    ObjectHTMLSelect, RememberChoiceButton, RetryableError, retryTilSuccess,
    showBlueprintDialog,
    showMuiDialog, sleep,
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
import {Datacenter} from "./model/Datacenter";
import {UserCapabilities} from "./Application";
import {Notification, NotificationFilter, NotificationSettings} from "./Notification";
import {Qemu} from "./model/Qemu";

/**
 * Offers nice features.
 * This internal Plugin is always loaded. It's just like a user plugin. Every feature that electrified wants to offer and which can be delivered by a plugin, (i.e. CPU usage Column in the tree) is done through here
 */
export class ElectrifiedFeaturesPlugin extends Plugin {
    /**
     * Still in development
     */
    static feature_diskSpaceAssistant = false;

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

            width: 4
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
    datacenterConfig = new class {
        notificationSettings: {
            filter: NotificationFilter,
            settings: NotificationSettings
        }[] = [];
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
                                    <h3 style={{margin: "0px"}}>{t`Background`}</h3> {t`Show unused cpu background bars for`}:<br/>
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

//@ts-ignore
export var Ext = window.Ext;
//@ts-ignore
export var PVE = window.PVE;
//@ts-ignore
export var Proxmox = window.Proxmox;