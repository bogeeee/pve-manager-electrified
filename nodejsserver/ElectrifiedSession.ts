import {ServerSession} from "restfuncs-server";
import {remote} from "restfuncs-server";
import {ServerSessionOptions} from "restfuncs-server";
import {appServer} from "./server";
import {BuildOptions} from "./WebBuilder";
import {errorToString} from "./util/util";
import {errorToHtml} from "restfuncs-server/Util";

export class ElectrifiedSession extends ServerSession {
    static options: ServerSessionOptions = {
        exposeErrors: true, // It's an open source project so there's no reason to hide the stracktraces
        exposeMetadata: true,
        logErrors: false, // They're fully reported to the client, so no need to also log them in production
        devDisableSecurity: (process.env.NODE_ENV === "development") // Set to a fix value because the vite build changes this to "production" during runtime)
    }

    @remote({isSafe: true})
    getWebBuildState() {
        // TODO: check auth
        return {
            developWwwBaseDir: appServer.config.developWwwBaseDir,
            wwwSourceDir: appServer.wwwSourceDir,
            bundledWWWDir: appServer.bundledWWWDir,
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
}