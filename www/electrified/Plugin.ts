import type {Application} from "./Application";
import {Guest} from "./model/Guest";
import {Qemu} from "./model/Qemu";
import {Lxc} from "./model/Lxc";
import {Node} from "./model/Node"
import {checkForDuplicates, Clazz, spawnWithErrorHandling, throwError} from "./util/util";
import {retsync2promise} from "proxy-facades/retsync";
import {getElectrifiedApp} from "./globals";
import {WatchedProxyFacade} from "proxy-facades";
import {ReactNode} from "react";
import {isRendering} from "react-deepwatch"
import _ from "underscore"
import {Datacenter} from "./model/Datacenter";

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
     * Called, when classic components have been defined but are not started yet.
     * Use this hook, to modify them.
     * <p>
     *     this.app has not been fully initialized at that time.
     * </p>
     * @see init
     */
    async earlyInit() {

    }

    /**
     * Initializes this plugin. Prefer this point, instead of the constructor and {@link earlyInit}.
     * The configs have already been initialized at this time
     * @see earlyInit
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

    /**
     * Adds context menu items.
     * <p>Example:</p>
     * <pre><code>
     getDatacenterMenuItems(datacenter) {
            return [
                {
                    text: t`Show number of nodes`,
                    iconCls: 'fa fa-fw fa-circle-thin',
                    handler: async () => {
                        await this.app.util.ui.messageBox(t`Title`, t`node count: ${datacenter.nodes.length}`);
                    },
                },
            ]
        }
     * </code></pre>
     */
    getDatacenterMenuItems(datacenter: Datacenter): (ContextMenuItem | "menuseparator")[] {
        return [];
    }

    /**
     * Adds context menu items.
     * <p>Example:</p>
     * <pre><code>
        getNodeMenuItems(node) {
            return [
                {
                    text: t`Show this node's name`,
                    iconCls: 'fa fa-fw fa-circle-thin',
                    handler: async () => {
                        await this.app.util.ui.messageBox(t`Title`, t`The node is called: ${node.name}`);
                    },
                },
            ]
        }
     * </code></pre>
     * @param node
     */
    getNodeMenuItems(node: Node): (ContextMenuItem | "menuseparator")[] {
        return [];
    }

    /**
     * Adds context menu items.
     * <p>Example:</p>
     * <pre><code>
     getGuestMenuItems(guest) {
            return [
                {
                    text: t`Show this guest's id`,
                    iconCls: 'fa fa-fw fa-circle-thin',
                    handler: async () => {
                        await this.app.util.ui.messageBox(t`Title`, t`The guest's id is: ${guest.id}`);
                    },
                    //... You can provide more fields than typed here, see {@link https://docs.sencha.com/extjs/6.7.0/modern/Ext.menu.Item.html Ext.menu.Item}
                },
            ]
        }
     * </code></pre>
     * @see getQemuMenuItems
     * @see getLxcMenuItems
     */
    getGuestMenuItems(guest: Guest): (ContextMenuItem | "menuseparator")[]{
        return[];
    }

    /**
     * Adds context menu items.
     * <p>Example:</p>
     * <pre><code>
     getQemuMenuItems(qemu) {
            return [
                {
                    text: t`Show this guest's id`,
                    iconCls: 'fa fa-fw fa-circle-thin',
                    handler: async () => {
                        await this.app.util.ui.messageBox(t`Title`, t`The guest's id is: ${qemu.id}`);
                    },
                    //... You can provide more fields than typed here, see {@link https://docs.sencha.com/extjs/6.7.0/modern/Ext.menu.Item.html Ext.menu.Item}
                },
            ]
        }
     * </code></pre>
     * @see getGuestMenuItems
     */
    getQemuMenuItems(qemu: Qemu): (ContextMenuItem | "menuseparator")[]{
        return[];
    }

    /**
     * Adds context menu items.
     * <p>Example:</p>
     * <pre><code>
     getLxcMenuItems(lxc) {
            return [
                {
                    text: t`Show this guest's id`,
                    iconCls: 'fa fa-fw fa-circle-thin',
                    handler: async () => {
                        await this.app.util.ui.messageBox(t`Title`, t`The guest's id is: ${lxc.id}`);
                    },
                    //... You can provide more fields than typed here, see {@link https://docs.sencha.com/extjs/6.7.0/modern/Ext.menu.Item.html Ext.menu.Item}
                },
            ]
        }
     * </code></pre>
     * @see getGuestMenuItems
     */
    getLxcMenuItems(lxc: Lxc): (ContextMenuItem | "menuseparator")[]{
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

    getResourceTreeColumns(): TreeColumn[] {
        return [];
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
    _getMenuItems(contextObj: object): object[] {
        function toExtMenuItem(item: ContextMenuItem | "menuseparator") {
            if(item === "menuseparator") {
                return {xtype: "menuseparator"};
            }
            return {
                ...item,
                // Wrap with error handler:
                handler: () => {
                    spawnWithErrorHandling(item.handler);
                }
            }
        }

        if(contextObj instanceof Datacenter) {
            return this.getDatacenterMenuItems(this.app.datacenter).map(i => toExtMenuItem(i));
        }
        if(contextObj instanceof Node) {
            return this.getNodeMenuItems(contextObj).map(i => toExtMenuItem(i));
        }
        if(contextObj instanceof Qemu) {
            return [...this.getGuestMenuItems(contextObj).map(i => toExtMenuItem(i)), ...this.getQemuMenuItems(contextObj).map(i => toExtMenuItem(i))];
        }
        if(contextObj instanceof Lxc) {
            return [...this.getGuestMenuItems(contextObj).map(i => toExtMenuItem(i)), ...this.getLxcMenuItems(contextObj).map(i => toExtMenuItem(i))];
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

    /**
     * Pre-check, if the plugin is valid
     */
    _validate() {
        const resourceTreeColumns = this.getResourceTreeColumns();
        resourceTreeColumns.forEach(t => t.key || throwError("No 'key' was specified in resource tree column."));
        checkForDuplicates(resourceTreeColumns, "key", (key) => throwError(`Duplicate keys in resource tree column: ${key}`));
    }

    get _localStorageConfigKey() {
        return `plugin_${this.name}_config`
    }

    get _nodeConfigFilePath() {
        return `/etc/pve/local/manager/plugins/${this.name}.json`
    }

    get _datacenterConfigFilePath() {
        return `/etc/pve/manager/plugins/${this.name}.json`
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
export async function initialize_userConfig(plugin: Plugin) {
    const app = getElectrifiedApp();
    const localStorageKey = plugin._localStorageConfigKey;

    //@ts-ignore
    const initialConfig:object | undefined = plugin["userConfig"];
    if(initialConfig === undefined) { // field not specified?
        return;
    }

    const getConfigFromLocalStorage = () => {
        try {
            return JSON.parse(window.localStorage.getItem(localStorageKey) || "null") || {}
        }
        catch (e) {
            throw new Error(`Malformed json value in localstorage under key: ${localStorageKey}`)
        }
    }

    function write(config: object) {
        window.localStorage.setItem(localStorageKey, JSON.stringify(config));
    }

    // *** Init config: ***
    const config = getConfigFromLocalStorage()
    // Shyly apply initial values:
    Object.getOwnPropertyNames(initialConfig).forEach(propName => {
        if (!config.hasOwnProperty(propName)) {
            //@ts-ignore
            config[propName] = initialConfig[propName];
        }
    })
    //write:
    if (window.localStorage.getItem(localStorageKey) === null && Object.getOwnPropertyNames(config).length == 0) {
        // Don't write if everything is empty to not create a bunch of empty values when there's not really an interest to use them
    } else {
        write(config); // write
    }


    // Define accessors
    Object.defineProperty(plugin, "userConfig", {
        get() {
            const config = getConfigFromLocalStorage();

            if(this[`_userConfig`] !== undefined) {
                if (_.isEqual(config, this[`_userConfig`])) {
                    return this[`_userConfig`];
                }

                if (isRendering()) {
                    //return this[`_userConfig`]; // Prevent error: cannot modify during rendering . Returns the old object (a bit hacky). TODO: Poll regularly an update this[`_userConfig`]
                    throw new Error("Userconfig was modified (by another browser tab?). Please reload the page and try again")
                }
            }

            const proxyFacade = new WatchedProxyFacade();
            proxyFacade.onAfterChange(() => write(config));
            const result = proxyFacade.getProxyFor(config);

            this[`_userConfig`] = result; // **Pin** to this plugin, so this saved in the model and treated as data, so `watched(myPlugin).xxxConfig` gives you a proxy (like the user would expect)
            return this[`_userConfig`]; // in a second line, cause must trigger access to return the proxy
        },
        set(value: object) {
            write(value);
        }
    })
}

/**
 *
 */
export async function initialize_nodeConfig_and_datacenterConfig(plugin: Plugin) {
    const app = getElectrifiedApp();

    for (const cfg of [
        /* TODO: {key: "userConfig", file: `/home/${userDir}/.pve-manager/plugins/${plugin.name}.json`}, */
        {key: "nodeConfig", path: plugin._nodeConfigFilePath, isDatacenterConfig: false},
        {key: "datacenterConfig", path: plugin._datacenterConfigFilePath, isDatacenterConfig: true}]) {

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
                if(app.loginData?.cap.nodes["Sys.Audit"]) {
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
            }
            else {
                await init()
            }

            // Define accessors
            Object.defineProperty(plugin, cfg.key, {
                get() {
                    if(!app.userIsAdmin) {
                        throw new Error("User does not have the permissions (Sys.Cosole) to read the config file");
                    }

                    if(cfg.isDatacenterConfig && !app.datacenter.hasQuorum) {
                        throw new Error("Cannot read from datacenter-wide plugin config. Datacenter has no quorum.")
                    }

                    if(!initialized) {
                        throw new Error("Illegal state");
                    }

                    if(file.jsonObject === undefined) { // Config does not yet exist?
                        file.jsonObject = {};
                    }

                    this[`_${cfg.key}`] = file.jsonObject; // **Pin** to this plugin, so this saved in the model and treated as data, so `watched(myPlugin).xxxConfig` gives you a proxy (like the user would expect)
                    return this[`_${cfg.key}`];
                },
                set(value: object) {
                    if(cfg.isDatacenterConfig && !app.datacenter.hasQuorum) {
                        throw new Error("Cannot write to datacenter-wide plugin config when datacenter has no quorum.")
                    }
                    file.jsonObject = value;
                }
            })
        }
    }
}

export type TreeColumn = {
    /**
     * Column header text
     */
    text: string;

    /**
     * This is the key for, when saving and restoring the state (width / show / hide)
     */
    key: string;

    /**
     * See https://docs.sencha.com/extjs/6.7.0/modern/Ext.grid.column.Column.html#defaultWidth
     */
    flex?: number | string

    defaultWidth?: number;

    /**
     * Hide by default (state will be saved in the localstorage)
     */
    hidden?: boolean

    /**
     * React component function that renders the cell. It will be wrapped in a {@link watchedComponent} with suspense and error handling.
     * <p>
     * Note, that **the whole resource tree, which is a legacy Extjs component, is completely rebuild every ~3 seconds** and all cell component's are recreated from scratch. So their state is lost! Meaning, it's not possible to show an ui like a dropdown box there.
     * Write me, if you need improvement here. In theory, it's possible to handle all situations and only rebuild when i.e. a new vm is added or removed.
     * </p>
     */
    cellRenderFn: (props: {item: object, rowIndex: number, colIndex: number, rawItemRecord: Record<string, unknown>}) => ReactNode

    /**
     * Called, when the user clicks on the config gear icon.
     * <p>Shows the gear icon when set</p>
     * Example from the "cpu bars" column:
     * <pre><code>
     getResourceTreeColumns() {
         const thisPlugin = this;
         return [
             // CPU bars:
             {
                text: t`CPU bars`,
                key: "cpu_bars",
                showConfig() {
                    const result = showMuiDialog(t`CPU bar configuration`, {}, (props) => {
                        const plugin = watched(thisPlugin);
                        return <React.Fragment>
                            <DialogContent>
                                <DialogContentText>
                                    {t`Show unused cpu background bars for`}:<br/>
                                    &#160;<input type="checkbox" {...bind(plugin.userConfig.cpuBars.showBackground.datacenter)} /> {t`Datacenter`}
                                </DialogContentText>
                            </DialogContent>
                            <DialogActions>
                                <Button type="submit" onClick={() => props.resolve(true)} >{t`Close`}</Button>
                            </DialogActions>
                        </React.Fragment>
                    });
                },
             },
         ];
     }
     * </code></pre>
     *
     * <p>Development: Add this to the init() method to show the dialog on startup: <code>this.app._configureColumn(this.name, "key_of_colummn");</code>
     */
    showConfig?: () => void | Promise<void>;
}

/**
 * ... You can provide more fields than typed here, see {@link https://docs.sencha.com/extjs/6.7.0/modern/Ext.menu.Item.html Ext.menu.Item}
 */
type ContextMenuItem = Record<string, unknown> & {
    text: string,
    /**
     * Example: 'fa fa-fw fa-send-o'.
     * See {@link https://fontawesome.com/v4/icons/ font awesome icons}
     */
    iconCls?: string,

    /**
     * Called when clicked. It is wrapped in an error handler.
     */
    handler: () => Promise<void>,
};