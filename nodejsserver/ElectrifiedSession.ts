import {ServerSession, CommunicationError} from "restfuncs-server";
import {remote} from "restfuncs-server";
import {ServerSessionOptions} from "restfuncs-server";
import {appServer} from "./server.js";
import WebBuildProgress, {BuildOptions} from "./WebBuilder.js";
import {axiosExt, deleteDir, errorToHtml, spawnAsync, newDefaultMap, fileExists} from "./util/util.js";
import {rmSync} from "fs";
import fs from "node:fs";
import path from "node:path";
import fsPromises  from "node:fs/promises";
import {execa, StdioOption} from "execa";
import {Request} from "express";
import {RemoteMethodOptions} from "restfuncs-server";
import _ from "underscore";
import chokidar from "chokidar";
import {ClientCallbackSet} from "restfuncs-server";
import {Buffer} from "node:buffer";
import {Readable as ReadableStream} from "stream";

//import {ServerSocketConnection} from "restfuncs-server";
type ServerSocketConnection = any; // Bug workaround: Don't know why the above line causes typescript-rtti to emit an `import ... from /dist/commonjs/index`. Does not look different than with i.e. ServerSesssion

export class ElectrifiedSession extends ServerSession {
    static options: ServerSessionOptions = {
        exposeErrors: true, // It's an open source project so there's no reason to hide the stracktraces
        exposeMetadata: true,
        logErrors: false, // They're fully reported to the client, so no need to also log them in production
        devDisableSecurity: (process.env.NODE_ENV === "development"), // Set to a fix value because the vite build changes this to "production" during runtime)

        /**
         * Security: The default: "Client-decided" is not sufficient in this situation, because the login does not happen in this session, so an uninitialized ElectrifiedSession(/Restfuncs session) but with existing pveAuthCookie could still be used.
         * So we set this to a strong level. Still, token fetching for manual fetch is not needed to be implemented because the browser's origin header is sufficiently fine;)
         *
         * Next thought: the pveAuthCookie credential is same-site anyway, so if you assume that permission querying and caching can only be invoked through safe calls (controled by same-site content) which initializes the session with `corsReadToken` level.
         * But do we know all possible call situations? So explicit seems safer.
         */
        csrfProtectionMode: "corsReadToken"
    }

    private static remoteMethodsThatNeedNoPermissions: (keyof ElectrifiedSession)[] = ["getWebBuildState","permissionsAreUp2Date", "clearCachedPermissions", "diagnosis_canAccessWeb", "onWebBuildStart", "getResourceStats"];

    static defaultRemoteMethodOptions: RemoteMethodOptions = {validateResult: false}

    protected static browserWindows = new Map<ServerSocketConnection, BrowserWindow>();

    /**
     * Permission object with all privileges listed, see https://pve.proxmox.com/wiki/User_Management # Privileges
     * @see #requirePermission
     */
    protected cachedPermissions?: {permissions: Record<string, Record<string, number>>, lastRetrievedTime: number}

    /**
     * ... can be called without being logged in
     */
    @remote({isSafe: true,validateResult: false})
    async getWebBuildState() {

        // Refresh permission state:
        if(this.cachedPermissions) {
            // Likely logged in, so the following should go quick:
            try {
                await this.ensurePermissionsAreUp2Date();
            }
            catch (e) {}
        }

        // Determine pluginSourceProjects:
        let pluginSourceProjects: any;
        try {
            pluginSourceProjects = WebBuildProgress.getUiPluginSourceProjects_fixed();
        }
        catch (e) {
            pluginSourceProjects = (e as any)?.message; // expose quick error message here. The full error will be available when doing the build anyway
        }

        return {
            developWwwBaseDir: appServer.config.developWwwBaseDir,
            wwwSourceDir: appServer.wwwSourceDir,
            bundledWWWDir: appServer.bundledWWWDir,
            exampleUiPluginProjectExist: fs.existsSync(`${appServer.config.pluginSourceProjectsDir}/example`),
            pluginSourceProjects,
            builtWeb: {
                buildOptions: appServer.builtWeb.buildOptions,
                buildId: appServer.builtWeb.buildId,
                diagnosis_createdAt: appServer.builtWeb.diagnosis_createdAt,
                diagnosis_state: appServer.builtWeb.diagnosis_state,
                promiseState: {
                    state: appServer.builtWeb.promiseState.state,
                    rejectReason: appServer.builtWeb.promiseState.state === "rejected"?errorToHtml(appServer.builtWeb.promiseState.rejectReason):undefined,
                },
            },
            hasPermissions: this.cachedPermissions?.permissions["/"]["Sys.Console"] === 1,
            viteDevServer_allowUnauthorizedClients: appServer.viteDevServer_allowUnauthorizedClients,
            NODE_ENV: process.env.NODE_ENV,
        };
    }

