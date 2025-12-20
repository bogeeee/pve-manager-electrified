import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import {build as viteBuild} from "vite";
import crypto from "crypto"
import {appServer} from './server.js';
import {fileExists, listSubDirs, parseJsonFile, throwError} from "./util/util.js";
import {execa} from "execa";
import {Buffer} from "node:buffer"
import semver from "semver";
import {PromiseTask} from "./util/PromiseTask.js";
import _ from "underscore";
import path from "node:path";


export type BuildOptions = {
    // Warning: All fields are exposed to the public non-logged-on user:

    /**
     * Bundles everything. Use for production (non ViteDevServer)
     */
    buildStaticFiles: boolean,

    enablePlugins: boolean
}

export default class WebBuildProgress extends PromiseTask<BuildResult> {
    // Warning: All fields are exposed to the public non-logged-on user:

    buildOptions!: BuildOptions;

    buildId = crypto.randomBytes(16).toString('base64').replace(/\//g,'_').replace(/==$/g,"");

    diagnosis_createdAt = new Date();

    diagnosis_state?: string

    protected async run(): Promise<BuildResult> {
        this.checkCanceled();
        console.log("Building web: " + this.buildId);
        await this.createIndexHtml();
        this.checkCanceled();
        await this.createPluginList();
        // copy & modify package.json to enable/disable plugins
        // create listPlugins.js
        await this.npmInstall();
        this.checkCanceled();
        if(this.buildOptions.enablePlugins) {
            await this.checkAndFixPluginPackages();
        }
        this.checkCanceled();
        await this.typeCheck();
        this.checkCanceled();


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
     * Creates the _generated_pluginList.ts file
     */
    async createPluginList() {
        this.diagnosis_state = "Create plugin list"; this.fireProgressChanged();

        const wwwSourcesDir = appServer.wwwSourceDir;

        // Create package list:
        let packages: {name: string, diagnosis_dir?: string}[] = [];
        if(this.buildOptions.enablePlugins) {
            // Compatibility check:
            WebBuildProgress.getClusterPackages().forEach(entry => {
                if(!this.packageIsCompatible(entry.dir)) {
                    throw new Error(`The ${entry.pkg.name} plugin is not compatible with this PVE (pve-me-ui package) version. Plugin dir: ${entry.dir}`);
                }
            })


            // note: Duplicates can be here but will be filtered out later by Application.ts#_registerPlugin
            packages = [
                ...WebBuildProgress.getUiPluginSourceProjects_fixed().map(p => {return {name: p.pkg.name, diagnosis_dir: p.dir}}),
                ...WebBuildProgress.getClusterPackages().map(p => {return {name: p.pkg.name, diagnosis_dir: p.dir}}),
                ...appServer.electrifiedJsonConfig.plugins.filter(p => p.codeLocation === "npm").map(p => {return {name: p.name}})
            ];
        }

        // Write .ts:
        let index = -1;
        const tsContent = `// this files was generated during the web build, by the createPluginList() method.
import {PluginList} from "./electrified/Plugin"
export const generated_pluginList: PluginList = [];
${packages.map(pkgInfo => `import {default as plugin${++index}} from ${JSON.stringify(`${pkgInfo.name}/Plugin`)}; generated_pluginList.push({pluginClass: plugin${index}, packageName: ${JSON.stringify(pkgInfo.name)}, diagnosis_sourceDir: ${JSON.stringify(pkgInfo.diagnosis_dir)}});`).join("\n")}
`
        fs.writeFileSync(`${wwwSourcesDir}/_generated_pluginList.ts`, tsContent, {encoding: "utf8"});
    }

    /**
     * Installs npm packages
     */
    async npmInstall() {
        const headline = "NPM-installing packages";
        this.diagnosis_state = headline;

        // Determine dirs and package specs:
        const wwwSourcesDir = appServer.wwwSourceDir;
        const localSourcePackageDirs = this.buildOptions.enablePlugins?WebBuildProgress.getUiPluginSourceProjects_fixed().map(p => p.dir):[];
        let clusterPackageDirs = this.buildOptions.enablePlugins?listSubDirs(appServer.config.clusterPackagesBaseDir, true):[];
        let npmPluginPackageSpecs: string[] = this.buildOptions.enablePlugins?appServer.electrifiedJsonConfig.plugins.filter(p => p.codeLocation === "npm").map(p => `${p.name}@${p.version}`):[];
        // Filter out overridden packages:
        clusterPackageDirs = clusterPackageDirs.filter(c => !WebBuildProgress.getUiPluginSourceProjects_fixed().some(s => s.pkg.name === packageNameFromDir(c))); // Not those cluser packages that exist as source packages
        npmPluginPackageSpecs = npmPluginPackageSpecs.filter(n => !clusterPackageDirs.some(c => packageNameFromDir(c) === plainPackageName(n))); // Not those from npm that exist as cluster packages
        npmPluginPackageSpecs = npmPluginPackageSpecs.filter(n => !WebBuildProgress.getUiPluginSourceProjects_fixed().some(s => s.pkg.name === plainPackageName(n))); // Not those from npm that exist as source packages

        const tempDir = `/tmp/pve/webBuild/npm/${this.buildId}`;fs.mkdirSync(tempDir, {recursive: true}); // Create temp dir
        try {
            // Tar source and cluster packages first before installing them. Otherwise, dependencies are not installed under the main package.  Also This is a workaround, because otherwise npm install creates a node_modules folder with a lot of the packages and this is a performance nightmare under the corosynced path: /dev/pve
            const packedFiles: string[] = [];
            for (const packageDir of [...localSourcePackageDirs, ...clusterPackageDirs]) {
                const dirName = `${path.basename(packageDir)}`;
                const packageName = `pveme-ui-plugin-${dirName}`;

                this.diagnosis_state = `${headline} > packing ${packageDir}`

                // Validity check package name in package.json:
                let pkg = parseJsonFile(`${packageDir}/package.json`) as any;
                if (pkg.name !== packageName) {
                    throw new Error(`Package name in ${packageDir}/package.json does not match the name of the directory. Got: ${pkg.name}, expected: ${packageName}`);
                }

                // Pack file:
                //await execa("npm", ["pack", packageDir, "--pack-destination", tempDir]);
                const packedFile = `${tempDir}/${pkg.name}-${pkg.version}.tar`;
                await execa("tar", ["-c", "--exclude=node_modules", "--exclude=package-lock.json", "-f", packedFile, "."], {cwd: packageDir});
                await fileExists(packedFile) || throwError("Packed file does not exist");

                packedFiles.push(packedFile);
            }

            // Install npm packages + those from localPackageDirs + npm plugins and all their dependencies. This unpacks the tars
            await this.execa_withProgressReport(`${headline}`, "npm", ["install", "--ignore-scripts", "--no-audit", "--save", "false", ...npmPluginPackageSpecs, appServer.thisNodejsServerDir, ...packedFiles], {cwd: wwwSourcesDir})

            // Create symlinks to the local packages (instead of having copies)
            this.diagnosis_state = `${headline} > creating symlinks to local packages`;
            [appServer.thisNodejsServerDir, ...localSourcePackageDirs].forEach(dir => {
                const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, {encoding: "utf8"}));
                fs.rmSync(`${wwwSourcesDir}/node_modules/${pkg.name}`, {recursive: true}); // remove existing folder
                fs.symlinkSync(dir, `${wwwSourcesDir}/node_modules/${pkg.name}`); // create link
            })

            // The following works only with tsc but not with esbuild sadly. So we can only "import type" + do dependency injection to communicate with the plugin:
            // Symlink node_modules/pveme-ui -> wwwSourceDir, so that plugin source projects which have a node_modules linked to wwwSourceDir/node_modules also find the "pveme-ui" package:
            fs.rmSync(`${wwwSourcesDir}/node_modules/pveme-ui`, {force: true, recursive: true}); // remove old, which npm has falsely installed as a copy (still leave this line)
            fs.symlinkSync(wwwSourcesDir, `${wwwSourcesDir}/node_modules/pveme-ui`);

            // Symlink all source package's node_modules -> wwwSourceDir/node_modules:
            localSourcePackageDirs.forEach(dir => {
                fs.rmSync(`${dir}/node_modules`, {force: true, recursive: true}); // remove old
                fs.symlinkSync(`${wwwSourcesDir}/node_modules`, `${dir}/node_modules`);
            });
        }
        finally {
            await fsPromises.rm(tempDir, {recursive: true, force: true});
        }

        function packageNameFromDir(dir: string) {
            return `pveme-ui-plugin-${path.basename(dir)}`
        }

        function plainPackageName(packageSpec: string) {
            return packageSpec.substring(0, packageSpec.indexOf("@"));
        }
    }

