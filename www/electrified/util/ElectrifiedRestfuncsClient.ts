import {RestfuncsClient} from "restfuncs-client";
import type {IServerSession} from "restfuncs-common";
import {RetryableError, retryTilSuccess} from "./util";

interface WithPermissionCheck extends IServerSession {
    ensurePermissionsAreUp2Date(): Promise<void>;
}

/**
 * Will re-fetch the permissions, even when using websockets
 */
export class ElectrifiedRestfuncsClient<S extends WithPermissionCheck> extends RestfuncsClient<S> {
    async doCall(methodName: string, args: any[]) {
        return retryTilSuccess(async () => { // Exec with quiet some possible retries after a NeedToRefreshPermissionsViaHttp, see below.
            try {
                return await super.doCall(methodName, args);
            }
            catch (e) {
                if(e?.cause?.name === "NeedToRefreshPermissionsViaHttp") {
                    await this.doCall_http("ensurePermissionsAreUp2Date",[]);
                    // return await super.doCall(methodName, args); // Possible race condition when ticket is renewed just before this line. So instead we retry a few times.
                    throw new RetryableError("Call failed and threw Error with NeedToRefreshPermissionsViaHttp flag, but refreshing permissions and trying again did not work.", {cause: e});
                }

                throw e;
            }
        }, {initialRetryDelay: 0.3, maxTime: 10000 /* observed errors with only 1000ms maxTime (probably pve is stalling unauthorized requests a few seconds in a ticket renewal situation.*/})

    }
}