// For typescript, just rename this file from .jsx to .tsx

import {PvemePlugin} from "./_pluginTypeFix";
import React from "react";
import {watchedComponent, watched, useWatchedState} from "react-deepwatch"
import {Button, ButtonGroup, Checkbox,  Classes,  HTMLSelect, Icon, Intent, InputGroup, Label, Menu, MenuItem, Popover, Tooltip} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";

export default class Plugin extends PvemePlugin {
    /**
     * Node wide configuration for this plugin.
     * Will be stored under /etc/pve-local/manager/plugins/[plugin name].json.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written Modifications on disk are immediately updated to this field.
     */
    nodeConfig = {
        // myConfigurationProperty1: "initial value",
        // ...
        myProp: 1
    }

    /**
     * Datacenter-/cluster wide configuration for this plugin.
     * Will be stored under /etc/pve/manager/plugins/[plugin name].json.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications on disk are immediately updated to this field.
     * Accessing this field may throw an error, if the cluster is currently out-of-sync
     */
    datacenterConfig = {

    }

    /**
     * Initializes this plugin. Prefer this point, instead of the constructor.
     * The configs have already been initialized at this time
     * @see onUiReady
     */
    async init() {

    onUiReady() {

    }

    getGuestMenuItems(guest) {
        return[
            //#GUEST_MENU_ITEMS_INSERTION_MARKER#
        ];
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).

    //#PLUGIN_CLASS_BODY_INSERTION_MARKER#
}