    @remote()
    async rebuildWebAsync(buildOptions: BuildOptions) {
        spawnAsync(async () => {
            await appServer.buildWeb(buildOptions)
        }, false);
    }

    @remote setViteDevServer_allowUnauthorizedClients(newValue: boolean) {
        appServer.viteDevServer_allowUnauthorizedClients = newValue;
    }

    @remote async setNodeEnv(newValue: string) {
        const hasChanged = newValue !== process.env.NODE_ENV;
        process.env.NODE_ENV = newValue;

        if(hasChanged) {
            await appServer.viteDevServer?.restart();
        }
    }

    @remote async onWebBuildStart(listener: ()  => void) {
        // This method needs no permissions

        appServer.webBuildStartListeners.add(listener);
    }

    /**
     * Clears all node_modules and resets the package-lock.json to the original, how is was published by the pve-manager-electrified debian package
     */
    @remote()
    async resetNode_modules() {
        await deleteDir(`${appServer.wwwSourceDir}/node_modules`, true);
        //rmSync(`${appServer.wwwSourceDir}/package-lock.json`, {force: true}); // no need to delete, because it always stays the original
    }

    @remote
    async disablePluginsAndRebuildClean() {
        await this.resetNode_modules();
        appServer.buildWeb({...appServer.builtWeb.buildOptions, enablePlugins: false});
    }

    /**
     * Copies the files into /root/pveme-plugin-source-projects/example
     */
    @remote
    async createUiPluginProject(name: string) {
        const targetDir = `${appServer.config.pluginSourceProjectsDir}/${name}`
        if(fs.existsSync(targetDir)) {
            return;
        }
        await execa("mkdir", ["-p", targetDir]);
        await execa("cp", ["-r", "-a", `${appServer.config.examplePluginDir}/.`, targetDir])

        WebBuildProgress.getUiPluginSourceProjects_fixed(); // Fix the name in package.json
    }

    /**
     * Uninstalls this pve-manager-electrified debian package
     */
    @remote
    async uninstallPveme() {
        throw new Error("Not yet implemented. Please exec manually: apt install -y pve-manager-electrified- pve-manager+");
        // TOOD: spawning a detached process still seems not working. Instead use the pve api and spawn some sort of task
        execa("/bin/sh", ["-c", "apt install -y pve-manager-electrified- pve-manager+"],{
            detached: true,
        });
    }

    protected async doCall(remoteMethodName: string, args: unknown[]): Promise<any> {
        if(!ElectrifiedSession.remoteMethodsThatNeedNoPermissions.includes(remoteMethodName as any)) { // non whitelisted method?
            await this.checkPermission("/", "Sys.Console");
        }
        return super.doCall(remoteMethodName, args);
    }



    /**
     * Throws an error, if the current logged on user does not have the permission.
     * Will automatically refresh non-up2date permissions.
     * Example: await this.checkPermission("/", "Sys.Console");
     * @param path currently only general paths are supported
     * @param permission Permission from, see https://pve.proxmox.com/wiki/User_Management # Privileges
     * @protected
     */
    protected async checkPermission(path: string, permission: string) {
        await this.ensurePermissionsAreUp2Date();

        return this.checkCachedPermission(path, permission);
    }

