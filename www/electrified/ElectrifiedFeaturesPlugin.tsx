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
        const getOpacity = (electrifiedStats: Node["electrifiedStats"] | Guest["electrifiedStats"]) => {
            electrifiedStats = electrifiedStats!;
            watched(this).timeForComponentAnimations; const now = new Date().getTime() // Access timer only to force regular refresh.
            const ageTimeStamp = electrifiedStats.clientTimestamp - electrifiedStats.currentCpuUsage!.ageMs;
            const ageInSeconds = ((now - ageTimeStamp) / 1000) - 2; // -1 = fluctuations the first second window should be still at full opacity. Otherwise it flickers too much
            return Math.min(1, 1 / Math.pow(2, ageInSeconds / 4)); // Half the opacity after 4 seconds
        }

        return [
            // CPU bars:
            {
                text: t`CPU bars`,
                key: "cpu_bars",
                cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {


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
                        // Stack up the guest cpu as layers
                        const guestCpuLayers: Layer[] = [];
                        const guestsStats = item.guests.filter(g => g.electrifiedStats?.currentCpuUsage).map(guest => {return {...guest.electrifiedStats!, id: guest.id}});
                        guestsStats.sort((a,b) => getOpacity(a) - getOpacity(b)); // Sort by opacity
                        let current = 0;
                        for(const electrifiedStats of guestsStats) {
                            guestCpuLayers.push({
                                key: electrifiedStats.id,
                                start: current,
                                end: current + electrifiedStats.currentCpuUsage!.value,
                                cssClass: "cpu-bar-cpu",
                                css: {
                                    opacity: getOpacity(electrifiedStats)
                                }

                            });
                            current+= electrifiedStats.currentCpuUsage!.value
                        }
                        const layers: Layer[] = [];
                        // Unused cores / background:
                        layers.push({
                            key: "background",
                            start: 0,
                            end: item.maxcpu,
                            cssClass: "cpu-bar-unused",
                            css: {
                                opacity: getOpacity(item.electrifiedStats)
                            }
                        });
                        // host cpu:
                        if(item.electrifiedStats?.currentCpuUsage) {
                            layers.push({
                                key: "host",
                                start: 0,
                                end: item.electrifiedStats.currentCpuUsage.value,
                                cssClass: "cpu-bar-host",
                                css: {
                                    opacity: getOpacity(item.electrifiedStats)
                                }
                            });
                        }
                        // guests:
                        layers.push(...guestCpuLayers);

                        return <div className="cpu-bars-container">{getBars(layers)}</div>;
                    } else {
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
                                const relativeStart = Math.max(0, layer.start - barIndex);
                                let relativeEnd = Math.min(1, layer.end - barIndex);
                                relativeEnd = Math.max(0.035, relativeEnd); // Bug workaround: A too low value will make the bar start 1 pixel **below** it's container, cause the container is x + a fraction of pixels.
                                return <div key={layer.key} className={layer.cssClass} style={{position: "absolute", width: "100%", top: `${(1-relativeEnd) * 100}%`, height: `${(relativeEnd - relativeStart) * 100}%`, ...(layer.css || {})}}/>
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
                    function formatCpu(cpu: number) {
                        return `${cpu.toFixed(2)}`;
                    }

                    const item = props.item;
                    if (item instanceof this.app.classes.model.Guest) {
                        if(item.electrifiedStats?.currentCpuUsage) {
                            return <div style={{opacity: getOpacity(item.electrifiedStats)}}>{formatCpu(item.electrifiedStats.currentCpuUsage.value)}<span className="fa fa-fw pmx-itype-icon-processor pmx-icon"/></div>
                        }
                    } else {
                        return undefined;
                    }

                },
            }]
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}