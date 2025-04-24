import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import {build as viteBuild} from "vite";
import crypto from "crypto"
import { appServer } from './server.js';
import {PromiseTask} from "./util/util.js";
import {execa, Options} from "execa";
import {Buffer} from "node:buffer"
import path from "node:path";


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
        await this.npmInstall();
        await this.typeCheck();


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
        let templateHtml = await fsPromises.readFile(wwwSourcesDir + "/index.html.tpl",{encoding: templateEncoding});
        templateHtml = templateHtml.replace(/\$CACHEBREAKER\$/g, this.buildId);

        //Include nonmodule scripts ($INCLUDE_MANAGER6_NONMODULE_SCRIPTS$):
        const nonModuleScripts = (await fsPromises.readFile("/usr/share/pve-manager/manager6/listOfNonModuleScripts", {encoding: "utf-8"})).trim().split(" ");
        const scriptsBlock = nonModuleScripts.map((scriptName) => `<script type="text/javascript" src="/manager6/${scriptName}?ver=${this.buildId}"></script>`).join("\n");
        templateHtml = templateHtml.replace("$INCLUDE_MANAGER6_NONMODULE_SCRIPTS$", scriptsBlock);

        await fsPromises.writeFile(wwwSourcesDir + "/index.html", templateHtml, {encoding:templateEncoding});
    }

    /**
     * Installs npm packages
     */
    async npmInstall() {
        const headline = "NPM-installing packages";
        this.diagnosis_state = headline;

        const wwwSourcesDir = appServer.wwwSourceDir;

        WebBuildProgress.getUiPluginSourceProjects_fixed()

        const localPackageDirs = [appServer.thisNodejsServerDir, "/root/pveme-plugin-source-projects/example"];
        const npmPluginPackageNames: string[] = []

        // Install npm packages + those from localPackageDirs + npm plugins and all their dependencies. This **copies** the local packages
        await this.execa_withProgressReport(`${headline}`, "npm", ["install", "--ignore-scripts", "--save", "false", ...localPackageDirs, ...npmPluginPackageNames], {cwd: wwwSourcesDir})

        // Create symlinks to the local packages (instead of copies), be
        this.diagnosis_state = `${headline} > creating symlinks to local packages`
        localPackageDirs.forEach(dir => {
            const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, {encoding: "utf8"}));
            fs.rmSync(`${wwwSourcesDir}/node_modules/${pkg.name}`, {recursive: true}); // remove existing folder
            fs.symlinkSync(dir, `${wwwSourcesDir}/node_modules/${pkg.name}`); // create link
        })

        // Symlink node_modules/pveme-ui -> wwwSourceDir, so that plugin source projects which have a node_modules linked to wwwSourceDir/node_modules also find the "pveme-ui" package:
        fs.rmSync(`${wwwSourcesDir}/node_modules/pveme-ui`, {force:true, recursive: true}); // remove old
        fs.symlinkSync(wwwSourcesDir,`${wwwSourcesDir}/node_modules/pveme-ui`);
    }

    /**
     * Like execa, but reports stdout to the diagnosis_state
     * @param prefix
     * @param execa_args
     */
    async execa_withProgressReport(prefix: string, file: string, args: readonly string[], options?: Options) {
        this.diagnosis_state = `${prefix}`;this.fireProgressChanged();

        const process = execa(file, args, options);
        // Display progress:
        process.stdout?.on("data", (data: Buffer) => {
            this.diagnosis_state = `${prefix}: ${data.toString()}`;
            this.fireProgressChanged();
        })
        await process
    }

    async typeCheck() {
        this.diagnosis_state = "Type checking with tsc";
        const wwwSourcesDir = appServer.wwwSourceDir;
        await execa("npm", ["run", "check"], {cwd: wwwSourcesDir})
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

    /**
     * ... + fixes the name in package.json
     */
    static getUiPluginSourceProjects_fixed() {
        const baseDir = appServer.config.pluginSourceProjectsDir;
        const dirs = fs.readdirSync(baseDir, {encoding:"utf8"});
        return dirs.filter(dirName => fs.statSync(`${baseDir}/${dirName}`).isDirectory()).map(dirName => {
            const dir = `${baseDir}/${dirName}`;

            // Check dirname:
            const PKG_NAME_REGEX = /^[a-z0-9-]+$/;
            if(!dirName.match(PKG_NAME_REGEX)) {
                throw new Error(`Invalid directory name: ${dir}. It must only consist characters that are allowed in an npm package name`);
            }

            const name = `pveme-ui-plugin-${dirName}`;

            const packageJson = `${dir}/package.json`;
            let pkg: any;
            try {
                pkg = JSON.parse(fs.readFileSync(packageJson, {encoding: "utf8"}));
            }
            catch (e) {
                throw new Error(`Error, parsing ${packageJson}: ${(e as any)?.message}`, {cause: e});
            }
            
            // Fix package:
            if(pkg.name !== name) {
                pkg.name = name;

                // write:
                fs.writeFileSync(packageJson, JSON.stringify(pkg, undefined, 4),{encoding: "utf8"});
            }

            return {
                dir,
                pkg
            }
        });
    }
}








export type BuildResult = {
    diagnosis_startedAt: Date,
    buildId: string,
    staticFilesDir?: string,
    diagnosis_buildOptions: BuildOptions
};