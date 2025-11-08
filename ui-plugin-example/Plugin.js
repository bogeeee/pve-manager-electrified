// For typescript, just rename this file to .ts

import {PvemePlugin} from "./_pluginTypeFix";

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

    }

    async onUiReady() {
        console.log("Hello world from plugin")
    }

    getGuestMenuItems(guest) {
        return[
            //#GUEST_MENU_ITEMS_INSERTION_MARKER#
        ];
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).

    //#PLUGIN_CLASS_BODY_INSERTION_MARKER#
}