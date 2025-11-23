import express from 'express'
import cookieParser from 'cookie-parser';
import https from "node:https"
import WebBuildProgress, {
    BuildOptions,
    BuildResult,
} from './WebBuilder.js';
import {execa} from "execa";
import {createProxyMiddleware} from 'http-proxy-middleware';
import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import {
    axiosExt,
    conditionalMiddleware,
    errorToString,
    fileExists,
    killProcessThatListensOnPort,
    forwardWebsocketConnections,
    spawnAsync, ErrorDiagnosis, deleteDir, toError, isStrictSameSiteRequest
} from './util/util.js';
import {ElectrifiedSession} from "./ElectrifiedSession.js";
import {ClientCallbackSet, restfuncsExpress} from "restfuncs-server";
import {createServer, ViteDevServer} from "vite";
import {WebSocket} from "ws";
import {fileURLToPath} from "node:url";
import path from "node:path";
import chokidar from 'chokidar';
import session, {MemoryStore, SessionData} from "express-session";
import {unsign} from "cookie-signature"
import nacl_util from "tweetnacl-util";
import nacl from "tweetnacl";
import {IncomingMessage} from "node:http";
import {ExpressMemoryStoreExt} from "./util/ExpressMemoryStoreExt.js";
import {ElectrifiedJsonConfig} from "./Common.js";


// Enable these for better error diagnosis during development:
//ErrorDiagnosis.keepProcessAlive = (process.env.NODE_ENV === "development");
//ErrorDiagnosis.record_spawnAsync_stackTrace = (process.env.NODE_ENV === "development");

class AppServer {
    // config:
    config = {
        /**
         * This is where the old web is running
         */
        origPort: 8005,
        port: 8006,

        /**
         * Port where the vite devserver is listening for websocket connections. Thy will be forwarded to there.
         */
        internalViteHmrPort: 8055,
        key: "/etc/pve/local/pve-ssl.key",
        cert: "/etc/pve/local/pve-ssl.pem",
        WWWBASEDIR: "/usr/share/pve-manager",
        developWwwBaseDir: "/root/proxmox/pve-manager-electrified/www", // if this exists then they are used from there
        pluginSourceProjectsDir: "/root/pveme-plugin-source-projects",
        clusterPackagesBaseDir: "/etc/pve/manager/plugin-packages",
        examplePluginDir: "/usr/share/pve-manager-ui-plugin-example",
        npmRegistryApiBaseUrl: "https://registry.npmjs.org",
        /**
         * Time in miliseconds, before they need to be requeried from the original server.
         */
        permissionCacheMaxAgeMs: {
            prod: 10000,
            dev: 2 *60 * 60 * 1000, // 2hours for, when working with the vite-devserver. Otherwise there are annoying double-reloads when the cache timed out.
        },

    }

    thisNodejsServerDir = path.dirname(fileURLToPath(import.meta.url));

    /**
     * Dir where the web sources are (except libs whicht are spreaded out across /usr/... )
     */
    wwwSourceDir!: string


    /**
     * Dir where the build output is copied to and then served
     */
    bundledWWWDir = "/var/lib/pve-manager/bundledWww"


    builtWeb!: WebBuildProgress

    /**
     * Called when the web is rebuild (when it is starting)
     * Bug worakound: ":any" because typescript-rtti tries to follow the type and creates a broken import statement: "import ... from "restfuncs-server/dist/commonjs/..."
     */
    webBuildStartListeners: any = new ClientCallbackSet<[]>({maxListenersPerClient: 1})

    protected expressSessionSecret = nacl_util.encodeBase64(nacl.randomBytes(32));
    protected expressSessionStore = new ExpressMemoryStoreExt(); // Express's default memory store. You may use a better one for production to prevent against growing memory by a DOS attack. See https://www.npmjs.com/package/express-session

    protected viteDevServer!: ViteDevServer;

    viteDevServer_allowUnauthorizedClients = process.env.NODE_ENV === "development";

