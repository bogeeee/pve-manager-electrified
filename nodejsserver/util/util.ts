import https from "node:https"
import express from 'express'
import axios, {AxiosRequestConfig} from "axios";
import {execa} from "execa";
import {ErrorWithExtendedInfo} from "restfuncs-server/Util";
import fsPromises from 'node:fs/promises';
import {PathLike} from "fs";

/**
 *
 * execute a conditional function, to decide for each request whether the (express-) middleware should be executed or not
 *
 * Example. Only serve when url starts with /u2f-api.js:
 * expressApp.use("/", conditionalMiddleware((req) => req.url.startsWith("/u2f-api.js"), express.static(this.wwwSourceDir) ));
 *
 * @returns
 */
export function conditionalMiddleware(conditionFn: (req: express.Request) => boolean, router: express.RequestHandler) {
      const result = express.Router();
      result.use("/", function (req: express.Request, res: express.Response, next: express.NextFunction) { // The express doc says, it wont't with .use. But is works ! This way it is more usefull to securely restrict ALL requests.
        if (conditionFn(req)) {
          next();
        }
        else {
          next("router"); // skip everything in this router. The express doc says next("route") -> BUG ???
        }
      });

      result.use(router);

      return result;
  }

export async function better_fetch(...args: Parameters<typeof fetch>) {
    const request = args[0] as any;
    let result: Awaited<ReturnType<typeof fetch>>;
    try {
        result = await fetch(...args);
    }
    catch (e) {
        if((e as any)?.message === "fetch failed") {
            // Throw with a better message
            throw new Error(`could not fetch url: ${request?.url?request.url:request.toString()}${ ((e as any)?.cause?.message)?`: ${(e as any).cause.message}`:""}`, {cause: e});
        }
        throw e;
    }

    if(!result.ok) {
        throw new Error(`could not fetch url: ${request?.url?request.url:request.toString()}:  ${result.status}: ${result.statusText}`)
    }
    return result;
}

/**
 * Axios without certificate check
 * @param url
 * @param config
 */
export async function axiosExt(url: string, config?: AxiosRequestConfig) {
    return axios.request({
        url,
        // Disable cert check:
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
        }),
        ...(config || {})
    })
}

export function errorToString(e: any): string {
    // Handle other types:
    if (!e || typeof e !== "object") {
        return String(e);
    }
    if (!e.message) { // e is not an ErrorWithExtendedInfo ?
        return JSON.stringify(e);
    }
    e = e as Error;

    return (e.name ? `${e.name}: ` : "") + (e.message || String(e)) +
        (e.stack ? `\n${e.stack}` : '') +
        (e.fileName ? `\nFile: ${e.fileName}` : '') + (e.lineNumber ? `, Line: ${e.lineNumber}` : '') + (e.columnNumber ? `, Column: ${e.columnNumber}` : '') +
        (e.cause ? `\nCause: ${errorToString(e.cause)}` : '')
}

export async function killProcessThatListensOnPort(port: number) {
    try {
        await execa("fuser", ["-n", "tcp", "-k", `${port}`]);

        console.log(`killed old process(es) on port ${port}`);
    }
    catch(e) {
        // ignore
    }
}

export async function sleep(ms: number) {
    return new Promise<void>((resolve, reject) => {
        setTimeout(resolve, ms);
    })
}

/**
 * Globally control diagnosis settings
 */
export const ErrorDiagnosis = {
    /**
     * Disabled by default, cause it might cost too much time
     */
    record_spawnAsync_stackTrace: false,

    /**
     * Always keeps the process alive (ignoring the spawnAsync's exitOnError parameter). Enable this to help tsx keep watching for file changes
     */
    keepProcessAlive: false,
}

function toplevelHandleError(caught: unknown, exit: boolean) {
    if (ErrorDiagnosis.keepProcessAlive) {
        console.error(caught);
        console.warn(`Keeping process alive after Error. see SpawnAsyncDiagnosis`)
        setTimeout(() => {
            console.log("...exit'ing after a while")
        }, 2000000000);
        return;
    }

    if (exit) {
        console.log(`Top level error handler hint: If you don't want to exit the process on this error, do: import {ErrorDiagnosis} from 'util'; ErrorDiagnosis.keepProcessAlive=true;`);
        throw caught;
    } else {
        console.error(caught);
    }
}

/**
 * Handles top level Errors, with advanced global options for error diagnosis
 * @see ErrorDiagnosis
 * @param fn
 * @param exitOnError produces an unhandled- rejection which exits the (nodejs) process.
 */
export function topLevel_withErrorHandling(fn: () => void, exitOnError = true) {
    try {
        fn();
    }
    catch (e) {
        toplevelHandleError(e, exitOnError);
    }
}

/**
 * Spawns fn and handles top level Errors, with advanced global options for error diagnosis
 * @see ErrorDiagnosis
 * @param fn
 * @param exitOnError produces an unhandled- rejection which exits the (nodejs) process.
 */
export function spawnAsync(fn: () => Promise<void>, exitOnError = true) {

    let spawnStack: string | undefined
    if (ErrorDiagnosis.record_spawnAsync_stackTrace) {
        spawnStack = new Error("Dummy error, to record creator stack").stack;
    }

    const promise = fn();
    promise.catch((caught) => {

        if(spawnStack) {
            // Fix spawnStack:
            spawnStack = spawnStack.replace(/^.*Dummy error, to record creator stack.*?\n/, ""); // remove that confusing line

            if (caught instanceof Error) {
                caught.stack = `${caught.stack}\n*** spawnAsync stack: ***\n${spawnStack}`
            } else {
                caught = fixErrorForJest(new Error(`Promise was rejected.\n${spawnStack}\n*** ignore this following stack and skip to 'reason' ****`, {cause: caught}));
            }
        }
        else {
            // Add hint:
            const hint = `Hint: if the stacktrace does not show you the place, where the async is forked, do: import {ErrorDiagnosis} from 'util'; ErrorDiagnosis.record_spawnAsync_stackTrace=true;`
            if (caught instanceof Error) {
                caught.message+="\n" +  hint;
            } else {
                caught = fixErrorForJest(new Error(`Promise was rejected. ${hint}`, {cause: caught}));
            }
        }

        toplevelHandleError(caught, exitOnError);
    });
}


/**
 * When running with jest, the cause is not displayed. This fixes it.
 * @param error
 */
export function fixErrorForJest(error: Error) {
    if(typeof process === 'object' && process.env.JEST_WORKER_ID !== undefined) { // Are we running with jest ?
        const cause = (error as any).cause;
        if(cause) {
            error.message = `${error.message}, cause: ${errorToString(cause)}\n*** end of cause ***`
        }
    }
    return error;
}

export async function fileExists(filePath: PathLike) {
    try {
        const stat = await fsPromises.stat(filePath);
        return true;
    } catch (e) {
        return false;
    }
}