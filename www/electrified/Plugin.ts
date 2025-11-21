import type {Application} from "./Application";
import {Guest} from "./model/Guest";
import {Qemu} from "./model/Qemu";
import {Lxc} from "./model/Lxc";
import {Clazz} from "./util/util";
import {retsync2promise} from "proxy-facades/retsync";
import {getElectrifiedApp} from "./globals";

export class Plugin {
    static instance: Plugin;

    app: Application

    /**
     * Set this to false, if this plugin can run without such and you do all the necessary permission checks yourself. Otherwise, this plugin will just be disabled for users with no /Sys.Console permission, so it won't throw lots of errors for them.
     * <p>Hint: You can check the user's permissions with <code>this.app.loginData.cap...</code></p>
     */
    needsAdminPermissions = true;


    constructor(app: Application) {
        this.app = app;
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
     * Called when the user clicks the config symbol in the plugin manager.
     * This config symbol will be disabled, if this method is not overridden.
     * <p>Example:</p>
     * <code><pre>
     async showConfigurationDialog() {
        await this.app.util.ui.showBlueprintDialog({title: `Configure ${this.name}`},(props) => {
            function save() {
                // TODO
                props.resolve(true); // Closes the dialog
            }
            const state = useWatchedState({}); // contentComponentFn was wrapped for you in a watchedComponent, so you can use its features
            return <div>
                <div className={Classes.DIALOG_BODY}>
                    ...
                </div>

                <div className={Classes.DIALOG_FOOTER}>
                    <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                        <ButtonGroup>
                            <Button onClick={() => props.resolve()} intent={Intent.PRIMARY}>Save</Button>
                            <Button onClick={() => props.resolve(undefined)}>Cancel</Button>
                        </ButtonGroup>
                    </div>
                </div>
            </div>;
        });
    }


     * </pre></code>
     */
    async showConfigurationDialog() {

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

    /**
     * @param englishText
     * @returns Text, translated into the current ui language. Uses this plugin's and the electrified- text repo
     */
    private getText(englishText: string) {
        // TODO: create an electrified and plugin-wide text repo and look up text there
        //@ts-ignore
        return window.gettext(englishText); //
    }

    /**
     * See also the function t in your plugin.jsx file which is a shortcut function for this method with usage example.
     * @param englishTextTokens
     * @returns Text, translated into the current ui language. Uses this plugin's and the electrified- text repo
     */
    getTranslatedTextWithTags(englishTextTokens: TemplateStringsArray, ...values: any[]) {
        // Mostly duplicate code in this method

        // Compose textWithPlaceholders in the form "some text $0 has $1 something"
        let textWithPlaceholders = "";
        for(let i =0;i<englishTextTokens.length;i++) {
            if(i > 0) {
                textWithPlaceholders+="$" + (i-1); // add $n
            }
            textWithPlaceholders+=englishTextTokens[i];
        }


        //@ts-ignore
        const translatedWithPlaceholders:string =  this.getText(textWithPlaceholders);
        return translatedWithPlaceholders.replace(/\$[0-9]+/g, token => {
            try {
                return values[token.substr(1) as any as number];
            }
            catch (e) {
                return token;
            }
        })
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
export function fixPluginClass(pluginClass: PluginClass): PluginClass {
    function isSubclassOf(subclass: object, baseClass: object): boolean {
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
    const app = getElectrifiedApp();

    for (const cfg of [
        /* TODO: {key: "userConfig", file: `/home/${userDir}/.pve-manager/plugins/${plugin.name}.json`}, */
        {key: "nodeConfig", path: `/etc/pve/local/manager/plugins/${plugin.name}.json`, isDatacenterConfig: false},
        {key: "datacenterConfig", path: `/etc/pve/manager/plugins/${plugin.name}.json`, isDatacenterConfig: true}]) {

        //@ts-ignore
        const initialConfig:object | undefined = plugin[cfg.key];
        if(initialConfig !== undefined) { // field was specified?
            const file = app.currentNode.getFile(cfg.path);

            // Init config:
            let initialized = false;
            const init = async () => {
                if(initialized) {
                    return;
                }

                if(!app.userIsAdmin) {
                    return;
                }

                await retsync2promise(() => {
                    const config = file.jsonObject || {};

                    // Shyly apply initial values:
                    Object.getOwnPropertyNames(initialConfig).forEach(propName => {
                        if(!config.hasOwnProperty(propName)) {
                            //@ts-ignore
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
                if(app.datacenter.hasQuorum) {
                    await init();
                }
                else {
                    // Handle immediately when quorum is achieved (before the plugin's `await datacenter.quorumPromise` gets called)
                    app.datacenter._earlyOnQuorumHandlers.add(async () => {
                        await init();
                    });
                }
            }
            else {
                await init()
            }

            // Define accessors
            Object.defineProperty(plugin, cfg.key, {
                get() {
                    if(cfg.isDatacenterConfig && !app.datacenter.hasQuorum) {
                        throw new Error("Cannot read from datacenter config. Datacenter has no quorum.")
                    }

                    if(!app.userIsAdmin) {
                        throw new Error("User does not have the permissions (Sys.Cosole) to read the config file");
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
                    if(cfg.isDatacenterConfig && !app.datacenter.hasQuorum) {
                        throw new Error("Cannot write to from datacenter config when datacenter has no quorum.")
                    }
                }
            })
        }
    }
}