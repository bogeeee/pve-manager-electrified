import {Application} from "./Application";
import {Guest} from "./model/Guest";
import {Qemu} from "./model/Qemu";
import {Lxc} from "./model/Lxc";
import {Clazz} from "./util/util";

export class Plugin {
    app: Application


    constructor(app: Application) {
        this.app = app;
    }

    get packageName() {
        throw new Error("TODO");
    }

    getGuestMenuItems(guest: Guest): {}[]{
        return[];
    }

    getQemuMenuItems(qemu: Qemu): {}[]{
        return[];
    }

    getLxcMenuItems(lxc: Lxc): {}[]{
        return[];
    }

    /**
     * Content of package.json
     */
    getPackage(): any {
        throw new Error("TODO: implement")
    }

    /**
     * Fired, when the ui is loaded and displayed (i.e. the login screen or main window is displayed)
     */
    onUiReady() {

    }

    /**
     *
     * @param contextObj the object where the context menu is for
     */
    _getMenuItems(contextObj: object) {
        if(contextObj instanceof Qemu) {
            return [...this.getGuestMenuItems(contextObj), ...this.getQemuMenuItems(contextObj)];
        }
        if(contextObj instanceof Lxc) {
            return [...this.getGuestMenuItems(contextObj), ...this.getLxcMenuItems(contextObj)];
        }
        return []; // not handled
    }
}

export type PluginClass = typeof Plugin;

export type PluginList =  {pluginClass: PluginClass, diagnosis_packageName: string, diagnosis_sourceDir?: string}[]

/**
 * import {something} from "pveme-ui" does not work with the vite bundler. It cannot reference the the root package from within another package.
 * Therefore we have to inject all dependencies.
 * To still give .js users a nice code completion experience with classes, we import only the type (for tsc and the IDE) and give it the DummyPluginBase class.
 * Here, we change the prototype chain and re-base it on the real Plugin class.
 */
export function fixPluginClass(pluginClass: PluginClass) {
    function isSubclassOf(subclass: object, baseClass: object) {
        if(subclass === baseClass) {
            return true;
        }
        const proto = Object.getPrototypeOf(subclass);
        return proto !== null?isSubclassOf(proto, baseClass):false;
    }

    if(isSubclassOf(pluginClass, Plugin)) { // Already fixed ?
        return pluginClass;
    }

    let dummyPluginBaseLevel: any = pluginClass;
    while (!dummyPluginBaseLevel.name?.startsWith("DummyPluginBase")) { // Note: startsWith, because name can be DummyPluginBase2 etc., cause the vite bundler must unify class names
        dummyPluginBaseLevel = Object.getPrototypeOf(dummyPluginBaseLevel); // move one level up
        if(dummyPluginBaseLevel === null) {
            throw new Error("Invalud plugin class. Neither is it a 'Plugin', nor a 'DummyPluginBase'");
        }
    }

    Object.setPrototypeOf(dummyPluginBaseLevel, Plugin); // Re-base static class
    Object.setPrototypeOf(dummyPluginBaseLevel.prototype , Plugin.prototype); // re-base instance prototype

    return pluginClass;
}