    async checkAndFixPluginPackages() {
        const localSourcePackageSpecs = WebBuildProgress.getUiPluginSourceProjects_fixed().map(p => {return {name: p.pkg.name as string, dir: p.dir, codeLocation: "local"}});
        const npmPluginPackageSpecs = appServer.electrifiedJsonConfig.plugins.filter(p => p.codeLocation === "npm").map(p => {return {name: p.name, dir: `${appServer.wwwSourceDir}/node_modules/${p.name}`, codeLocation: p.codeLocation}});
        for(const it of [...localSourcePackageSpecs, ...npmPluginPackageSpecs]) {
            const pkg = parseJsonFile(`${it.dir}/package.json`) as any;

            // Security: check peerDependencies field, so you can't sneak packages to be installed there (which are not listed in NPM in the overview dependency counter)
            if(pkg.peerDependencies && !_.isEqual(Object.keys(pkg.peerDependencies),["pveme-ui"])) {
                throw new Error(`Package ${it.name} must only have 'pveme-ui' as peerDependency. Actual: ${JSON.stringify(pkg.peerDependencies)}`);
            }

            if(it.codeLocation === "npm") {
                // Security: Copy-over files from example dir, so you can't hide code /logic there, which might be overlooked in a quick review.
                if (await fileExists(appServer.config.examplePluginDir)) { // example dir should usually exist in a prod environment
                    for (const fileName of ["_pluginTypeFix.ts", "tsconfig.json"]) {
                        await fsPromises.copyFile(`${appServer.config.examplePluginDir}/${fileName}`, `${it.dir}/${fileName}`);
                    }
                } else {
                    if (!(process.env.NODE_ENV === "development" || !this.buildOptions.buildStaticFiles)) {
                        throw new Error(`Dir does not exist: ${appServer.config.examplePluginDir}`)
                    }
                }
            }
        }

    }