    /**
     * Use this one in a sync only situations. Otherwise prefer checkPermission which can refresh non-up2date permissions.
     * <p>Also internally used.</p>
     * @param path
     * @param permission
     */
    checkCachedPermission(path: string, permission: string) {
        if(!this.cachedPermissions) {
            // Throw error:
            const error = new CommunicationError("Not logged in", {httpStatusCode: 401});
            error.name = "NotLoggedInError";
            throw error;
        }

        if(!this.permissionsAreUp2Date()) {
            throw new Error("Permissions are not up 2 date. Try to re-load the page or re-login.");
        }

        if(this.cachedPermissions!.permissions[path] === undefined) {
            throw new CommunicationError(`You don't have the required permission: ${path}/${permission}${path !== "/"?". The path does not exists. Special paths are not implemented yet":""}`, {httpStatusCode: 401});
        }

        if(this.cachedPermissions!.permissions[path][permission] === 1) {
            return true;
        }

        throw new CommunicationError(`You don't have the required permission: ${path}/${permission}`, {httpStatusCode: 401});
    }

    /**
     * Makes sure, this.cachedPermissions is up2date.
     * May throw a not logged in error
     * @private
     */
    @remote
    async ensurePermissionsAreUp2Date() {
        if (!this.permissionsAreUp2Date()) { // Permissions not fetched or outdated ?
            if(!this.call.req) { // Non http (websocket)
                const error = new CommunicationError("Need to refresh permissions via http");
                error.name= "NeedToRefreshPermissionsViaHttp"; // Flag it for the client to recognize
                throw error;
            }

            const queriedPermissions = await ElectrifiedSession.queryPermissions(this.call.req);
            if (queriedPermissions === undefined) {
                this.cachedPermissions = undefined;
                // Throw error:
                const error = new CommunicationError("Not logged in", {httpStatusCode: 401});
                error.name = "NotLoggedInError";
                throw error;
            }
            this.cachedPermissions = {permissions: queriedPermissions, lastRetrievedTime: new Date().getTime()}
        }
    }

    @remote permissionsAreUp2Date() {
        const permissionCacheMaxAgeMs = appServer.config.permissionCacheMaxAgeMs[appServer.useViteDevServer?"dev":"prod"];
        return ! (!this.cachedPermissions || (new Date().getTime() - this.cachedPermissions.lastRetrievedTime > permissionCacheMaxAgeMs));
    }

    @remote clearCachedPermissions() {
        this.cachedPermissions = undefined;
    }

    @remote async diagnosis_canAccessWeb() {
        if(appServer.useViteDevServer && !appServer.viteDevServer_allowUnauthorizedClients) {
            const cachePermissionsWereOutDated = !this.permissionsAreUp2Date();
            try {
                await this.checkPermission("/", "Sys.Console");
                if(cachePermissionsWereOutDated) {
                    return "cachePermissionsWereOutDated"; // Signal this to the client
                }
                return true;
            }
            catch (e) {
                return false;
            }
        }
        else {
            return true;
        }
    }

    /**
     * Queries them from the original server
     * @protected
     * @return Permission object with all privileges listed, see https://pve.proxmox.com/wiki/User_Management # Privileges, undefined when not logged on
     */
    private static async queryPermissions(req: Request): Promise<Record<string,Record<string, number>> | undefined> {
        try {
            return ((await axiosExt(`https://ip6-localhost:${appServer.config.origPort}/api2/json/access/permissions`, {
                headers: {cookie: req.headers.cookie}, // Pass original headers (with cookies), so we pass the right pveAuthCookie
            })).data as any).data as any;
        }
        catch(e) {
            if((e as any)?.status === 401) { // No ticket?
                return undefined;
            }
            throw e;
        }
    }

    /**
     * Requires auth. So this will also query/refresh the permissions
     */
    @remote
    ping() {

    }

    static async getFileStat(path: string): Promise<FileStats | false> {
        try {
            const result = await fsPromises.stat(path);
            return {
                ...result,
                // include evaluated version of all isXXX() methods;
                isFIFO: result.isFIFO(),
                isFile: result.isFile(),
                isDirectory: result.isDirectory(),
                isBlockDevice: result.isBlockDevice(),
                isCharacterDevice: result.isCharacterDevice(),
                isSocket: result.isSocket(),
                isSymbolicLink: result.isSymbolicLink()
            }
        }
        catch (e) {
            return false;
        }
    }

