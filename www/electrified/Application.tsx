import {RestfuncsClient} from "restfuncs-client";
import {createRoot} from "react-dom/client";
import React from "react";

import {
    better_fetch,
    Clazz, errorToString, fixErrorStack,
    isPVEDarkTheme,
    returnWithErrorHandling, showBlueprintDialog, showErrorDialog,
    showResultText,
    spawnAsync, TestComponent, throwError, topLevel_withErrorLogging,
    spawnWithErrorHandling, showMuiDialog, withLoadingDialog, InfoTooltip, messageBox, getCookieByName
} from "./util/util";
import {generated_pluginList as pluginList} from "../_generated_pluginList";
import {
    fixPluginClass,
    initialize_nodeConfig_and_datacenterConfig,
    initialize_userConfig,
    Plugin,
    PluginClass, TreeColumn
} from "./Plugin"
import {Guest} from "./model/Guest";
import {Qemu} from "./model/Qemu";
import {Lxc} from "./model/Lxc";
import {Node} from "./model/Node";
import {Datacenter} from "./model/Datacenter";
import {AsyncConstructableClass} from "./util/AsyncConstructableClass";
import type {ElectrifiedSession} from "pveme-nodejsserver/ElectrifiedSession";
import {showPluginManager} from "./ui/PluginManager";
import {ElectrifiedJsonConfig} from "pveme-nodejsserver/Common";
import {retsync2promise} from "proxy-facades/retsync";
import {createElement} from "react";
import {ElectrifiedFeaturesPlugin} from "./ElectrifiedFeaturesPlugin";
import {watchedComponent} from "react-deepwatch";
import {ErrorBoundary} from "react-error-boundary";
import {Icon, Tooltip} from "@blueprintjs/core";
import {Pool} from "./model/Pool";
import {Ext} from "./classicGlobalObjects";

let app: Application | undefined = undefined;

export class Application extends AsyncConstructableClass{

    protected _datacenter?: Datacenter

    /**
     * Live model, (live like {@see datacenter})) of current node where this web frontend is currently hosted.
     * <p>This field as already available before initWhenLoggedOn. It does not have full functionality then</p>
     */
    currentNode!: Node;

    loginData?: {
        CSRFPreventionToken: string

        /**
         * Capabilities (permissions).
         * <p>Note, these are not updated since the last login.</p>
         */
        cap: UserCapabilities

        clustername: string
        ticket: string
        /**
         * i.e. root@pam
         */
        username: string
    }

    /**
     * /etc/pve/local/electrified.json
     *
     */
    get electrifiedJsonConfig(): ElectrifiedJsonConfig {
        return this.currentNode.getFile(ElectrifiedJsonConfig.filePath).jsonObject as ElectrifiedJsonConfig // TODO create if it doesnt exist, like with plugins
    }


    /**
     * All classes are listed here, so they can be used in Plugins Because import {...} from "pvee-ui" does not work because of some vite/esbuild limitations.
     * <p>
     *     This way, you can at least create local classes inside a Plugin by:
     *     <pre><code>
     *     class MyQemuClass extends this.app.classes.model.Qemu {
     *         myOvverriddenMethod() {}
     *     }</code></pre>
     * </p>
     */
    classes= {
        /**
         * Category
         */
        model: {
            Datacenter, Node, Pool, Guest, Qemu, Lxc
        },
        Plugin
    }

    util = {
        errorToString, topLevel_withErrorLogging, spawnAsync, showErrorDialog, spawnWithErrorHandling, returnWithErrorHandling,
        ui: {
            showBlueprintDialog,
            showMuiDialog,
            withLoadingDialog,
            isPVEDarkTheme,
            InfoTooltip,
            confirm,
            messageBox,
        }
    }

    /**
     * Classic proxmox's Ext.js workspace component
     */
    workspace!: any;

    private _plugins=  new Map<PluginClass, Plugin>();

    webBuildState!: Awaited<ReturnType<ElectrifiedSession["getWebBuildState"]>>

    /**
     * The live model of things in the datacenter live means, as soon, as the state on the server changes, i.e. a corresponding config file changes, it will be file-watched and pushed to here immediately.
     */
    get datacenter(): Datacenter {
        if(!this._datacenter) {
            throw new Error("Application has not been fully initialized yet (initWhenLoggedOn not yet called)")
        }
        return this._datacenter;
    }

    get plugins(){
        return [...this._plugins.values()];
    }

    getPluginByClass(clazz: PluginClass) {
        return this._plugins.get(clazz);
    }

    /**
     *
     * @param name the full name: pveme-ui-plugin-...
     */
    getPluginByName(name: string): Plugin | undefined {
        return this.plugins.find(p => p.packageName === name);
    }

