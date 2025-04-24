
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
}