    @remote async getFileStat(path: string) {
        return ElectrifiedSession.getFileStat(path);
    }


    @remote async getFileContent(path: string, encoding: BufferEncoding): Promise<string>{
        return await fsPromises.readFile(path, {encoding});
    }

    /**
     * ... + creates the parent dirs if necessary
     * @param filePath
     * @param newContent
     * @param encoding
     */
    @remote async setFileContent(filePath: string, newContent: string, encoding: BufferEncoding) {
        // Safety check / write allowed?:
        if(path.normalize(filePath).startsWith("/etc/pve/")) {
            await appServer.checkPveDirIsMounted();
        }

        const parentDir = path.dirname(filePath);
        if(!await fileExists(parentDir)) {
            await fsPromises.mkdir(parentDir, {recursive: true}); // Create parent dir
        }
        return await fsPromises.writeFile(filePath, newContent,{encoding});
    }

    @remote async removeFile(path: string) {
        await fsPromises.rm(path, {recursive: true})
    }

    /**
     * ...with UTF8 file name encoding
     * @param path
     */
    @remote async getDirectoryContents(path: string) {
        const fileStat = await ElectrifiedSession.getFileStat(path);
        if(fileStat === false) {
            throw new Error(`Directory ${path} does not exist`);
        }
        if(!fileStat.isDirectory) {
            throw new Error(`Not a directory: ${path}`);
        }

        return await fsPromises.readdir(path, {encoding: "utf8"})
    }

    /**
     * path -> ClientCallbacks (+ also the chokidar file watchers are created internally)
     * Bug worakound: ":any" because typescript-rtti tries to follow the type and creates a broken import statement: "import ... from "restfuncs-server/dist/commonjs/..."
     * @protected
     */
    protected static fileWatchers: any = newDefaultMap((path: string)=> {
        const clientCallbacks = new ClientCallbackSet<[stat: Awaited<ReturnType<ElectrifiedSession["getFileStat"]>>]>();

        // Also create the watcher here, now that we are on a one-per file invocation. Low prio TODO: remove this watcher when all clients are disconnected
        const watcher = chokidar.watch(path, {
            persistent: false, atomic: true,
            ignoreInitial: true,
            depth:0, // For directories, only the first child level
        });
        ['add','change', 'unlink','addDir', 'unlinkDir'].forEach(async (eventName) => {
            (watcher as any).on(eventName, async (trigger_path?: any) => {
                const fileStat = await ElectrifiedSession.getFileStat(path);
                console.log("changeevent path: " + path + "; trigger_path:" + trigger_path + ": " + eventName + " stat: " + JSON.stringify(fileStat));
                clientCallbacks.call(fileStat);
            });
        });

        return clientCallbacks;
    })

    /**
     * Informs you when a file content was changes, or it was added or deleted
     * @param path
     * @param callback
     */
    @remote onFileChanged(path: string, callback: (stat: Awaited<ReturnType<ElectrifiedSession["getFileStat"]>>) => void) {
       ElectrifiedSession.fileWatchers.get(path).add(callback);
    }

    @remote offFileChanged(path: string, callback: (stat: Awaited<ReturnType<ElectrifiedSession["getFileStat"]>>) => void) {
        ElectrifiedSession.fileWatchers.get(path).remove(callback);
    }

    /**
     * Execute a command. Same arguments as [execa](https://www.npmjs.com/package/execa)
     * @param file
     * @param args
     * @param options. Fields will default to: encoding="utf8", cwd="/tmp/pve/[session-id]"
     */
    @remote async execa(file: string, args?: readonly string[], options?: ExecaOptions): Promise<string> {
        // Check and fix params:
        if(!options) {
            options = {};
        }
        if(options.encoding === null) {
            throw new Error("Encoding was set to null but returning raw buffers is not yetsupported");
        }
        // Default fields:
        //@ts-ignore
        options.encoding = options.encoding || "utf8";
        //@ts-ignore
        options.cwd = options.cwd || await this.getTempDir();

        const result = await execa(file, args, options);
        return result.stdout;
    }

