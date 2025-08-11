import {RestfuncsClient} from "restfuncs-client";
import type {IServerSession} from "restfuncs-common";

interface WithPermissionCheck extends IServerSession {
    ensurePermissionsAreUp2Date(): Promise<void>;
}

/**
 * Will re-fetch the permissions, even when using websockets
 */
export class ElectrifiedRestfuncsClient<S extends WithPermissionCheck> extends RestfuncsClient<S> {
    async doCall(methodName: string, args: any[]) {
        try {
            return await super.doCall(methodName, args);
        }
        catch (e) {
            if(e?.cause?.name === "NeedToRefreshPermissionsViaHttp") {
                await this.doCall_http("ensurePermissionsAreUp2Date",[]);
                return await super.doCall(methodName, args);
            }

            throw e;
        }
    }
}