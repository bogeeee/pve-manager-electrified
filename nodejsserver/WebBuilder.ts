import fs from './util/fsPromises.js';
import {build as viteBuild} from "vite";
import crypto from "crypto"
import { appServer } from './index.js';


export type BuildOptions = {    
    /**
     * Bundles everything. Use for production (non ViteDevServer)
     */
    buildStaticFiles: boolean,
    DEBUG_EXT_ALL: boolean,
    DEBUG_CHARTS: boolean,
}

/**
 * If 2 build requests are triggered, then we decide opt for the safest one.
 * @param a 
 * @param b 
 * @returns 
 */
export function getSafestBuildOptions(a: BuildOptions, b: BuildOptions): BuildOptions {
    return {
        buildStaticFiles: a.buildStaticFiles || b.buildStaticFiles,
        DEBUG_EXT_ALL: a.DEBUG_EXT_ALL && b.DEBUG_EXT_ALL,
        DEBUG_CHARTS: a.DEBUG_CHARTS && b.DEBUG_CHARTS
    }
}

export default class WebBuildProcess {    

    buildOptions: BuildOptions;

    buildId: string;

    diagnosis_state?: string
        
    done = false;

    constructor(buildOptions: BuildOptions) {
        this.buildOptions = buildOptions;
        this.buildId = crypto.randomBytes(16).toString('base64').replace(/\//,'_');
    }
    
    async build(): Promise<BuildResult> {
        if(this.done) {
            throw new Error("Can't reuse the WebBuildProcess object");
        }

        try {            

            console.log("Building web");

            await this.createIndexHtml();
            // copy & modify package.json to enable/disable plugins
            // create listPlugins.js
            // npm prune (without triggers)
            // npm prune on all /root/pveme-plugin projects(without triggers)


            if(this.buildOptions.buildStaticFiles) {
                const bundledFilesDir = await this.bundleFiles();
                
                return {
                    buildId: this.buildId, 
                    staticFilesDir: bundledFilesDir
                };
            }
            else {
                return {
                    buildId: this.buildId,
                }                
            }


            
        }
        finally {
            this.done = true;
        }

    }

    /**
     * Creates the index.html from the template
     */
    async createIndexHtml() {
        this.diagnosis_state = "Create index.html";
        
        const wwwSourcesDir = appServer.wwwSourceDir;
        
        const templateEncoding = "utf-8";        
        let templateHtml = await fs.readFile(wwwSourcesDir + "/index.html.tpl",{encoding: templateEncoding});
        templateHtml = templateHtml.replace("$CACHEBREAKER$", this.buildId);
        await fs.writeFile(wwwSourcesDir + "/index.html", templateHtml, {encoding:templateEncoding})
        const i = 0;
    }

    async bundleFiles() {
        this.diagnosis_state = "Bundle files";
        const outDir = `/var/tmp/${this.buildId}`;

        console.log(`bundeling files to ${outDir}`);
        
        await viteBuild({            
            root: appServer.wwwSourceDir,            
            base: "/",
            build: {                
                outDir: outDir,
                rollupOptions: {
                }
            }
          })

        return outDir;
    }

     
}

export type BuildResult = {
    buildId: string,
    staticFilesDir?: string,
};