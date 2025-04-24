
export class Plugin {
    get packageName() {
        throw new Error("TODO");
    }

    getGuestContextMenuEntries(guest: object): {}[]{
        return[];
    }

    /**
     * Content of package.json
     */
    getPackage() {

    }

    /**
     * Fired, when the ui is loaded and displayed (i.e. the login screen or main window is displayed)
     */
    onUiReady() {

    }
}