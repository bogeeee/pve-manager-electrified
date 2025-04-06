import express from 'express'
import cookieParser from 'cookie-parser';
import https from "node:https"
import WebBuildProcess, { BuildOptions, BuildResult, getSafestBuildOptions as getSaferBuildOptions } from './WebBuilder.js';
import { execa } from "execa";
import { createProxyMiddleware } from 'http-proxy-middleware';
import fs from 'node:fs';
import fsAsync from './util/fsPromises.js';
import {
  conditionalMiddleware,
  better_fetch,
  axiosExt,
  errorToString,
  killProcessThatListensOnPort
} from './util/util.js';
import exp from 'constants';
import { resolve } from 'path';
import { readFile } from 'fs';

class AppServer {
  // config:
  config = {
    /**
     * This is where the old web is running
     */
    origPort: 8005,
    port: 8006,
    key: "/etc/pve/local/pve-ssl.key",
    cert: "/etc/pve/local/pve-ssl.pem",
    WWWBASEDIR: "/usr/share/pve-manager",
    developWwwBaseDir: "/root/proxmox/pve-manager-electrified/www", // if this exists then they are used from there
  }

  /**
   * Dir where the web sources are (except libs whicht are spreaded out across /usr/... )
   */
  wwwSourceDir?: string


  /**
   * Dir where the build output is copied to and then served
   */
  bundledWWWDir = "/var/lib/pve-manager/bundledWww"

  /**
   * the builder that is currently running
   */
  diagnosis_webBuilder?: WebBuildProcess;

  /**
   * The last successfull build result that is currently shown live
   */
  activeBuildResult?: BuildResult

  nextBuild?: Promise<BuildResult>;

  /**
   * You can request a new rebuild while the build is still running, so it's result will be discarded and new one is done,s
   */
  reBuildRequested?: BuildOptions;



  constructor() {
    (async () => {

      if(process.env.NODE_ENV === "development") {
        killProcessThatListensOnPort(this.config.port); // Fix: In development on the pve server, sometimes the old process does not terminate properly.
      }

      // init fields:
      this.wwwSourceDir = await fs.existsSync(this.config.developWwwBaseDir) ? this.config.developWwwBaseDir : this.config.WWWBASEDIR;


      const expressApp = express()
      expressApp.use(cookieParser())

      const buildResult = await this.requestBuild({
        buildStaticFiles: true
      });

      await this.activateBuildResult(buildResult);


      // Redirect /pve2 to pearl server on port 8005:
      expressApp.use(
        ['/pve2', "/novnc", "/xtermjs", "/pwt", "/api2", "/favicon.ico", "/qrcode.min.js", "/proxmoxlib.js"],
        createProxyMiddleware({           
          target: `https://localhost:${this.config.origPort}/pve2`,
          prependPath: false,
          changeOrigin: false,
          secure: false,

        })
      );


      // Serve index.html (from bundled filed) with some replacements:      
      expressApp.get("/", this.serveIndexHtml.bind(this));

        // Serve (non-modified-) bundled files:
      expressApp.use("/", express.static(this.bundledWWWDir));

      // serve files from wwwSourceDir:
      expressApp.use("/", express.static(this.wwwSourceDir));

      // if request doesnt get handled, send an error:
      expressApp.use("/", function (req, resp, next) {
        resp.status(500);
        resp.send("There is no handler / middleware for this request.");
      })



      // Create an HTTPS server
      https.createServer({
        key: fs.readFileSync(this.config.key),
        cert: fs.readFileSync(this.config.cert)
      }, expressApp).listen(this.config.port, () => {
        console.log(`Server running at http://localhost:${this.config.port}`);
      });
    })();

  }


