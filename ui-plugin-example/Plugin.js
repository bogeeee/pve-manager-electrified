// For typescript, just rename this file to .ts

import {PvemePlugin} from "./_pluginTypeFix";

export default class Plugin extends PvemePlugin {
    onUiReady() {
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