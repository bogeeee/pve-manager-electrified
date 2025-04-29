import {ServerSession} from "restfuncs-server";
import {remote} from "restfuncs-server";
import {ServerSessionOptions} from "restfuncs-server";
import {appServer} from "./server.js";
import WebBuildProgress, {BuildOptions} from "./WebBuilder.js";
import {deleteDir, errorToHtml} from "./util/util.js";
import {rmSync} from "fs";
import fs from "node:fs";
import {execa} from "execa";

export class ElectrifiedSession extends ServerSession {
    static options: ServerSessionOptions = {
        exposeErrors: true, // It's an open source project so there's no reason to hide the stracktraces
        exposeMetadata: true,
        logErrors: false, // They're fully reported to the client, so no need to also log them in production
        devDisableSecurity: (process.env.NODE_ENV === "development") // Set to a fix value because the vite build changes this to "production" during runtime)
    }

    @remote({isSafe: true, validateResult: false})
    getWebBuildState() {
        // TODO: check auth

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
                ...appServer.builtWeb,
                promiseState: {
                    state: appServer.builtWeb.promiseState.state,
                    rejectReason: appServer.builtWeb.promiseState.state === "rejected"?errorToHtml(appServer.builtWeb.promiseState.rejectReason):undefined,
                },
            }
        };
    }

    @remote()
    async rebuildWeb(buildOptions: BuildOptions) {
        await appServer.buildWeb(buildOptions);
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
        execa("/bin/sh", ["-c", "apt install -y pve-manager-electrified- pve-manager+"],{
            detached: true,
        });
    }
}