    constructor() {
        spawnAsync(async () => {

            if (process.env.NODE_ENV === "development") {
                await killProcessThatListensOnPort(this.config.port); // Fix: In development on the pve server, sometimes the old process does not terminate properly.
            }

            // init fields:
            this.wwwSourceDir = await fs.existsSync(this.config.developWwwBaseDir) ? this.config.developWwwBaseDir : this.config.WWWBASEDIR;


            const expressApp = restfuncsExpress({
                engineIoOptions: {destroyUpgrade: false},
                installEngineIoServer: false,
                sessionValidityTracking: false,
                installSessionHandler: false,
            })
            expressApp.use(cookieParser());

            expressApp.set('trust proxy', false); // When enabling this, you must also account for this in the getDestination function!!

            // Install session handler that stores in this.expressSessionStore: Code copied from restfuncs/Server.ts
            expressApp.use(session({
                secret: this.expressSessionSecret,
                cookie: {sameSite: true}, // sameSite is not required for restfuncs's security but you could still enable it to harden security, if you really have no cross-site interaction.
                saveUninitialized: false, // Privacy: Only send a cookie when really needed
                unset: "destroy",
                store: this.expressSessionStore,
                resave: false
            }));

            this.buildWeb({
                buildStaticFiles: !(process.env.NODE_ENV === "development"),
                enablePlugins: true,
            });
            this.startListeningForChangedPluginSetup();

            expressApp.use("/electrifiedAPI", ElectrifiedSession.createExpressHandler())

            //TODO: hand this to websocket: /api2/json/nodes/pveWohnungTest2/lxc/820/vncwebsocket

            // Redirect /pve2, ... to perl server on port 8005:
            expressApp.use(
                ['/pve2', "/novnc", "/xtermjs", "/pwt", "/api2", "/favicon.ico", "/qrcode.min.js", "/proxmoxlib.js"],
                createProxyMiddleware({
                    target: `https://ip6-localhost:${this.config.origPort}`,
                    prependPath: true,
                    changeOrigin: false,
                    secure: false,

                })
            );

            // redirect /?console ... to perl server on port 8005:
            expressApp.use("/", conditionalMiddleware(req => req.url.startsWith("/?console"), createProxyMiddleware({
                target: `https://ip6-localhost:${this.config.origPort}`,
                prependPath: false,
                changeOrigin: false,
                secure: false,

            })));


            // Serve index.html (from bundled filed) with some replacements:
            expressApp.get("/", this.serveIndexHtml.bind(this));

            // Serve web-build control panel:
            expressApp.get("/webBuild", this.serveWebBuildDiagnosisHtml.bind(this));

            // (for vite-dev-server mode), serve web web through vite dev server:
            this.viteDevServer = await createServer({
                server: {
                    middlewareMode: true,
                    hmr: {
                        path: "viteHmr",
                        port: this.config.internalViteHmrPort,
                        host: "127.0.0.1", // Security: bind the internal server to loopback interface only
                        clientPort: this.config.port,
                    },
                    allowedHosts: true, // Allow all hosts. Access is restriced, see below
                    watch: {
                        followSymlinks: true
                    }
                },
                root: this.wwwSourceDir,
                base: "/",
                plugins: [
                    // Workaround: Setting host: "127.0.0.1" (see above) make the client try to connect to 127.0.0.1. So we modify the script that's sent to the client, as described here https://github.com/vitejs/vite/issues/8666#issuecomment-1315694497
                    {
                        name: "modify-client-host",
                        transform(code, id) {
                            if ( id.endsWith("dist/client/client.mjs") || id.endsWith("dist/client/env.mjs") ) {
                                return code.replace("__HMR_HOSTNAME__", "window.location.hostname");
                            }
                            return code;
                        },
                    },
                ],
            });
            expressApp.use(conditionalMiddleware((req) => {
                // Note: Duplicate logic:
                if(!this.useViteDevServer) {
                    return false; // Don't allow
                }
                if(this.viteDevServer_allowUnauthorizedClients) {
                    return true;
                }
                try {
                    if (!isStrictSameSiteRequest(req)) {// Cross site?
                        return false; // Don't allow. Prevent possible xsrf
                    }

                    const electrifiedSession = ElectrifiedSession.fromRequest_unofficial({session: (this.getExpressSessionFromIncomingmessage(req) || {})});
                    if (!electrifiedSession) {
                        return false; // Don't allow
                    }
                    electrifiedSession.checkCachedPermission("/", "Sys.Console");
                    return true;
                }
                catch (e) {
                    return false;
                }

            }, this.viteDevServer.middlewares));

            // (for production mode) Serve (non-modified-) bundled files:
            expressApp.use("/", conditionalMiddleware(() => !this.useViteDevServer, express.static(this.bundledWWWDir)));

            // serve files from wwwSourceDir:
            expressApp.use("/", express.static(this.wwwSourceDir));

            // if request doesnt get handled, send an error:
            expressApp.use("/", function (req, resp, next) {
                resp.status(500);
                resp.send("There is no handler / middleware for this request.");
            })


            // Create an HTTPS server
            const httpsServer = https.createServer({
                key: fs.readFileSync(this.config.key),
                cert: fs.readFileSync(this.config.cert)
            }, expressApp);

            expressApp.installEngineIoServer(httpsServer);

            // Forward vite dev server websocket connections + the rest of all websocket connections (not handled by Restfuncs)  to the original server (most simple implementation. If there's more special websocket paths, put the handlers **above** here):
            forwardWebsocketConnections(httpsServer, (req) => {
                if(req.url?.startsWith("/viteHmr")) { // For vite ?
                    // Note: Duplicate logic:
                    if(!this.useViteDevServer) {
                        return undefined; // Don't allow
                    }
                    if(!this.viteDevServer_allowUnauthorizedClients) {
                        if (!isStrictSameSiteRequest(req)) {// Cross site?
                            return undefined; // Don't allow. Prevent possible xsrf
                        }

                        const electrifiedSession = ElectrifiedSession.fromRequest_unofficial({session: (this.getExpressSessionFromIncomingmessage(req) || {})});
                        if (!electrifiedSession) {
                            return undefined; // Don't allow
                        }
                        electrifiedSession.checkCachedPermission("/", "Sys.Console");
                    }
                    return new WebSocket(`ws://localhost:${this.config.internalViteHmrPort}${req.url}`);
                }
                else if(req.url?.startsWith("/engine.io_restfuncs")) {
                    return undefined; // Let the above line "expressApp.installEngineIoServer(httpsServer);" handle it
                }
                else {
                    return new WebSocket(`wss://ip6-localhost:${this.config.origPort}${req.url}`, {
                        rejectUnauthorized: false,
                        headers: req.headers["cookie"]?{cookie: req.headers["cookie"]}:{} // forward cookie header
                    });
                }
            }, false);

            httpsServer.listen(this.config.port, () => {
                console.log(`Server running at http://localhost:${this.config.port}`);
            });
        }, true);

    }



