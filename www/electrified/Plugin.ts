import {Application, app} from "./Application";
import {Guest} from "./model/Guest";
import {Qemu} from "./model/Qemu";
import {Lxc} from "./model/Lxc";
import {Clazz} from "./util/util";
import {retsync2promise} from "proxy-facades/retsync";

export class Plugin {
    app: Application


    constructor(app: Application) {
        // This constructor is not called because the of dummy-plugin-base workaround / class-rebasing
    }

    /**
     * Initializes this plugin. Prefer this point, instead of the constructor.
     * The configs have already been initialized at this time
     * @see onUiReady
     */
    async init() {

    }

    /**
     * @return short name
     * @see packageName
     */
    get name() {
        return this.packageName.replace(/^pveme-ui-plugin-/,"");
    }

    /**
     * Set during registration
     */
    static packageName: string;

    /**
     * @see name
     */
    get packageName(): string {
        return (this.constructor as any).packageName;
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
     * Fired, when the ui is loaded and displayed (i.e. the login screen or main window is displayed).
     */
    async onUiReady() {

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

export type PluginList =  {pluginClass: PluginClass, packageName: string, diagnosis_sourceDir?: string}[]

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

/**
 *
 */
export async function initializePluginConfigs(plugin: Plugin) {

    for (const cfg of [
        /* TODO: {key: "userConfig", file: `/home/${userDir}/.pve-manager/plugins/${plugin.name}.json`}, */
        {key: "nodeConfig", path: `/etc/pve-local/manager/plugins/${plugin.name}.json`, isDatacenterConfig: false},
        {key: "datacenterConfig", path: `/etc/pve/manager/plugins/${plugin.name}.json.`, isDatacenterConfig: true}]) {

        const initialConfig:object | undefined = plugin[cfg.key];
        if(initialConfig !== undefined) { // field was specified?
            const file = app.currentNode.getFile(cfg.path);

            // Init config:
            let initialized = false;
            const init = async () => {
                if(initialized) {
                    return;
                }
                await retsync2promise(() => {
                    const config = file.jsonObject || {};

                    // Shyly apply initial values:
                    Object.getOwnPropertyNames(initialConfig).forEach(propName => {
                        if(!config.hasOwnProperty(propName)) {
                            config[propName] = initialConfig[propName];
                        }
                    })

                    if(file.jsonObject === undefined && Object.getOwnPropertyNames(config).length == 0) {
                        // Don't write if everything is empty to not create a bunch of empty config files when there's not really an interest to use them
                    }
                    else {
                        file.jsonObject = config; // write
                    }

                })

                initialized = true;
            }
            if(cfg.isDatacenterConfig) {
                if(app.datacenter.online) {
                    await init();
                }
                app.datacenter.onOnlineStatusChanged((online) => {
                    if(online) {
                        init();
                    }
                })

            }
            else {
                await init()
            }

            // Define accessors
            Object.defineProperty(plugin, cfg.key, {
                get() {
                    if(cfg.isDatacenterConfig && !app.datacenter.online) {
                        throw new Error("Cannot read from datacenter config when datacenter is offline")
                    }

                    if(!initialized) {
                        throw new Error("Illegal state");
                    }

                    if(file.jsonObject === undefined) { // Config does not yet exist?
                        file.jsonObject = {};
                    }

                    return file.jsonObject;
                },
                set(value: object) {
                    if(cfg.isDatacenterConfig && !app.datacenter.online) {
                        throw new Error("Cannot write to from datacenter config when datacenter is offline")
                    }
                }
            })
        }
    }
}