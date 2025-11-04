import {ServerSession, CommunicationError} from "restfuncs-server";
import {remote} from "restfuncs-server";
import {ServerSessionOptions} from "restfuncs-server";
import {appServer} from "./server.js";
import WebBuildProgress, {BuildOptions} from "./WebBuilder.js";
import {axiosExt, deleteDir, errorToHtml, spawnAsync, newDefaultMap} from "./util/util.js";
import {rmSync} from "fs";
import fs from "node:fs";
import fsPromises  from "node:fs/promises";
import {execa} from "execa";
import {Request} from "express";
import {RemoteMethodOptions} from "restfuncs-server";
import {CookieSession} from "restfuncs-common";
import _ from "underscore";
import chokidar from "chokidar";
import {ClientCallbackSet} from "restfuncs-server";

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

    private static remoteMethodsThatNeedNoPermissions: (keyof ElectrifiedSession)[] = ["getWebBuildState","permissionsAreUp2Date"];

    static defaultRemoteMethodOptions: RemoteMethodOptions = {validateResult: false}

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
            hasPermissions: this.cachedPermissions?.permissions["/"]["Sys.Console"] === 1
        };
    }

    @remote()
    async rebuildWebAsync(buildOptions: BuildOptions) {
        spawnAsync(async () => {
            await appServer.buildWeb(buildOptions)
        }, false);
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
        await execa("cp", ["-r", "-a", "/usr/share/pve-manager-ui-plugin-example/.", targetDir])

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
     * Use this one in a sync only situations. Otherwise prefer checkPermission which can refresh non-up2date permissions
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
            throw new Error("Path does not exists. Special paths are not implemented yet");
        }

        if(this.cachedPermissions!.permissions[path][permission] === 1) {
            return true;
        }

        throw new CommunicationError(`You don't have required permission: ${path}/${permission}`, {httpStatusCode: 401});
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
     * @protected
     */
    protected static fileWatchers = newDefaultMap((path: string)=> {
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
    @remote watchFileChanges(path: string, callback: (stat: Awaited<ReturnType<ElectrifiedSession["getFileStat"]>>) => void) {
       ElectrifiedSession.fileWatchers.get(path).add(callback);
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