    /**
     * Builds and activates the web. Cancels any old, currently running build.
     * @param buildOptions
     * @param progressListener
     * @param delayMs when specified, it waits this amount of milliseconds before starting the build. This can be useful to counteract bursts of build triggers, i.e by watched file changes.
     */
    buildWeb(buildOptions: BuildOptions, progressListener?: (progress: WebBuildProgress) => void, delayMs?: number) {
        // Cancel old build:
        const oldBuild = this.builtWeb;
        if(oldBuild?.promiseState.state === "pending") {
            oldBuild.cancel(new Error("Canceled because a new build was made."))
        }

        const me = this;
        class WebBuildAndDeploy extends WebBuildProgress {
            protected async run(): Promise<BuildResult> {
                // Wait for old build, til it's canceled/finshed to not run builds simultaneously:
                if(oldBuild) {
                    this.diagnosis_state = "Waiting for old build to get canceled";
                    try {
                        await oldBuild
                    }
                    catch (e) {

                    }
                }
                this.checkCanceled();

                if(delayMs) {
                    await this.sleep(delayMs);
                }

                await me.viteDevServer?.close(); // For stability. There was strange behaviour seen, whe it was running while everything is rebuilt under it
                const result = await super.run();
                this.diagnosis_state = "Activating build result"; this.fireProgressChanged();
                await me.activateBuildResult(result);
                return result;
            }
        }

        this.builtWeb = WebBuildAndDeploy.create({buildOptions}) as any as WebBuildProgress;
        this.webBuildStartListeners.call();
        return this.builtWeb;
    }


    protected async activateBuildResult(buildResult: BuildResult) {
        await deleteDir(this.bundledWWWDir, true); // delete old dir
        if (buildResult.staticFilesDir) {
            await execa("mv", [buildResult.staticFilesDir, this.bundledWWWDir]);
        }
        await this.viteDevServer?.restart();
    }

