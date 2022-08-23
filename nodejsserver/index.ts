import fs from './util/fsPromises.js';
import express from 'express'
import WebBuildProcess, { BuildResult } from './WebBuilder.js';

class FrontendServer {
  // config:
  port = 8006;
  WWWBASEDIR= "/usr/share/pve-manager-electrified"
  developWwwBaseDir = "/root/proxmox/pve-manager-electrified/www"

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
  reBuildRequested?: {
    buildStaticFiles: boolean
  };



  constructor() {
    (async () => {
      const expressServer = express()
      //await installFrontend(express)

      await this.requestBuild(true);

      expressServer.listen(this.port)
      console.log(`Server running at http://localhost:${this.port}`);
    })();

  }

  
  async requestBuild(buildStaticFiles: boolean): Promise<BuildResult> {
    if (this.nextBuild) { // Someone else already promised the next build ?
      this.reBuildRequested = {buildStaticFiles}
      if(this.diagnosis_webBuilder?.buildStaticFiles) { // this check is a bit hacky !
        this.reBuildRequested.buildStaticFiles = true; // build with static files again
      }
    }
    else {
      // We have to promise the next build:
      this.nextBuild = new Promise((resolve, reject) => {
        (async () => {
          // eslint-disable-next-line no-constant-condition
          while (true) { // do a rebuild loop till no build is re-requested anymore:
            this.reBuildRequested = undefined; // clear flag
            try {

              let wwwSourceDir = this.WWWBASEDIR;
              if (await this.useWwwDevelopmentSources()) {
                  wwwSourceDir = this.developWwwBaseDir;
                  console.log(`Using www development sources from: ${this.developWwwBaseDir}`);
              }

              const webBuilder = this.diagnosis_webBuilder = new WebBuildProcess(wwwSourceDir, buildStaticFiles);
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


  private async useWwwDevelopmentSources() {
    const dirStat = await fs.stat(this.developWwwBaseDir);
    return dirStat.isDirectory(); 
  }

  setActiveBuildResult(buildResult: BuildResult) {
    this.activeBuildResult = buildResult;
  }
  
}

new FrontendServer(); // start server


/*
async function installFrontend(app: any) {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(`./dist/client`))
  } else {
    const vite = await import('vite')
    const viteDevServer = await vite.createServer({
      server: { middlewareMode: 'html' }
    })
    app.use(viteDevServer.middlewares)
  }
}

*/