    registerPlugin(pluginClass: PluginClass, packageName: string) {
        pluginClass = fixPluginClass(pluginClass);

        if(this.getPluginByClass(pluginClass)) { // Already registered
            return;
        }

        pluginClass.packageName = packageName;

        const plugin = new pluginClass(this);

        // Workaround: Because the base constructor is not called, but we still want to define fields there. We create a new base plugin and copy the fields
        const newBasePlugin = new Plugin(this);
        Object.getOwnPropertyNames(newBasePlugin).forEach(propName => {
            if(!plugin.hasOwnProperty(propName)) { // Field has not been redefined / initialized by subclass?
                //@ts-ignore
                plugin[propName] = newBasePlugin[propName];
            }
        })

        pluginClass.instance = plugin;
        this._plugins.set(pluginClass, plugin);

    }

    protected unregisterPlugin(plugin: Plugin,) {
        this._plugins.delete(plugin.constructor as PluginClass)
    }

    async showPluginManager() {
        await showPluginManager();
    }


    async constructAsync() {
        console.log("Starting Proxmox VE Manager electrified");

        (window as any).electrifiedApp = app = this; // Make available for other modules

        this.currentNode = await Node.create({name: (window as any).Proxmox.NodeName || throwError("Proxmox.NodeName not set")});

        const electrifiedApi = this.currentNode.electrifiedApi;

        this.webBuildState = await electrifiedApi.getWebBuildState();

        // Subscribe to event and reload the page when a new build is triggered:
        await this.currentNode.electrifiedClient.withReconnect(() => electrifiedApi.onWebBuildStart(() => {window.location.reload()}));

        // Create and register ElectrifiedFeaturesPlugin:
        const electrifiedFeaturesPlugin = new ElectrifiedFeaturesPlugin(this);
        ElectrifiedFeaturesPlugin.instance = electrifiedFeaturesPlugin;
        this._plugins.set(ElectrifiedFeaturesPlugin, electrifiedFeaturesPlugin);

        // Create and register user plugins:
        for(const entry of pluginList) {
            try {
                this.registerPlugin(entry.pluginClass, entry.packageName);
            }
            catch (e) {
                await showErrorDialog(new Error(`Error registering plugin ${entry.packageName}. Path: ${entry.diagnosis_sourceDir || ""}`, {cause: e})); // Show a dialog instead of crashing the whole app which prevents the user from reconfiguring plugins
            }
        }

        // call plugin's.earlyInit:
        for(const plugin of this.plugins) {
            try {
                await plugin.earlyInit();
            }
            catch (e) {
                await showErrorDialog(e); // Show a dialog instead of crashing the whole app which prevents the user from reconfiguring plugins
            }
        }

        this.setup_logoutPropagation();

        // Start the classic app:
        Ext.onReady(async () => {
            Ext.create('PVE.StdWorkspace');
        });

        window.document.title = `${this.currentNode.name} - PVE`;
    }

    /**
     * Called after login or on start, with valid login ticket
     */
    async initWhenLoggedOn() {

        // Wait till the first data is available in this.resourcestore:
        if(this._resourceStore.getNodes().length === 0) {
            await new Promise((resolve, reject) => {
                this._resourceStore.on("datachanged", resolve);
            })
        }

        await this.currentNode._initWhenLoggedOn();


        this._datacenter = await Datacenter.create();

        if(this.userIsAdmin) {
            await retsync2promise(() => this.electrifiedJsonConfig); // Fetch this once, so the next access can be without retsync
        }

        // Init plugins:
        for(const plugin of this.plugins) {
            try {
                await initialize_userConfig(plugin);
                await initialize_nodeConfig_and_datacenterConfig(plugin);

                if(plugin.needsAdminPermissions && !this.userIsAdmin) { // Plugin makes no sense without enough permissions?
                    this.unregisterPlugin(plugin);
                    continue;
                }

                await plugin.init();
                await plugin._validate();
            }
            catch (e) {
                this.unregisterPlugin(plugin);
                await showErrorDialog(new Error(`Error initializing plugin ${plugin.name}. See cause.`, {cause: e})); // Show a dialog instead of crashing the whole app which prevents the user from reconfiguring plugins
            }
        }

        // Warn, when theme explicitly set
        if(getCookieByName( "PVEThemeCookie") === "proxmox-dark") {
            await messageBox(t`Dark theme set`, t`You've set the dark them explicitly. Some electrified features won't be displayed properly. Please set it to auto and set up your browser/os to prefer dark mode.`, "warning-sign");
        }


        this.plugins.forEach(p => p.onUiReady()); // TODO: Remove this line here and call it from the right place
    }

    /**
     * Called by workspace after login or on start, with valid login ticket
     * @param loginData
     */
    onLogin(loginData: Application["loginData"]) {
        if(this.loginData) { // User logged out and re-logged in
            window.location.reload(); // Cause the File/Node/etc. objects can't deal with a potential different user and changed permissions or with beeing teporary logged out. And there's no cleanup for the whole app implemented.
        }
        this.loginData = loginData;

        spawnWithErrorHandling(async () => {
            await this.initWhenLoggedOn();
        });
    }