    /**
     * @returns all available plugins from all types (sources, cluster and npm)
     */
    @remote async getPlugins(filterByType: "all" | "installed"): Promise<(PluginPackage & {codeLocation: string, updated?: string})[]> {
        async function fetchNpmRepositoryPackages() {
            // Api description: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md#get-v1search
            const searchTerm = "pveme"; // First, search for all with this term because there is no better filter option
            const url = `${appServer.config.npmRegistryApiBaseUrl}/-/v1/search?text=${encodeURIComponent(searchTerm)}&size=250`;
            const fetchResult = await fetch(url);
            if(fetchResult.status !== 200) {
                throw new Error("Could not fetch packages from NPM registry. Url: " + url);
            }
            const result: {objects: {updated: string, "package": PluginPackage}[]} = await fetchResult.json();
            return result.objects.filter(o => o.package.name.startsWith("pveme-ui-plugin-"));
        }



        async function getInstalledNpmPackages() {
            const result: (PluginPackage & {codeLocation: string})[] = [];
            const selectedPackages = appServer.electrifiedJsonConfig.plugins.filter(p => p.codeLocation === "npm");
             for(const selectedPackage of selectedPackages) {
                 // Try to retrieve package.json content:
                 let pkg: PluginPackage | {} = {};
                 try {
                     if(appServer.builtWeb.promiseState.state === "resolved") { // Web is successfully built?
                         const wwwDir = appServer.builtWeb.promiseState.resolvedValue.staticFilesDir || appServer.wwwSourceDir;
                         pkg = JSON.parse(await fsPromises.readFile(`${wwwDir}/node_modules/${selectedPackage.name}/package.json`, {encoding: "utf8"})) as PluginPackage;
                     }
                 }
                 catch (e) {

                 }

                 result.push({...pkg, name: selectedPackage.name, version: selectedPackage.version, codeLocation: selectedPackage.codeLocation})
             }

             return result;
        }



        const sourcePackages = [
            ...WebBuildProgress.getUiPluginSourceProjects_fixed().map(entry => {return {...(entry.pkg as PluginPackage), codeLocation:"local"}}),
            ...WebBuildProgress.getClusterPackages().map(entry => {return {...(entry.pkg as PluginPackage), codeLocation:"datacenter"}}),
        ];

        if(filterByType === "all") {
            const npmRepositoryPackages = (await fetchNpmRepositoryPackages()).map(e => {return {...e.package, codeLocation: "npm", updated: e.updated}});
            return [...sourcePackages, ...npmRepositoryPackages]
        }
        else if (filterByType === "installed") {
            return [...sourcePackages, ...(await getInstalledNpmPackages())];
        }
        else {
            throw new Error("Illegal argument")
        }
    }

    /**
     *
     * @param packageName
     * @returns Versions, latest version first
     */
    @remote async getNpmPackageVersions(packageName: string): Promise<{version: string}[]> {
        // Api description: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md#get-v1search
        const searchTerm = "pveme"; // First, search for all with this term because there is no better filter option
        const url = `${appServer.config.npmRegistryApiBaseUrl}/${encodeURIComponent(packageName)}`;
        const fetchResult = await fetch(url);
        if(fetchResult.status !== 200) {
            throw new Error("Could not fetch packages version from NPM registry. Url: " + url);
        }
        const result = Object.keys((await fetchResult.json() as any).versions).map(version => {return {version}});
        result.reverse();
        return result;
    }

    /**
     * @returns /tmp/pve/[session-id]. Dir is created.
     */
    @remote async getTempDir() {
        const result = `/tmp/pve/${this.id}`
        if(!await fileExists(result)) {
            await fsPromises.mkdir(result, {recursive: true});
        }
        return result;
    }

    @remote async getResourceStats(browserWindowIsFocused: boolean, needsCpuUsage: boolean) {
        await this.checkPermission("/", "Sys.Audit"); // TODO: check for individual guests and return only those's stats
        const browserWindow = this.getBrowserWindow();
        browserWindow.isFocused = browserWindowIsFocused;
        browserWindow.needsCpuUsage = needsCpuUsage;
        return appServer.guestCpuMeters.getUsage();
    }

