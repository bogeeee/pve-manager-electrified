import fs from 'node:fs/promises';
import {build as viteBuild} from "vite";
import crypto from "crypto"
import { appServer } from './server.js';
import {TaskPromise, taskWithProgress} from "./util/util";


export type BuildOptions = {    
    /**
     * Bundles everything. Use for production (non ViteDevServer)
     */
    buildStaticFiles: boolean,
}

/**
 * If 2 build requests are triggered, then we decide opt for the safest one.
 * @param a 
 * @param b 
 * @returns 
 */
export function getSafestBuildOptions(a: BuildOptions, b: BuildOptions): BuildOptions {
    return {
        buildStaticFiles: a.buildStaticFiles || b.buildStaticFiles
    }
}

export default class WebBuildProgress {

    buildOptions: BuildOptions;

    buildId: string;

    diagnosis_createdAt = new Date();

    diagnosis_state?: string
        
    done = false;

    constructor(buildOptions: BuildOptions) {
        this.buildOptions = buildOptions;
        this.buildId = crypto.randomBytes(16).toString('base64').replace(/\//,'_');
    }
}

export function buildWeb(buildOptions: BuildOptions): TaskPromise<BuildResult, WebBuildProgress> {
    const progress = new WebBuildProgress(buildOptions);
    return taskWithProgress(async (setProgress) => {
        return await inner_buildWeb(progress, setProgress);
    }, progress);
}

export async function inner_buildWeb(progress: WebBuildProgress, setProgress: (progress: WebBuildProgress) => void) {

    await createIndexHtml(progress, setProgress);
    // copy & modify package.json to enable/disable plugins
    // create listPlugins.js
    // npm prune (without triggers)
    // npm prune on all /root/pveme-plugin projects(without triggers)


    if (progress.buildOptions.buildStaticFiles) {
        const bundledFilesDir = await bundleFiles(progress, setProgress);

        return {
            diagnosis_startedAt: progress.diagnosis_createdAt,
            buildId: progress.buildId,
            staticFilesDir: bundledFilesDir,
            diagnosis_buildOptions: progress.buildOptions,
        };
    } else {
        return {
            diagnosis_startedAt: progress.diagnosis_createdAt,
            buildId: progress.buildId,
            diagnosis_buildOptions: progress.buildOptions,
        }
    }
}



/**
 * Creates the index.html from the template
 * NOTE, that there are  additional replacements done when served during runtime. See index.ts#serveIndexHtml
 */
async function createIndexHtml(progress: WebBuildProgress, setProgress: (progress: WebBuildProgress) => void) {
    progress.diagnosis_state = "Create index.html";
    setProgress(progress);

    const wwwSourcesDir = appServer.wwwSourceDir;

    const templateEncoding = "utf-8";
    let templateHtml = await fs.readFile(wwwSourcesDir + "/index.html.tpl",{encoding: templateEncoding});
    templateHtml = templateHtml.replace(/$CACHEBREAKER$/g, progress.buildId);

    //Include nonmodule scripts ($INCLUDE_MANAGER6_NONMODULE_SCRIPTS$):
    // TODO: if manager6 scripts were packed into 1 file, use that.
    const nonModuleScripts = (await fs.readFile("/usr/share/pve-manager/manager6/listOfNonModuleScripts", {encoding: "utf-8"})).trim().split(" ");
    const scriptsBlock = nonModuleScripts.map((scriptName) => `<script type="text/javascript" src="/manager6/${scriptName}?ver=${progress.buildId}"></script>`).join("\n");
    templateHtml = templateHtml.replace("$INCLUDE_MANAGER6_NONMODULE_SCRIPTS$", scriptsBlock);

    await fs.writeFile(wwwSourcesDir + "/index.html", templateHtml, {encoding:templateEncoding});
}

async function bundleFiles(progress: WebBuildProgress, setProgress: (progress: WebBuildProgress) => void) {
    progress.diagnosis_state = "Bundle files";
    setProgress(progress);
    const outDir = `/var/tmp/${progress.buildId}`;

    console.log(`bundeling files to ${outDir}`);

    const orig_NODE_ENV = process.env.NODE_ENV;
    try {
        await viteBuild({
            root: appServer.wwwSourceDir,
            base: "/",
            build: {
                outDir: outDir,
                rollupOptions: {}
            }
        })
    }
    finally {
        process.env.NODE_ENV = orig_NODE_ENV; //Bugfix: Restore orig, because viteBuild sets this to "production"
    }

    return outDir;
}


export type BuildResult = {
    diagnosis_startedAt: Date,
    buildId: string,
    staticFilesDir?: string,
    diagnosis_buildOptions: BuildOptions
};