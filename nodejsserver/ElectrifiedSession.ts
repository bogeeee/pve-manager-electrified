import {ServerSession} from "restfuncs-server";
import {remote} from "restfuncs-server";
import {ServerSessionOptions} from "restfuncs-server";
import {appServer} from "./server";
import {BuildOptions} from "./WebBuilder";

export class ElectrifiedSession extends ServerSession {
    static options: ServerSessionOptions = {
        exposeErrors: true, // It's an open source project so there's no reason to hide the stracktraces
        exposeMetadata: true,
        logErrors: false, // They're fully reported to the client, so no need to also log them
    }

    @remote({isSafe: true})
    getWebBuildState() {
        // TODO: check auth
        return {
            developWwwBaseDir: appServer.config.developWwwBaseDir,
            wwwSourceDir: appServer.wwwSourceDir,
            bundledWWWDir: appServer.bundledWWWDir,
            activeBuildResult: appServer.activeBuildResult?{
                buildId: appServer.activeBuildResult.buildId,
                diagnosis_startedAt: appServer.activeBuildResult.diagnosis_startedAt,
                staticFilesDir: appServer.activeBuildResult.staticFilesDir,
                diagnosis_buildOptions: appServer.activeBuildResult.diagnosis_buildOptions
            }:undefined,
            diagnois_latestBuildOptions: this.diagnois_getLatestBuildOptions(),
            diagnosis_webBuilder: appServer.diagnosis_webBuilder?{
                buildId: appServer.diagnosis_webBuilder.buildId,
                diagnosis_state: appServer.diagnosis_webBuilder.diagnosis_state,
                diagnosis_createdAt:  appServer.diagnosis_webBuilder.diagnosis_createdAt,
            }: undefined,
        };
    }

    @remote()
    async rebuildWeb(buildOptions: BuildOptions) {
        await appServer.requestBuild(buildOptions);
    }

    protected diagnois_getLatestBuildOptions(): BuildOptions {
        return appServer.reBuildRequested || appServer.diagnosis_webBuilder?.buildOptions || appServer.activeBuildResult!.diagnosis_buildOptions;
    }
}