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
import {throwError} from "./util/util";

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
                        const nodes = [...nodes2guests.keys()];
                        const allGuests = [...nodes2guests.keys()].map(k => [...nodes2guests.get(k)!.values()]).flat();

                        // Stack up the guest cpu as layers:
                        const guestCpuLayers: Layer[] = [];
                        {
                            const guestsStats = allGuests.filter(g => g.electrifiedStats?.currentCpuUsage?.value).map(guest => {
                                return {...guest.electrifiedStats!, id: guest.id}
                            });
                            guestsStats.sort((a, b) => getOpacity(b) - getOpacity(a)); // Sort by opacity
                            let current = 0;
                            for (const electrifiedStats of guestsStats) {
                                const opacity = getOpacity(electrifiedStats);
                                if (opacity > 0) {
                                    guestCpuLayers.push({
                                        key: `gues${electrifiedStats.id}`,
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

                        {
                            // Stack up unused cores / background:
                            let current = 0;
                            for(const node of nodes) {
                                const opacity = getOpacity(node.electrifiedStats)
                                layers.push({
                                    key: "background",
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
                                return {...node.electrifiedStats!, name: node.name}
                            });
                            nodesStats.sort((a, b) => getOpacity(b) - getOpacity(a)); // Sort by opacity
                            for(const stats of nodesStats) {
                                const opacity = getOpacity(stats);
                                layers.push({
                                    key: `node_${stats.name}`,
                                    start: current,
                                    end: current+=stats.currentCpuUsage!.value,
                                    cssClass: "cpu-bar-host",
                                    css: {
                                        opacity
                                    }
                                });
                            }
                        }

                        // guests:
                        layers.push(...guestCpuLayers);

                        return <div className="cpu-bars-container">{getBars(layers)}</div>;
                    }



                    const item = props.item;
                    if (item instanceof this.app.classes.model.Guest) {
                        if(item.electrifiedStats?.currentCpuUsage) {
                            const layers: Layer[] = [
                                // Unused / background:
                                {
                                    key: "background",
                                    start: 0,
                                    end: item.maxcpu,
                                    cssClass: "cpu-bar-unused",
                                },
                                // Cpu:
                                {
                                    key: "cpu",
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
                        const node2guests = new Map([[this.app.currentNode, new Set(this.app.currentNode.guests)]]);
                        return getSummedUpBars(node2guests)
                    }
                    else {
                        return undefined;
                    }
                    type Layer = {key: string | number, start: number, end: number, cssClass: string, css?: CSSProperties};
                    function getBars(layers: Layer[]) {
                        const result: ReactNode[] = [];
                        const max = Math.ceil(layers.reduce((max,current) => Math.max(max, current.end),0));
                        for(let barIndex = 0;barIndex<max;barIndex++) {
                            result.push(<div key={barIndex} className="cpu-bar">{layers.map(layer => {
                                if(!(layer.start <= barIndex+1 && layer.end > barIndex)) { // layer outside range?
                                    return;
                                }
                                let relativeStart = Math.max(0, layer.start - barIndex);
                                relativeStart = Math.max(0.035, relativeStart); // Bug workaround: A too low value will make the bar start 1 pixel **below** it's container, cause the container is x + a fraction of pixels.
                                let relativeEnd = Math.min(1, layer.end - barIndex);
                                return <div key={layer.key} className={layer.cssClass} style={{position: "absolute", width: "100%", bottom: `${relativeStart * 100}%`, height: `${(relativeEnd - relativeStart) * 100}%`, ...(layer.css || {})}}/>
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

                    const item = props.item;
                    if (item instanceof this.app.classes.model.Node) {
                        const node = item;
                        if(!node.electrifiedStats?.currentCpuUsage) {
                            return undefined;
                        }

                        let guestsOpacity = 1;
                        let guestsCpuUsage = 0;
                        for(const guest of node.guests) {
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

                        return guestsOpacity > 0 ?
                            <span style={{opacity: guestsOpacity}}>
                                {formatCpu(guestsCpuUsage, false)}{smallSpace}<span className={`fa fa-fw ${getIconClass("qemu")}`}/><span className={`fa fa-fw ${getIconClass("lxc")}`}/>
                                &#160;&#160;+&#160;&#160;
                                {formatCpu(node.electrifiedStats.currentCpuUsage.value - guestsCpuUsage, false)}{smallSpace}<span className={`fa fa-fw ${getIconClass("node")}`}/>
                            </span>
                            :
                            <span style={{opacity: getOpacity(node.electrifiedStats)}}>
                                {formatCpu(node.electrifiedStats.currentCpuUsage.value)}
                            </span>

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