  async requestBuild(buildOptions: BuildOptions): Promise<BuildResult> {
    if (this.nextBuild) { // Someone else already promised the next build ?
      this.reBuildRequested = getSaferBuildOptions(buildOptions, this.diagnosis_webBuilder!.buildOptions); // request a rebuild
    }
    else {
      // We have to promise the next build:
      this.nextBuild = new Promise((resolve, reject) => {
        (async () => {
          // eslint-disable-next-line no-constant-condition
          while (true) { // do a rebuild loop till no build is re-requested anymore:

            if (this.reBuildRequested) { // from a re-request ?
              buildOptions = getSaferBuildOptions(buildOptions, this.reBuildRequested); // make sure to use the safer ones
            }

            this.reBuildRequested = undefined; // clear flag
            try {

              const webBuilder = this.diagnosis_webBuilder = new WebBuildProcess(buildOptions);
              const result = await webBuilder.build();

              if (!this.reBuildRequested) {
                // successfull
                resolve(result);
                break;
              }
            }
            catch (e) {
              console.log(e);
              if (!this.reBuildRequested) {
                reject(e);
                throw e;
              }
            }
          }
        })();

      });

    }

    return this.nextBuild;
  }




  async activateBuildResult(buildResult: BuildResult) {
    if (!buildResult.staticFilesDir) {
      throw new Error("Must provide staticFilesDir");
    }

    await execa("rm", ["-rf", this.bundledWWWDir]); // delete dir
    //await execa("mkdir", ["-p", this.bundledWWWDir]);
    await execa("mv", [buildResult.staticFilesDir, this.bundledWWWDir]);

    this.activeBuildResult = buildResult;
  }

  /**
   * Serves the index.html (from bundled files) and does some runtime variable replacements there
   * @param req 
   * @param res 
   * @param next 
   */
  async serveIndexHtml(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const endoding = "utf-8";
      let indexHtml = await fsAsync.readFile(this.bundledWWWDir + "/index.html", { encoding: endoding });

      // Fetch the state from original pve-manager:
      const proxmoxState = (await axiosExt(`https://localhost:${this.config.origPort}/proxmox_state`,{
        headers: {...req.headers as object}, // Pass original headers (with cookies), so we get the right csrfProtectionToken (and more)
      })).data as object;
      if(proxmoxState === null || typeof proxmoxState !== "object") {
        throw new Error("Invalid result: /proxmox_state is not json.");
      }

      indexHtml = indexHtml.replace("$PROXMOXSTATE$", JSON.stringify(proxmoxState)); // replace $PROXMOXSTATE$
      indexHtml = indexHtml.replace(/\[% nodename %\]/g, (proxmoxState as any).NodeName as string); // replace nodename
      const lang = (proxmoxState as any).defaultLang as string;
      indexHtml = indexHtml.replace(/\[% lang %\]/g, lang); // replace language

      // Theme (logic like in original index.html.tpl):
      let theme: string | undefined = req.cookies?.["PVEThemeCookie"] || "auto"
      if(theme === "__default__") {
        theme = "auto";
      }
      let themeHtml = "";
      if(theme != 'crisp') {
        if (theme != 'auto') {
          themeHtml = `<link rel="stylesheet" type="text/css" href="/pwt/themes/theme-${theme}.css?ver=TODO_BUILDID" />`
        } else {
          themeHtml = `<link rel="stylesheet" type="text/css" media="(prefers-color-scheme: dark)" href="/pwt/themes/theme-proxmox-dark.css?ver=TODO_BUILDID" />`
        }
      }
      indexHtml = indexHtml.replace("$THEME$", themeHtml);

      //$LANGFILE$:
      if(await fsAsync.exists(`/usr/share/pve-i18n/pve-lang-${lang}`)) { // Language file exists ?
        indexHtml = indexHtml.replace("$LANGFILE$", `<script type='text/javascript' src='/pve2/locale/pve-lang-${lang}.js?ver=TODO_BUILDID'/>`);
      }
      else {
        indexHtml = indexHtml.replace("$LANGFILE$", "<script type='text/javascript'>function gettext(buf) { return buf; }</script>");
      }
      
      
      // Debug:
      const isDebug = req.query?.["debug"] != undefined || await fsAsync.exists(this.config.developWwwBaseDir);
      indexHtml= indexHtml.replace("$DEBUG_EXT_ALL$", isDebug?"-debug":"");
      indexHtml= indexHtml.replace("$DEBUG_CHARTS$", isDebug?"-debug":"");

      res.send(indexHtml)
    }
    catch (e: any) {
      res.status(500);
      res.send(`<pre>${errorToString(e)}</pre>`);
    }
  }

}

export const appServer = new AppServer(); // start server
