import {Plugin} from "./Plugin"
import React from "react";
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"
import {Button, ButtonGroup, Checkbox,  Classes,  HTMLSelect, Icon, Intent, InputGroup, Label, Menu, MenuItem, Popover, Tooltip} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {t} from "./globals";
import "./styles.css"

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
        return [
            // CPU bars:
            {
                text: t`CPU bars`,
                key: "cpu_bars",
                cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {

                    const item = props.item;
                    if (item instanceof this.app.classes.model.Guest) {
                        if(item.electrifiedStats?.currentCpuUsage) {
                            watched(this).timeForComponentAnimations; const now = new Date().getTime() // Access timer only to force regular refresh.
                            const ageTimeStamp = item.electrifiedStats.clientTimestamp - item.electrifiedStats.currentCpuUsage.ageMs;
                            const ageInSeconds = ((now - ageTimeStamp) / 1000) - 1; // -1 = fluctuations the first second window should be still at full opacity. Otherwise it flickers too much
                            const opacity = Math.min(1, 1 / Math.pow(2, ageInSeconds / 4)); // Half the opacity after 4 seconds
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
                            return <div style={{opacity}} className="cpu-bars-container">{getBars(layers)}</div>
                        }
                    } else {
                        return undefined;
                    }
                    type Layer = {key: string | number, start: number, end: number, cssClass: string};
                    function getBars(layers: Layer[]) {
                        const result: ReactNode[] = [];
                        const max = Math.ceil(layers.reduce((max,current) => Math.max(max, current.end),0));
                        for(let barIndex = 0;barIndex<max;barIndex++) {
                            result.push(<div key={barIndex} className="cpu-bar">{layers.map(layer => {
                                if(!(layer.start <= barIndex+1 && layer.end > barIndex)) { // layer outside range?
                                    return;
                                }
                                const relativeStart = Math.max(0, layer.start - barIndex);
                                const relativeEnd = Math.min(1, layer.end - barIndex);
                                return <div key={layer.key} className={layer.cssClass} style={{position: "absolute", width: "100%", top: `${(1-relativeEnd) * 100}%`, height: `${(relativeEnd - relativeStart) * 100}%`}}/>
                            })}</div>)
                        }

                        return result;
                    }
                },
            },
            // CPU:
            {
                text: t`CPU text`,
                key: "cpu_text",
                hidden: true,
                cellRenderFn: (props: { item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown> }) => {
                    function formatCpu(cpu: number) {
                        if (cpu > 1) {
                            return `${cpu.toFixed(2)}\u00A0`;
                        }
                        return `${Math.ceil(cpu * 100)}%`
                    }

                    const item = props.item;
                    if (item instanceof this.app.classes.model.Guest) {
                        if(item.electrifiedStats?.currentCpuUsage) {
                            watched(this).timeForComponentAnimations; const now = new Date().getTime() // Access timer only to force regular refresh.
                            const ageTimeStamp = item.electrifiedStats.clientTimestamp - item.electrifiedStats.currentCpuUsage.ageMs;
                            const ageInSeconds = ((now - ageTimeStamp) / 1000) - 1; // -1 = fluctuations the first second window should be still at full opacity. Otherwise it flickers too much
                            const opacity = Math.min(1, 1 / Math.pow(2, ageInSeconds / 4)); // Half the opacity after 4 seconds
                            return <div style={{opacity}}>{formatCpu(item.electrifiedStats.currentCpuUsage.value)}</div>
                        }
                    } else {
                        return undefined;
                    }

                },
            }]
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}