    /**
     * @returns Browser window associated with this call's socketconnection
     */
    protected getBrowserWindow() {
        // First, clean up, to prevent resource leak: (NOTE: A Map with weak keys would be more suited)
        [...ElectrifiedSession.browserWindows.keys()].forEach(c => {
            if(c.isClosed()) {
                ElectrifiedSession.browserWindows.delete(c);
            }
        })

        const socketConnection = this.call.socketConnection;
        if(!socketConnection) {
            throw new Error("Not calling via socket");
        }
        let result = ElectrifiedSession.browserWindows.get(socketConnection);
        if(!result) {
            result = new BrowserWindow();
            ElectrifiedSession.browserWindows.set(socketConnection, result);
        }
        return result;
    }

    /**
     * All Browser windows. Assuming the clients have at some time called getBrowserWindow (to store some useful information in there).
     */
    static getBrowserWindows() {
        //  Clean up:
        [...this.browserWindows.keys()].forEach(c => {
            if(c.isClosed()) {
                this.browserWindows.delete(c);
            }
        })

        return [...this.browserWindows.values()];
    }


    /**
     * Copied from Restfuncs, which does not expose it as an API
     * @param req
     */
    static fromRequest_unofficial(req: {session: Record<string, unknown>}): ElectrifiedSession | undefined {
        /**
         * Copied from ServerSesssion#getFixedCookieSessionFromRequest ***
         * @param req
         */
        function getFixedCookieSessionFromRequest(req: {session: Record<string, unknown>}) {
            if (!req.session) { // No session handler is installed (legal use case)
                return undefined;
            }

            // Detect uninitialized session:
            if (!req.session.id) { // Session is not initialized ?
                return undefined;
            }
            const reqSession = req.session as any as Record<string, unknown>;
            // Detect uninitialized session:
            const standardSessionFields = new Set(["id", "cookie", "req"]);
            if (!Object.keys(reqSession).some(key => !standardSessionFields.has(key))) { // Session has only standard fields set ?
                return undefined; // Treat that as uninitialized
            }

            const result: CookieSession = {
                ...reqSession,
                id: req.session.id as string, // Re-query that property accessor (otherwise it does not get included)
                version: (typeof reqSession.version === "number") ? reqSession.version : 0,
                bpSalt: (typeof reqSession.bpSalt === "string") ? reqSession.bpSalt : undefined,
            }

            // Remove internal fields from the cookie handler to safe space / cut references:
            delete result["cookie"];
            delete result["req"]

            return result
        }

        const cookieSession = getFixedCookieSessionFromRequest(req);

        let result = new this();

        {
            // *** Prepare serverSession for change tracking **
            // Create a deep clone of cookieSession: , because we want to make sure that the original is not modified. Only at the very end,
            let cookieSessionClone = _.extend({}, cookieSession || {})// First, make all values own properties because structuredClone does not clone values from inside the prototype but maybe an express session cookie handler delivers its cookie values prototyped.
            cookieSessionClone = structuredClone(cookieSessionClone)

            _.extend(result, cookieSessionClone);
        }
        return result
    }
}

/**
 * fs.Filestat as DTO
 * Copied from nodejsserver/node_modules/@types/node/fs.d.ts
 */
export interface FileStats {
    isFile: boolean;
    isDirectory: boolean;
    isBlockDevice: boolean;
    isCharacterDevice: boolean;
    isSymbolicLink: boolean;
    isFIFO: boolean;
    isSocket: boolean;
    dev: Number;
    ino: Number;
    mode: Number;
    nlink: Number;
    uid: Number;
    gid: Number;
    rdev: Number;
    size: Number;
    blksize: Number;
    blocks: Number;
    atimeMs: Number;
    mtimeMs: Number;
    ctimeMs: Number;
    birthtimeMs: Number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
}


/**
 * ...
 * Type copied from exec as a bug Workaround, because typescript-rtti otherwise creates a wrong import statement: import ... from "execa/index.js";
 */
