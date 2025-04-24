import express from 'express'
import cookieParser from 'cookie-parser';
import https from "node:https"
import WebBuildProgress, {
    BuildOptions,
    BuildResult,
    getSafestBuildOptions as getSaferBuildOptions,
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
    spawnAsync, ErrorDiagnosis, deleteDir
} from './util/util.js';
import {ElectrifiedSession} from "./ElectrifiedSession.js";
import {restfuncsExpress} from "restfuncs-server";
import {createServer, ViteDevServer} from "vite";
import {WebSocket} from "ws";
import {fileURLToPath} from "node:url";
import path from "node:path";

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

    protected viteDevServer!: ViteDevServer;


    constructor() {
        spawnAsync(async () => {

            if (process.env.NODE_ENV === "development") {
                await killProcessThatListensOnPort(this.config.port); // Fix: In development on the pve server, sometimes the old process does not terminate properly.
            }

            // init fields:
            this.wwwSourceDir = await fs.existsSync(this.config.developWwwBaseDir) ? this.config.developWwwBaseDir : this.config.WWWBASEDIR;


            const expressApp = restfuncsExpress({
                engineIoOptions: {destroyUpgrade: false},
                installEngineIoServer: false
            })

            this.buildWeb({
                buildStaticFiles: !(process.env.NODE_ENV === "development")
            });

            expressApp.use("/electrifiedAPI", ElectrifiedSession.createExpressHandler())

            //TODO: hand this to websocket: /api2/json/nodes/pveWohnungTest2/lxc/820/vncwebsocket

            // Redirect /pve2, ... to perl server on port 8005:
            expressApp.use(
                ['/pve2', "/novnc", "/xtermjs", "/pwt", "/api2", "/favicon.ico", "/qrcode.min.js", "/proxmoxlib.js"],
                createProxyMiddleware({
                    target: `https://localhost:${this.config.origPort}`,
                    prependPath: true,
                    changeOrigin: false,
                    secure: false,

                })
            );

            // redirect /?console ... to perl server on port 8005:
            expressApp.use("/", conditionalMiddleware(req => req.url.startsWith("/?console"), createProxyMiddleware({
                target: `https://localhost:${this.config.origPort}`,
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
                    allowedHosts: true // Allow all hosts. TODO: security: restrict only to users, logged in a as root.
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
            expressApp.use(conditionalMiddleware(() => this.useViteDevServer, this.viteDevServer.middlewares));

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
                    if(!this.useViteDevServer) {
                        return undefined; // Don't allow
                    }
                    return new WebSocket(`ws://localhost:${this.config.internalViteHmrPort}${req.url}`);
                }
                else {
                    return new WebSocket(`wss://localhost:${this.config.origPort}${req.url}`, {
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
     * Builds and activates the web
     * @param buildOptions
     */
    buildWeb(buildOptions: BuildOptions, progressListener?: (progress: WebBuildProgress) => void) {
        // Cancel old build:
        if(this.builtWeb?.promiseState.state === "pending") {
            this.builtWeb.cancel(new Error("Canceled because a new build was made."))
        }

        const me = this;
        class WebBuildAndDeploy extends WebBuildProgress {
            protected async run(): Promise<BuildResult> {
                const result = await super.run();
                this.diagnosis_state = "Activating build result"; this.fireProgressChanged();
                await me.activateBuildResult(result);
                return result;
            }
        }

        return this.builtWeb = WebBuildAndDeploy.create({buildOptions}) as any as WebBuildProgress;
    }


    protected async activateBuildResult(buildResult: BuildResult) {
        await deleteDir(this.bundledWWWDir, true); // delete old dir
        if (buildResult.staticFilesDir) {
            await execa("mv", [buildResult.staticFilesDir, this.bundledWWWDir]);
        }
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
                    themeHtml = `<link rel="stylesheet" type="text/css" href="/pwt/themes/theme-${theme}.css?ver=TODO_BUILDID" />`
                } else {
                    themeHtml = `<link rel="stylesheet" type="text/css" media="(prefers-color-scheme: dark)" href="/pwt/themes/theme-proxmox-dark.css?ver=TODO_BUILDID" />`
                }
            }
            indexHtml = indexHtml.replace("$THEME$", themeHtml);

            //$LANGFILE$:
            if (await fileExists(`/usr/share/pve-i18n/pve-lang-${lang}`)) { // Language file exists ?
                indexHtml = indexHtml.replace("$LANGFILE$", `<script type='text/javascript' src='/pve2/locale/pve-lang-${lang}.js?ver=TODO_BUILDID'/>`);
            } else {
                indexHtml = indexHtml.replace("$LANGFILE$", "<script type='text/javascript'>function gettext(buf) { return buf; }</script>");
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
        const result = (await axiosExt(`https://localhost:${this.config.origPort}/proxmox_state`, {
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


    get useViteDevServer() {
        return !this.builtWeb.buildOptions.buildStaticFiles
    }

    set useViteDevServer(value: boolean) {
        if(this.useViteDevServer !== value) {
            spawnAsync(async () => {await this.buildWeb({buildStaticFiles: !value}) }, false);

        }
    }

}

export const appServer = new AppServer(); // start server
