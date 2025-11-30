import {Plugin} from "./Plugin"
import React from "react";
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"
import {Button, ButtonGroup, Checkbox,  Classes,  HTMLSelect, Icon, Intent, InputGroup, Label, Menu, MenuItem, Popover, Tooltip} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";

/**
 * Offers nice features.
 * This internal Plugin is always loaded. It's just like a user plugin. Every feature that electrified wants to offer and which can be delivered by a plugin, (i.e. CPU usage Column in the tree) is done through here
 */
export class ElectrifiedFeaturesPlugin extends Plugin {

    static packageName = "pveme-ui-plugin-electrified-features"

    needsAdminPermissions = false;

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
    }

    async onUiReady() {

    }

    getGuestMenuItems(guest) {
        return[

        ];
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}