interface ExecaCommonOptions<EncodingType> {
    /**
     Kill the spawned process when the parent process exits unless either:
     - the spawned process is [`detached`](https://nodejs.org/api/child_process.html#child_process_options_detached)
     - the parent process is terminated abruptly, for example, with `SIGKILL` as opposed to `SIGTERM` or a normal exit

     @default true
     */
    readonly cleanup?: boolean;

    /**
     Prefer locally installed binaries when looking for a binary to execute.

     If you `$ npm install foo`, you can then `execa('foo')`.

     @default false
     */
    readonly preferLocal?: boolean;

    /**
     Preferred path to find locally installed binaries in (use with `preferLocal`).

     Using a `URL` is only supported in Node.js `14.18.0`, `16.14.0` or above.

     @default process.cwd()
     */
    readonly localDir?: string | URL;

    /**
     Path to the Node.js executable to use in child processes.

     This can be either an absolute path or a path relative to the `cwd` option.

     Requires `preferLocal` to be `true`.

     For example, this can be used together with [`get-node`](https://github.com/ehmicky/get-node) to run a specific Node.js version in a child process.

     @default process.execPath
     */
    readonly execPath?: string;

    /**
     Buffer the output from the spawned process. When set to `false`, you must read the output of `stdout` and `stderr` (or `all` if the `all` option is `true`). Otherwise the returned promise will not be resolved/rejected.

     If the spawned process fails, `error.stdout`, `error.stderr`, and `error.all` will contain the buffered data.

     @default true
     */
    readonly buffer?: boolean;

    /**
     Same options as [`stdio`](https://nodejs.org/dist/latest-v6.x/docs/api/child_process.html#child_process_options_stdio).

     @default 'pipe'
     */
    readonly stdin?: StdioOption;

    /**
     Same options as [`stdio`](https://nodejs.org/dist/latest-v6.x/docs/api/child_process.html#child_process_options_stdio).

     @default 'pipe'
     */
    readonly stdout?: StdioOption;

    /**
     Same options as [`stdio`](https://nodejs.org/dist/latest-v6.x/docs/api/child_process.html#child_process_options_stdio).

     @default 'pipe'
     */
    readonly stderr?: StdioOption;

    /**
     Setting this to `false` resolves the promise with the error instead of rejecting it.

     @default true
     */
    readonly reject?: boolean;

    /**
     Add an `.all` property on the promise and the resolved value. The property contains the output of the process with `stdout` and `stderr` interleaved.

     @default false
     */
    readonly all?: boolean;

    /**
     Strip the final [newline character](https://en.wikipedia.org/wiki/Newline) from the output.

     @default true
     */
    readonly stripFinalNewline?: boolean;

    /**
     Set to `false` if you don't want to extend the environment variables when providing the `env` property.

     @default true
     */
    readonly extendEnv?: boolean;

    /**
     Current working directory of the child process.

     Using a `URL` is only supported in Node.js `14.18.0`, `16.14.0` or above.

     @default process.cwd()
     */
    readonly cwd?: string | URL;

    /**
     Environment key-value pairs. Extends automatically from `process.env`. Set `extendEnv` to `false` if you don't want this.

     @default process.env
     */
    readonly env?: NodeJS.ProcessEnv;

    /**
     Explicitly set the value of `argv[0]` sent to the child process. This will be set to `command` or `file` if not specified.
     */
    readonly argv0?: string;

    /**
     Child's [stdio](https://nodejs.org/api/child_process.html#child_process_options_stdio) configuration.

     @default 'pipe'
     */
    readonly stdio?: 'pipe' | 'ignore' | 'inherit' | readonly StdioOption[];

    /**
     Specify the kind of serialization used for sending messages between processes when using the `stdio: 'ipc'` option or `execaNode()`:
     - `json`: Uses `JSON.stringify()` and `JSON.parse()`.
     - `advanced`: Uses [`v8.serialize()`](https://nodejs.org/api/v8.html#v8_v8_serialize_value)

     Requires Node.js `13.2.0` or later.

     [More info.](https://nodejs.org/api/child_process.html#child_process_advanced_serialization)

     @default 'json'
     */
    readonly serialization?: 'json' | 'advanced';