    /**
     * Serves the index.html (from bundled files) and does some runtime variable replacements there
     * @param req
     * @param res
     * @param next
     */
    async serveIndexHtml(req: express.Request, res: express.Response, next: express.NextFunction) {
        if(this.builtWeb.promiseState.state !== "resolved") { // Build not finished ?
            return await this.serveWebBuildDiagnosisHtml(req, res, next); // Show build loader / diagnosis
        }
        try {
            const endoding = "utf-8";
            const buildId = this.builtWeb.buildId;
            let indexHtml = await fsAsync.readFile(`${this.useViteDevServer?this.wwwSourceDir:this.bundledWWWDir}/index.html`, {encoding: endoding});

            // Remove absolute-url prefixes:
            indexHtml = indexHtml.replaceAll("https://remove_this_prefix","");

            // proxmoxState related:
            const proxmoxState = await this.fetchProxmoxState(req);
            indexHtml = indexHtml.replace("$PROXMOXSTATE$", JSON.stringify(proxmoxState)); // replace $PROXMOXSTATE$
            indexHtml = indexHtml.replace(/\[% nodename %\]/g, (proxmoxState as any).NodeName as string); // replace nodename
            const lang = (proxmoxState as any).defaultLang as string;
            indexHtml = indexHtml.replace(/\[% lang %\]/g, lang); // replace language

            // Theme (logic like in original index.html.tpl):
            let theme: string | undefined = req.cookies?.["PVEThemeCookie"] || "auto"
            if (theme === "__default__") {
                theme = "auto";
            }
            let themeHtml = "";
            if (theme != 'crisp') {
                if (theme != 'auto') {
                    themeHtml = `<link rel="stylesheet" type="text/css" href="/pwt/themes/theme-${theme}.css?ver=${buildId}" />`
                } else {
                    themeHtml = `<link rel="stylesheet" type="text/css" media="(prefers-color-scheme: dark)" href="/pwt/themes/theme-proxmox-dark.css?ver=${buildId}" />`
                }
            }
            indexHtml = indexHtml.replace("$THEME$", themeHtml);

            //$LANGFILE$:
            if (await fileExists(`/usr/share/pve-i18n/pve-lang-${lang}`)) { // Language file exists ?
                indexHtml = indexHtml.replace("$LANGFILE$", `<script type='text/javascript' src='/pve2/locale/pve-lang-${lang}.js?ver=${buildId}'/>`);
            } else {
                indexHtml = indexHtml.replace("$LANGFILE$", "<script type='text/javascript'>function gettext(message) { return message; }; function ngettext(singular, plural, count) { return count === 1 ? singular : plural; }</script>");
            }


            // Debug:
            const isDebug = req.query?.["debug"] != undefined || await fileExists(this.config.developWwwBaseDir);
            indexHtml = indexHtml.replace("$DEBUG_EXT_ALL$", isDebug ? "-debug" : "");
            indexHtml = indexHtml.replace("$DEBUG_CHARTS$", isDebug ? "-debug" : "");

            if(this.useViteDevServer) {
                indexHtml = await this.viteDevServer.transformIndexHtml(req.url, indexHtml)
            }

            res.send(indexHtml)
        } catch (e: any) {
            res.status(500);
            res.send(`<pre>${errorToString(e)}</pre>`);
        }
    }

    /**
     * Fetch the state object from original pve-manager:
     * @param req
     * @private
     */
    private async fetchProxmoxState(req: express.Request): Promise<object> {
        const result = (await axiosExt(`https://ip6-localhost:${this.config.origPort}/proxmox_state`, {
            headers: {...req.headers as object}, // Pass original headers (with cookies), so we get the right csrfProtectionToken (and more)
        })).data as object;
        if (result === null || typeof result !== "object") {
            throw new Error("Invalid result: /proxmox_state is not json.");
        }

        return result;
    }

    /**
     * Serves the /webBuild control panel, or a simpler page with a loading spinner, when the url is not /webBuild
     * @param req
     * @param res
     * @param next
     */
    async serveWebBuildDiagnosisHtml(req: express.Request, res: express.Response, next: express.NextFunction) {
        try {
            const endoding = "utf-8";
            const proxmoxState = await this.fetchProxmoxState(req);
            let html = fs.readFileSync("webBuild.html", {encoding: "utf8"});
            html = html.replace("$PROXMOXSTATE$", JSON.stringify(proxmoxState)); // replace $PROXMOXSTATE$
            res.send(html)
        } catch (e: any) {
            res.status(500);
            res.send(`<pre>${errorToString(e)}</pre>`);
        }
    }

