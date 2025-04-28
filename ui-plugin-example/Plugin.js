// For typescript, just rename this file to .ts

import {PvemePlugin} from "./_pluginTypeFix";

export default class Plugin extends PvemePlugin {
    onUiReady() {
        console.log("Hello world from plugin")
    }

    getGuestContextMenuEntries(guest) {
        return [];
    }

    // ... for more plugin-hooks, use code completion here (ctrl+space).
}