    /**
     Prepare child to run independently of its parent process. Specific behavior [depends on the platform](https://nodejs.org/api/child_process.html#child_process_options_detached).

     @default false
     */
    readonly detached?: boolean;

    /**
     Sets the user identity of the process.
     */
    readonly uid?: number;

    /**
     Sets the group identity of the process.
     */
    readonly gid?: number;

    /**
     If `true`, runs `command` inside of a shell. Uses `/bin/sh` on UNIX and `cmd.exe` on Windows. A different shell can be specified as a string. The shell should understand the `-c` switch on UNIX or `/d /s /c` on Windows.

     We recommend against using this option since it is:
     - not cross-platform, encouraging shell-specific syntax.
     - slower, because of the additional shell interpretation.
     - unsafe, potentially allowing command injection.

     @default false
     */
    readonly shell?: boolean | string;

    /**
     Specify the character encoding used to decode the `stdout` and `stderr` output. If set to `null`, then `stdout` and `stderr` will be a `Buffer` instead of a string.

     @default 'utf8'
     */
    readonly encoding?: EncodingType;

    /**
     If `timeout` is greater than `0`, the parent will send the signal identified by the `killSignal` property (the default is `SIGTERM`) if the child runs longer than `timeout` milliseconds.

     @default 0
     */
    readonly timeout?: number;

    /**
     Largest amount of data in bytes allowed on `stdout` or `stderr`. Default: 100 MB.

     @default 100_000_000
     */
    readonly maxBuffer?: number;

    /**
     Signal value to be used when the spawned process will be killed.

     @default 'SIGTERM'
     */
    readonly killSignal?: string | number;

    /**
     You can abort the spawned process using [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController).

     When `AbortController.abort()` is called, [`.isCanceled`](https://github.com/sindresorhus/execa#iscanceled) becomes `false`.

     *Requires Node.js 16 or later.*

     @example
     ```js
     import {execa} from 'execa';

     const abortController = new AbortController();
     const subprocess = execa('node', [], {signal: abortController.signal});

     setTimeout(() => {
		abortController.abort();
	}, 1000);

     try {
		await subprocess;
	} catch (error) {
		console.log(subprocess.killed); // true
		console.log(error.isCanceled); // true
	}
     ```
     */
    readonly signal?: AbortSignal;

    /**
     If `true`, no quoting or escaping of arguments is done on Windows. Ignored on other platforms. This is set to `true` automatically when the `shell` option is `true`.

     @default false
     */
    readonly windowsVerbatimArguments?: boolean;

    /**
     On Windows, do not create a new console window. Please note this also prevents `CTRL-C` [from working](https://github.com/nodejs/node/issues/29837) on Windows.

     @default true
     */
    readonly windowsHide?: boolean;
}

/**
 * ...
 * Type copied from exec as a bug Workaround, because typescript-rtti otherwise creates a wrong import statement: import ... from "execa/index.js";
 */
export interface ExecaOptions<EncodingType = string> extends ExecaCommonOptions<EncodingType> {
    /**
     Write some input to the `stdin` of your binary.
     */
    readonly input?: string | Buffer | ReadableStream;
}

/**
 * Essential info of a plugin's package.json
 */
export type PluginPackage = {
    name: string,
    version: string
    description?: string,
    homepage?: string,
}

/**
 *
 * Same as
 * import {CookieSession} from "restfuncs-common";
 * <p>
 *     This is a bug worakound: because typescript-rtti tries to follow the type and creates a broken import statement: "import ... from "restfuncs-common/dist/commonjs/..."
 * </p>
 */
interface CookieSession extends Record<string, unknown> {
    id: string
    version: number
    bpSalt?: string
    previousBpSalt?: string
    commandDestruction?:boolean
}

/**
 * Advanced info that is stored per socketconnection = 1:1 to browser window
 */
export class BrowserWindow {
    isFocused = false;
    needsCpuUsage = false;
}