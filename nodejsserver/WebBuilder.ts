import fs from 'node:fs/promises';
import {build as viteBuild} from "vite";
import crypto from "crypto"
import { appServer } from './server.js';
import {PromiseTask} from "./util/util";


export type BuildOptions = {
    // Warning: All fields are exposed to the public non-logged-on user:

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

export default class WebBuildProgress extends PromiseTask<BuildResult> {
    // Warning: All fields are exposed to the public non-logged-on user:

    buildOptions!: BuildOptions;

    buildId = crypto.randomBytes(16).toString('base64').replace(/\//,'_').replace(/==$/,"");

    diagnosis_createdAt = new Date();

    diagnosis_state?: string

    protected async run(): Promise<BuildResult> {
        await this.createIndexHtml();
        // copy & modify package.json to enable/disable plugins
        // create listPlugins.js
        // npm prune (without triggers)
        // npm prune on all /root/pveme-plugin projects(without triggers)


        if (this.buildOptions.buildStaticFiles) {
            const bundledFilesDir = await this.bundleFiles();

            return {
                diagnosis_startedAt: this.diagnosis_createdAt,
                buildId: this.buildId,
                staticFilesDir: bundledFilesDir,
                diagnosis_buildOptions: this.buildOptions,
            };
        } else {
            return {
                diagnosis_startedAt: this.diagnosis_createdAt,
                buildId: this.buildId,
                diagnosis_buildOptions: this.buildOptions,
            }
        }
    }

    /**
     * Creates the index.html from the template
     * NOTE, that there are  additional replacements done when served during runtime. See index.ts#serveIndexHtml
     */
    async createIndexHtml() {
        this.diagnosis_state = "Create index.html"; this.fireProgressChanged();

        const wwwSourcesDir = appServer.wwwSourceDir;

        const templateEncoding = "utf-8";
        let templateHtml = await fs.readFile(wwwSourcesDir + "/index.html.tpl",{encoding: templateEncoding});
        templateHtml = templateHtml.replace(/\$CACHEBREAKER\$/g, this.buildId);

        //Include nonmodule scripts ($INCLUDE_MANAGER6_NONMODULE_SCRIPTS$):
        const nonModuleScripts = (await fs.readFile("/usr/share/pve-manager/manager6/listOfNonModuleScripts", {encoding: "utf-8"})).trim().split(" ");
        const scriptsBlock = nonModuleScripts.map((scriptName) => `<script type="text/javascript" src="/manager6/${scriptName}?ver=${this.buildId}"></script>`).join("\n");
        templateHtml = templateHtml.replace("$INCLUDE_MANAGER6_NONMODULE_SCRIPTS$", scriptsBlock);

        await fs.writeFile(wwwSourcesDir + "/index.html", templateHtml, {encoding:templateEncoding});
    }

    async bundleFiles() {
        this.diagnosis_state = "Bundle files"; this.fireProgressChanged();

        const outDir = `/var/tmp/${this.buildId}`;

        console.log(`bundeling files to ${outDir}`);

        const orig_NODE_ENV = process.env.NODE_ENV;
        try {
            await viteBuild({
                root: appServer.wwwSourceDir,
                base: "/",
                build: {
                    outDir: outDir,
                    rollupOptions: {
                    },
                    //sourcemap: "inline", //you could enable this, if it is handy
                    //minify: false, //you could disable this, if it is handy
                }
            })
        }
        finally {
            process.env.NODE_ENV = orig_NODE_ENV; //Bugfix: Restore orig, because viteBuild sets this to "production"
        }

        return outDir;
    }
}








export type BuildResult = {
    diagnosis_startedAt: Date,
    buildId: string,
    staticFilesDir?: string,
    diagnosis_buildOptions: BuildOptions
};