    /**
     * Sets up faster logout propagation. Useful for vite-devserver mode
     * @protected
     */
    protected setup_logoutPropagation() {
        // Patch Proxmox.Utils.authClear function:
        const orig_authClear = (window as any).Proxmox.Utils.authClear as () => void;
        (window as any).Proxmox.Utils.authClear = async () => {
            orig_authClear();
            await this.currentNode.electrifiedApi.clearCachedPermissions();
        }
    }

    get isDarkTheme() {
        return isPVEDarkTheme();
    }

    /**
     * Internal. The PVE.data.ResourceStore
     */
    get _resourceStore(): any {
        return (window as any).PVE.data.ResourceStore;
    }

    /**
     * @param englishText
     * @returns Text, translated into the current ui language. Uses the electrified text repo
     */
    getText(englishText: string) {
        // TODO: create an electrified and plugin-wide text repo and look up text there
        //@ts-ignore
        return window.gettext(englishText); //
    }

    /**
     * @param englishTextsTokens
     * @returns Text, translated into the current ui language. Uses the electrified text repo
     */
    getTranslatedTextWithTags(englishTextsTokens: TemplateStringsArray, ...values: any[]) {
        // Mostly duplicate code in this method

        // Compose textWithPlaceholders in the form "some text $0 has $1 something"
        let textWithPlaceholders = "";
        for(let i =0;i<englishTextsTokens.length;i++) {
            if(i > 0) {
                textWithPlaceholders+="$" + (i-1); // add $n
            }
            textWithPlaceholders+=englishTextsTokens[i];
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
     * @returns true if user has Sys.Console permission, so basically is allowed to use all the electrified features like writing to any file.
     */
    get userIsAdmin() {
        if(!this.loginData) {
            throw new Error("User not yet logged on");
        }
        return this.loginData.cap.nodes["Sys.Console"] === 1
    }

    /**
     * Calls the pve2 api. The api can be browsed here: {@link https://pve.proxmox.com/pve-docs/api-viewer/}.
     * <p>
     *      Example: <code>const result = await electrifiedApp.api2fetch("POST", "/nodes/myPve/lxc/820/status/stop", {skiplock: true}); // stops the guest 820 while ignoring locks</code>
     * </p>
     * @param method
     * @param url path after /api2/json. Must begin with a /
     * @param params booleans will be converted to "1" or "0". undefineds will be omitted.
     * @returns the json result
     * @see Node#electrifiedClient
     */
    async api2fetch(method: "GET" | "POST" | "PUT" | "DELETE", url: string, params?: Record<string, unknown>): Promise<unknown> {
        // Validity check:
        if(!url.startsWith("/")) {
            throw new Error("Url must start with /");
        }

        // Docs: https://pve.proxmox.com/wiki/Proxmox_VE_API

        // Convert params to stringParams:
        const stringParams: Record<string, string> = {};
        Object.keys(params || {}).forEach(key => {
            //@ts-ignore
            let value:unknown = params[key];

            // Do conversions:
            if(value === undefined) {
                return;
            }
            if(value === true) {
                value = "1";
            }
            else if(value === false) {
                value = "0";
            }

            stringParams[key] = "" + value;
        });

        url = `/api2/json${url}${method==="GET"?("?" + new URLSearchParams(stringParams).toString()):""}`;
        const init: RequestInit = {
            method,
            headers: {
                "CSRFPreventionToken": this.loginData?.CSRFPreventionToken || (window as any).Proxmox.CSRFPreventionToken || throwError("SRFPreventionToken not set"),
            },
            body: (method !== "GET"?new URLSearchParams(stringParams):undefined)
        }

        const fetchResult = await better_fetch(url, init);
        const jsonResult = await fetchResult.json();
        if(!jsonResult || typeof jsonResult !== "object" || Object.hasOwnProperty(jsonResult.data)) {
            throw new Error(`Illegal return value. url: ${url}, result: ${jsonResult}`);
        }
        return jsonResult.data;
    }


    /**
     * Called by classic code to add / rearrange menu items and spacers
     * @param extJsMenuItems
     */
    _addElectrifiedMenuItems<I>(contextObj: object, extJsMenuItems: any[]) {
        return [...extJsMenuItems, ...this.plugins.map(p => p._getMenuItems(contextObj)).flat()];
    }

    _addGuestElectrifiedMenuItems(info: any,extJsMenuItems: any[] ) {
        return returnWithErrorHandling(() => {
            const contextObj = this.datacenter.getNode_existing(info.node).getGuest_existing(info.vmid);
            return this._addElectrifiedMenuItems(contextObj, extJsMenuItems);
        })
    }

    /**
     * Export these functions to classic pve code
     */
    _react = {
        createRoot, createElement
    };

    _createResourceTreeCellComponent(treeColumn: TreeColumn) {
        const Component = watchedComponent(treeColumn.cellRenderFn, {fallback: t`loading...`})
        //const Component = treeColumn.cellRenderFn

        /**
         * Another Wrapper, so we have a better error ui when _getItemForResourceRecord fails
         * @param props
         * @constructor
         */
        const OuterComponent = (props: any) => {
            if(!this._datacenter) {
                return t`Initializing...`
            }
            const item = this.datacenter._getItemForResourceRecord(props.rawItemRecord);
            return <Component {...props} item={item}/>
        }

        const errorRender= (props: { error: Error }) => {
            fixErrorStack(props.error)
            const fullError = errorToString(props.error);

            const onClick = () => {
                showResultText(fullError, props.error.message, "error");
                setTimeout(() => { // not in the thread that's caught by reacts error handler
                    throw props.error // ### Don't look here, this line is just the error reporter! ### / Show error to console so the javascript source mapping will be resolved
                })
            }

            return <Tooltip content={"Click to show full error"}>
                <a style={{cursor: "pointer"}} onClick={onClick}>
                    <Icon icon={"error"} size={14}/>
                </a>
            </Tooltip>
        }

        /**
         * Outer result component with error boundary
         * @param props
         * @constructor
         */
        const Result = (props: any)=> {
            return <ErrorBoundary fallbackRender={errorRender}><OuterComponent {...props}/></ErrorBoundary>
        }
        return Result;
    }
}

spawnWithErrorHandling(async () => {
    await Application.create();
})


type UserCapabilities = {
    "mapping": {
        "Mapping.Audit"?: (0|1),
        "Permissions.Modify"?: (0|1),
        "Mapping.Modify"?: (0|1),
        "Mapping.Use"?: (0|1)
    },
    "nodes": {
        "Sys.Modify"?: (0|1),
        "Sys.Incoming"?: (0|1),
        "Sys.AccessNetwork"?: (0|1),
        "Permissions.Modify"?: (0|1),
        "Sys.PowerMgmt"?: (0|1),
        "Sys.Console"?: (0|1),
        "Sys.Audit"?: (0|1),
        "Sys.Syslog"?: (0|1)
    },
    "storage": {
        "Datastore.Audit"?: (0|1),
        "Datastore.AllocateTemplate"?: (0|1),
        "Datastore.AllocateSpace"?: (0|1),
        "Permissions.Modify"?: (0|1),
        "Datastore.Allocate"?: (0|1)
    },
    "sdn": {
        "SDN.Audit"?: (0|1),
        "Permissions.Modify"?: (0|1),
        "SDN.Allocate"?: (0|1),
        "SDN.Use"?: (0|1)
    },
    "dc": {
        "SDN.Audit"?: (0|1),
        "SDN.Use"?: (0|1),
        "Sys.Modify"?: (0|1),
        "SDN.Allocate"?: (0|1),
        "Sys.Audit"?: (0|1)
    },
    "vms": {
        "VM.Monitor"?: (0|1),
        "VM.Config.Options"?: (0|1),
        "VM.Migrate"?: (0|1),
        "VM.Config.Cloudinit"?: (0|1),
        "VM.Config.CDROM"?: (0|1),
        "VM.Config.Memory"?: (0|1),
        "VM.Allocate"?: (0|1),
        "VM.PowerMgmt"?: (0|1),
        "VM.Config.Network"?: (0|1),
        "VM.Clone"?: (0|1),
        "VM.Snapshot.Rollback"?: (0|1),
        "VM.Backup"?: (0|1),
        "VM.Config.HWType"?: (0|1),
        "VM.Config.Disk"?: (0|1),
        "Permissions.Modify"?: (0|1),
        "VM.Audit"?: (0|1),
        "VM.Console"?: (0|1),
        "VM.Snapshot"?: (0|1),
        "VM.Config.CPU"?: (0|1)
    },
    "access": {
        "Permissions.Modify"?: (0|1),
        "User.Modify"?: (0|1),
        "Group.Allocate"?: (0|1)
    }
}

/**
 * Translates text into the current ui language. It looks it up in the electrified translation repo.
 * It uses the "taged template" syntax which allows to easily inert variables.
 * <p>
 *     Usage example: <code>t`You have ${numberOfUnread} unread messages`</code>
 * </p>
 * TODO: create an electrified and plugin-wide text repo and look up text there
 * @param englishTextTokens
 * @param values
 */
function t(englishTextTokens: TemplateStringsArray, ...values: any[]) {
    return app!.getTranslatedTextWithTags(englishTextTokens, ...values);
}