    /**
     * Like execa, but reports stdout to the diagnosis_state
     * @param prefix
     * @param file
     * @param args
     * @param options type is: import {options} from "execa"
     */
    async execa_withProgressReport(prefix: string, file: string, args: readonly string[], options?: any /* Bug workaround: using any, because typescript-rtti emits wrong "import" code */ ) {
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
                    // Expose debug info also in production, so users can report error stacks:
                    sourcemap: "inline",
                    minify: false, // Note: When minifying, www/electrified/Plugin.ts#fixPluginClass does not work anymore, cause it expects the classname to be "DummyPluginBase"
                }
            })
        }
        finally {
            process.env.NODE_ENV = orig_NODE_ENV; //Bugfix: Restore orig, because viteBuild sets this to "production"
        }

        return outDir;
    }

    packageIsCompatible(packageDir: string) {
        const pvemeUiPackageVersion = WebBuildProgress.getPvemeUiPackage().version as string;

        const packageJson = `${packageDir}/package.json`;
        let pkg = parseJsonFile(packageJson) as any;

        let peerDepVersion: string | undefined = pkg.peerDependencies?.["pveme-ui"];
        if(!peerDepVersion) {
            throw new Error(`Plugin package ${pkg.name} does not declare the pveme-ui peerDependency in ${packageJson}#peerDependencies#pveme-ui`);
        }

        return semver.satisfies(pvemeUiPackageVersion, peerDepVersion, {includePrerelease: true});
    }




    /**
     * ... + fixes the name in package.json
     */
    static getUiPluginSourceProjects_fixed() {
        const pvemeUiPackageVersion = WebBuildProgress.getPvemeUiPackage().version as string;

        const baseDir = appServer.config.pluginSourceProjectsDir;
        if(!fs.existsSync(baseDir)) {
            return [];
        }
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
            let pkg = parseJsonFile(packageJson) as any;


            // *** Check / fix package settings ***
            let needsWrite = false;
            // Fix package name:
            if(pkg.name !== name) {
                pkg.name = name;
                needsWrite = true;
            }
            //Check and fix declared pveme-ui peerDependency:
            let peerDepVersion: string | undefined = pkg.peerDependencies?.["pveme-ui"];
            if(peerDepVersion) {
                if(!semver.satisfies(pvemeUiPackageVersion, peerDepVersion, {includePrerelease: true})) {
                    throw new Error(`The ${name} plugin declares, that it's not compatible with this PVE (pve-me-ui package) version: ${pvemeUiPackageVersion}'. Instead, it wants '${peerDepVersion}'. Please check the value in ${packageJson}#peerDependencies#pveme-ui`)
                }
            }
            else {
                pkg.peerDependencies = {...(pkg.peerDependencies||{}), "pveme-ui": `^${pvemeUiPackageVersion}`}
                needsWrite = true;
            }
            // write:
            if(needsWrite) {
                fs.writeFileSync(packageJson, JSON.stringify(pkg, undefined, 4),{encoding: "utf8"});
            }

            return {
                dir,
                pkg
            }
        });
    }

    static getClusterPackages() {
        return listSubDirs(appServer.config.clusterPackagesBaseDir, true).map(dir => {
            let pkg = parseJsonFile(`${dir}/package.json`) as any;

            return {
                dir,
                pkg
            }
        })
    }

    static getPvemeUiPackage() {
        return JSON.parse(fs.readFileSync(`${appServer.wwwSourceDir}/package.json`, {encoding: "utf8"}));
    }
}

export type BuildResult = {
    diagnosis_startedAt: Date,
    buildId: string,
    staticFilesDir?: string,
    diagnosis_buildOptions: BuildOptions
};