    /**
     *
     * @param req
     * @returns session object which does not perfectly mimic original express's (i.e. does not have methods), but just fits our needs.
     */
    getExpressSessionFromIncomingmessage(req: IncomingMessage): Record<string, unknown> | undefined {
        function getCookie(name: string) {
            const cookieHeader = req.headers["cookie"];
            if (!cookieHeader) {
                return undefined;
            }
            const cookies = Object.fromEntries(
                cookieHeader.split(';').map(cookie => {
                    let [key, ...v] = cookie.split('=');
                    return [key.trim(), v.join('=').trim()];
                })
            );
            return cookies[name];
        }

        const rawExpressSessionCookie = getCookie("connect.sid");
        if(!rawExpressSessionCookie) {
            return undefined;
        }

        const sessionId = unsign(decodeURIComponent(rawExpressSessionCookie).slice(2), this.expressSessionSecret);
        if(!sessionId) { // Signature invalid?
            return undefined
        }

        const result = this.expressSessionStore.getSessionSync(sessionId);
        if(!result) {
            return undefined;
        }

        // Mimic express's behaviour so far to fit our needs:
        result["id"] = sessionId;

        return result;
    }

    get useViteDevServer() {
        return !this.builtWeb.buildOptions.buildStaticFiles
    }

    set useViteDevServer(value: boolean) {
        if(this.useViteDevServer !== value) {
            this.buildWeb({...this.builtWeb!.buildOptions , buildStaticFiles: !value});
        }
    }

    /**
     * From /etc/pve/local/electrified.json
     * Creates file if it does not yet exist.
     */
    get electrifiedJsonConfig(): ElectrifiedJsonConfig {
        const filePath = ElectrifiedJsonConfig.filePath;
        if(!fs.existsSync(filePath)) {
            const newConfig = new ElectrifiedJsonConfig();
            fs.mkdirSync(path.dirname(filePath), {recursive: true});
            fs.writeFileSync(filePath, JSON.stringify(newConfig, undefined, 4), {encoding: "utf8"});
        }
        const fileContent = fs.readFileSync(filePath, {encoding: "utf8"});
        try {
            return JSON.parse(fileContent) as ElectrifiedJsonConfig;
        }
        catch (e) {
            throw new Error(`Error parsing config file: ${filePath}: ${(e as any)?.message}`);
        }
    }



    /**
     * Listens for every file/dir changes that needs an automatic rebuild of the web
     */
    async startListeningForChangedPluginSetup() {

        const handleChange = () => {
            const delay = 200; // Hacky bug workaround: It was observed with phpstorm 2021 with file sync to a remote pve server, that the watcher was fired when the package.json was incomplete but not again after it was completely written.
            this.buildWeb(structuredClone(this.builtWeb!.buildOptions), undefined, delay ); // Rebuild web with the same options
        }

        // Watch this.config.pluginSourceProjectsDir for creation of itsself, new project dirs and their package.json:
        watchInner(this.config.pluginSourceProjectsDir, (filePath) => {
            if (filePath === this.config.pluginSourceProjectsDir) { // Directly under dir
                return true;
            }
            if (path.dirname(filePath) == this.config.pluginSourceProjectsDir) { // Directory one level below ?
                return true;
            }
            if (filePath.endsWith("package.json")) {
                return true;
            }
            return false;
        });

        // Watch this.config.clusterPackagesBaseDir for creation of itsself, new project dirs and their package.json:
        watchInner(this.config.clusterPackagesBaseDir, (filePath) => {
            return filePath.startsWith(this.config.clusterPackagesBaseDir) && !filePath.match(new RegExp('^' + this.config.clusterPackagesBaseDir +'/[^/]*/node_modules'))// Deep under dir, except the node_modules folder ?
        });

        // Watch the npm plugin config:
        watchInner(ElectrifiedJsonConfig.filePath, (filePath) => filePath === ElectrifiedJsonConfig.filePath);

        /**
         * Watches targetDir for creation and changes to paths where includeFn returns true
         * @param targetDir
         * @param includeFn
         */
        function watchInner(targetDir: string, includeFn:(filePath: string) =>  boolean) {
            const watcher = chokidar.watch(path.dirname(targetDir), {
                persistent: false, atomic: true,
                ignored: (filePath, stats) => {
                    if (targetDir.startsWith(filePath)) { // Directory directly above ?
                        return false; // watch it, so we can track the creation of targetDir
                    }
                    return !includeFn(filePath);
                },
                ignoreInitial: true
            });
            ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach(eventName => {
                (watcher as any).on(eventName, (path?: any) => {
                    //console.log(`Path: ${eventName} ${path}`);
                    handleChange()
                });
            });
        }
    }

}

export const appServer = new AppServer(); // start server
