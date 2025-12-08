import {Plugin} from "./Plugin"
import React, {CSSProperties, ReactNode} from "react";
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"
import {Button, ButtonGroup, Checkbox,  Classes,  HTMLSelect, Icon, Intent, InputGroup, Label, Menu, MenuItem, Popover, Tooltip} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {t} from "./globals";
import "./styles.css"
import {Guest} from "./model/Guest";
import {Node} from "./model/Node";
import {string} from "prop-types";
import {newDefaultMap, throwError} from "./util/util";
import _ from "underscore";
import {Pool} from "./model/Pool";

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
    }

    /**
     * Node wide configuration for this plugin.
     * Will be stored under /etc/pve/local/manager/plugins/[plugin name].json.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications on disk are immediately updated to this field.
     *
     * Because this field may be updated to a new object instance (on external config change), make sure to to not **hold* references to sub-objects over a long time. I.e. <WRONG>const myLongTermConst = this.nodeConfig.treeColumnConfigs;</WRONG>
     */
    nodeConfig = {
        // myConfigurationProperty1: "initial value",
        // ...
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
        setInterval(() => this.timeForComponentAnimations = new Date().getTime(), 250);
    }

    async onUiReady() {

    }


    getResourceTreeColumns() {
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
                    function getSummedUpBars(nodes2guests: Map<Node, Set<Guest>>) {
                        const layers: Layer[] = [];
                        let nodes = [...nodes2guests.keys()];
                        let allGuests = [...nodes2guests.keys()].map(k => [...nodes2guests.get(k)!.values()]).flat();
                        //nodes = [...nodes, ...nodes]; allGuests = [...allGuests, ...allGuests]; // Debug: double entries

                        {
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

                        {
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
                            const layers: Layer[] = [
                                // Unused / background:
                                {
                                    start: 0,
                                    end: item.maxcpu,
                                    cssClass: "cpu-bar-unused",
                                },
                                // Cpu:
                                {
                                    start: 0,
                                    end: item.electrifiedStats.currentCpuUsage.value,
                                    cssClass: "cpu-bar-cpu",
                                }
                            ]
                            return <div style={{opacity: getOpacity(item.electrifiedStats)}} className="cpu-bars-container">{getBars(layers)}</div>
                        }
                    } else if(item instanceof this.app.classes.model.Node) {
                        const node = item;
                        return getSummedUpBars(new Map([[node, new Set(node.guests)]]))
                    } else if(item instanceof this.app.classes.model.Datacenter) {
                        const node2guests = new Map(item.nodes.map(node => [node, new Set(node.guests)]));
                        //const node2guests = new Map([[watched(this.app.currentNode), new Set(watched(this.app.currentNode).guests)]]); // debug: only use current node
                        return getSummedUpBars(node2guests)
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

                                const prev = layers[i-1];
                                const layer = layers[i];
                                if(_.isEqual(prev, {...layer, start:prev.start, end: layer.start})) { // can be squeezed?
                                    prev.end = layer.end;
                                }
                                else {
                                    result.push(layer)
                                }
                            }
                            return result;
                        }
                        layers = squeezeLayers(layers);


                        const result: ReactNode[] = [];
                        const maxHeight = 16;

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
                            result.push(<div key={barIndex} className="cpu-bar">{layers.map(layer => {
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
                                {formatCpu(guestsCpuUsage, false)}{smallSpace}<span className={`fa fa-fw ${getIconClass("qemu")}`}/><span className={`fa fa-fw ${getIconClass("lxc")}`}/>
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

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}
let debug_renderCounter = 0;