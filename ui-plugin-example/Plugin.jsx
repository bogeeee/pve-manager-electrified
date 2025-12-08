// For typescript, just rename this file from .jsx to .tsx

import {PvemePlugin} from "./_pluginTypeFix";
import _ from "underscore";
import React from "react";
import {watchedComponent, watched, useWatchedState, load, isLoading, loadFailed, poll, binding, bind, READS_INSIDE_LOADER_FN} from "react-deepwatch"
import {Button, ButtonGroup, Checkbox,  Classes,  HTMLSelect, Icon, Intent, InputGroup, Intentm Label, Menu, MenuItem, Popover, Tooltip} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from "@mui/material"; // For tables, MUI offers the simpler and better version
import "./styles.css"

export default class Plugin extends PvemePlugin {

    /**
     * Set this to false, if this plugin can run without such and you do all the necessary permission checks yourself. Otherwise, this plugin will just be disabled for users with no /Sys.Console permission, so it won't throw lots of errors for them.
     * <p>Hint: You can check the user's permissions with <code>this.app.loginData.cap...</code></p>
     */
    needsAdminPermissions = true;

    /**
     * User-wide configuration for this plugin.
     * Will be stored in the browser's localstorage under the key plugin_[plugin name]_config.
     * This class's field is specially treated by electrified: (Deep) modifications are automatically written. Modifications to the localstorage entry (i.e. by other browser tabs) are updated to this field.
     *
     * Because this field may be updated to a new object instance (on external config change), make sure to to not **hold* references to sub-objects over a long time. I.e. <WRONG>const myLongTermConst = this.userConfig.treeColumnConfigs;</WRONG>
     */
    userConfig = {
        // myConfigurationProperty1: "initial value",
        // ...
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
        console.log("Hello says some example plugin")
    }

    async onUiReady() {

    }

    getGuestMenuItems(guest) {
        return[
            //#GUEST_MENU_ITEMS_INSERTION_MARKER#
        ];
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).


    //#PLUGIN_CLASS_BODY_INSERTION_MARKER#
}


/**
 * Translates text from english into the current ui language. It looks it up in this plugin's and the electrified translation repo.
 * It uses the "taged template" syntax which allows to easily inert variables.
 * <p>
 *     Usage example: <code>t`You have ${numberOfUnread} unread messages`</code>
 * </p>
 * @param englishTextTokens
 * @param values
 */
export function t(englishTextTokens /* :TemplateStringsArray */, ...values /* :any[] */) {
    return Plugin.instance.getTranslatedTextWithTags(englishTextTokens, ...values);
}

//@ts-ignore
export var Ext = window.Ext;