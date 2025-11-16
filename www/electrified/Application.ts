import {RestfuncsClient} from "restfuncs-client";

import {
    Clazz, errorToString,
    isPVEDarkTheme,
    returnWithErrorHandling, showBlueprintDialog, showErrorDialog,
    showResultText,
    spawnAsync,
    withErrorHandling
} from "./util/util";
import {generated_pluginList as pluginList} from "../_generated_pluginList";
import {fixPluginClass, initializePluginConfigs, Plugin, PluginClass} from "./Plugin"
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

export class Application extends AsyncConstructableClass{


    /**
     * The live model of things in the datacenter live means, as soon, as the state on the server changes, i.e. a corresponding config file changes, it will be file-watched and pushed to here immediately.
     */
    datacenter!: Datacenter

    /**
     * Live model, (live like {@see datacenter})) of current node where this web frontend is currently hosted.
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
     * /etc/pve-local/electrified.json
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
            Guest, Qemu, Lxc
        },
        Plugin
    }

    util = {
        ui: {
            showBlueprintDialog
        }
    }

    /**
     * Classic proxmox's Ext.js workspace component
     */
    workspace!: any;

    private _plugins=  new Map<PluginClass, Plugin>();

    webBuildState!: Awaited<ReturnType<ElectrifiedSession["getWebBuildState"]>>

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

        this.datacenter = await Datacenter.create();
        this.currentNode = await Node.create(); // TODO use datacenter.nodes[...]

        const electrifiedApi = this.currentNode.electrifiedApi;
        const webBuildState = this.webBuildState = await electrifiedApi.getWebBuildState();

        // Subscribe to event and reload the page when a new build is triggered:
        await this.currentNode.electrifiedClient.withReconnect(() => electrifiedApi.onWebBuildStart(() => {window.location.reload()}));

        app = this;

        // Register plugins:
        for(const entry of pluginList) {
            try {
                this.registerPlugin(entry.pluginClass, entry.packageName);
            }
            catch (e) {
                await showErrorDialog(new Error(`Error registering plugin ${entry.packageName}. Path: ${entry.diagnosis_sourceDir || ""}`, {cause: e})); // Show a dialog instead of crashing the whole app which prevents the user from reconfiguring plugins
            }
        }


        (window as any).electrifiedApp = this; // Make available for classic code

        this.setup_logoutPropagation();

    }

    /**
     * Called after login or on start, with valid login ticket
     */
    async initAfterLogin() {
        // Bug workaround: vite-devserver connection was rejected, because it had no/outdated permissions, cause they were not initialized yet.
        const electrifiedApi = this.currentNode.electrifiedApi;
        if(!this.webBuildState.builtWeb.buildOptions.buildStaticFiles && !(await electrifiedApi.permissionsAreUp2Date())) { // Using vite-devserver but permissions are not up2date?
            try {
                await electrifiedApi.ping(); // Force permissions to be up2date if there's a valid login
            }
            catch (e) {
            }

            if (await electrifiedApi.permissionsAreUp2Date()) { // but **now** they have become valid?
                // We realized that the vite-devserver connection must had failed because it saw none/outdated permissions. This occurs i.e. during nodejsserver development when restarting the server.

                window.location.reload();
            }
        }
        if(this.userIsAdmin) {
            await retsync2promise(() => this.electrifiedJsonConfig); // Fetch this once, so the next access can be without retsync
        }

        // Init plugins:
        for(const plugin of this.plugins) {
            try {
                await initializePluginConfigs(plugin);

                if(plugin.needsAdminPermissions && !this.userIsAdmin) { // Plugin makes no sense without enough permissions?
                    this.unregisterPlugin(plugin);
                    continue;
                }

                await plugin.init();
            }
            catch (e) {
                this.unregisterPlugin(plugin);
                await showErrorDialog(new Error(`Error initializing plugin ${plugin.name}. See cause.`, {cause: e})); // Show a dialog instead of crashing the whole app which prevents the user from reconfiguring plugins
            }
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

        spawnAsync(async () => {
            await this.initAfterLogin();
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
     * Called by classic code to add / rearrange menu items and spacers
     * @param extJsMenuItems
     */
    _addElectrifiedMenuItems<I>(contextObj: object, extJsMenuItems: any[]) {
        return {...extJsMenuItems, ...this.plugins.map(p => p._getMenuItems(contextObj)).flat()};
    }

    _addGuestElectrifiedMenuItems(info: any,extJsMenuItems: any[] ) {
        return returnWithErrorHandling(() => {
            const contextObj = this.datacenter.getNode_existing(info.node).getGuest_existing(info.vmid);
            return this._addElectrifiedMenuItems(contextObj, extJsMenuItems);
        })
    }
}
export let app: Application

export function gettext(text: string) {
    return app.getText(text);
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
export function t(englishTextTokens: TemplateStringsArray, ...values: any[]) {
    return app.getTranslatedTextWithTags(englishTextTokens, ...values);
}

withErrorHandling(async () => {
    const promise = Application.create();
    (window as any).electrifiedAppPromise =  promise;
    await promise; // Await it to provide error handling
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