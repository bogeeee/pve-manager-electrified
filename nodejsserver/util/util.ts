import https, {Server} from "node:https"
import express from 'express'
import axios, {AxiosRequestConfig} from "axios";
import {execa} from "execa";
import fsPromises from 'node:fs/promises';
import {PathLike} from "fs";
import  {IncomingMessage, ServerResponse} from "node:http";
import {WebSocket, WebSocketServer, RawData} from "ws";
import escapeHtml from "escape-html";
import fs from "node:fs";
import {Duplex} from "node:stream";

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
export async function axiosExt(url: string, config?: any): Promise<any> { /* Bug workaround: using any, because typescript-rtti emits wrong js code when following the axios imports */
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

export function errorToHtml(e: any): string {
    // Handle other types:
    if(!e || typeof e !== "object") {
        return `<pre>${escapeHtml(String(e))}</pre>`;
    }
    if(!e.message) { // e is not an ErrorWithExtendedInfo ?
        return `<pre>${escapeHtml(JSON.stringify(e))}</pre>`;
    }
    e = e as Error;

    let title= (e.name ? `${e.name}: `: "") + (e.message || String(e))

    return `<b><pre>${escapeHtml( title)}</pre></b>` +
        (e.stack ? `\n<pre>${escapeHtml(e.stack)}</pre>` : '') +
        (e.fileName ? `<br/>\nFile: ${escapeHtml(e.fileName)}` : '') + (e.lineNumber ? `, Line: ${escapeHtml(e.lineNumber)}` : '') + (e.columnNumber ? `, Column: ${escapeHtml(e.columnNumber)}` : '') +
        (e.cause ? `<br/>\nCause:<br/>\n${errorToHtml(e.cause)}` : '')
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
export function spawnAsync(fn: () => Promise<void>, exitOnError:boolean) {

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

/**
 * Forwards(=proxies) them to another server
 * Also forwards the cookie
 * @param httpsServer
 * @param connectorFn connects to the target websocket server
 * @param destroyUnhandled false, if there is another on-upgrade handler after this one, that may also want to catch websocket connections
 */
export function forwardWebsocketConnections(httpsServer: Server<typeof IncomingMessage, typeof ServerResponse>, connectorFn: (req: IncomingMessage) => WebSocket | undefined, destroyUnhandled: boolean) {

    const wss = new WebSocketServer({noServer: true});
    wss.on('connection', (clientSocket, req, targetSocket?: WebSocket) => {
        // Validity check:
        if(!targetSocket) {
            fail("Illegal state: targetSocket param not passed")
            return;
        }

        let unforwardedMessagesToTarget: RawData[] | undefined = []; // In case, we have already retrieved messages from the client while the targetConnection is not yet open


        function fail(e: unknown) {
            topLevel_withErrorHandling(() => {
                for(const socket of [targetSocket, clientSocket]) {
                    if (socket && !(socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING)) {
                        socket.close(undefined, errorToString(e));
                    }
                }
            },false);
        }

        // Proxy messages from client to target server
        clientSocket.on('message', (message: RawData, isBinary) => {
            try {
                if (targetSocket.readyState === WebSocket.CONNECTING) {
                    !(unforwardedMessagesToTarget!.length >= 10) || throwError("Preventing resource exhaustion: Cannot cache more that 10 messages");
                    unforwardedMessagesToTarget!.push(message);
                } else if (targetSocket.readyState === WebSocket.OPEN) {
                    targetSocket.send(message, {binary: isBinary});
                } else {
                    throw new Error("Cannot forward message. targetSocket is closed");
                }
            }
            catch (e) {
                fail(e);
            }

        });

        // Proxy messages from target server to client
        targetSocket.on('message', (data: RawData, isBinary: boolean) => {
            try {
                if (clientSocket.readyState === WebSocket.OPEN) {
                    clientSocket.send(data,{binary: isBinary});
                } else {
                    throw new Error("Cannot forward message. clientSocket is closed")
                }
            }
            catch (e) {
                fail(e);
            }
        });

        targetSocket.on("open", ()=> {
            try {
                // Send unforwarded messages
                unforwardedMessagesToTarget!.forEach(m => {
                    targetSocket.send(m)
                });
                unforwardedMessagesToTarget = undefined;
            }
            catch (e) {
                fail(e);
            }
        });

        // Handle client disconnection
        clientSocket.on('close', () => {
            try {
                targetSocket.close();
            }
            catch (e) {
                fail(e);
            }
        });

        // Handle target server disconnection
        targetSocket.on('close', () => {
            try {
                clientSocket.close();
            }
            catch (e) {
                fail(e);
            }
        });

        // Error handling for both sockets
        clientSocket.on('error', (err: any) => fail(err));
        targetSocket.on('error', (err: any) => fail(err));
    });

    httpsServer.on('upgrade', (req: IncomingMessage, clientSocket: Duplex, head: Buffer) => {

        const targetSocket = connectorFn(req);
        if (!targetSocket) {
            if (destroyUnhandled) {
                clientSocket.destroy(new Error("No handled / url not allowed"));
                return;
            }
            return;
        }

        wss.handleUpgrade(req, clientSocket as any, head, function done(ws) {
            wss.emit('connection', ws, req, targetSocket);
        });
    });
}

export function throwError(e: string | Error) {
    if(e !== null && e instanceof Error) {
        throw e;
    }
    throw new Error(e);
}

export function reThrowWithHint(e: unknown, hint: string) {
    try {
        if(e instanceof Error) {
            // Add hint to error:
            e.message+= `\n${hint}`;
        }
    }
    catch (x) {
    }
    throw e;
}

export function isObject(value: unknown) {
    return value !== null && typeof value === "object";
}


/**
 * A better Promise: a TaskPromise, where you can see/subscribe to the progress and query the current state. {@see PromiseTask#promiseState}
 * Also, what's different to using a normal Promise:
 *  - A Promise is always created, even if fn fails **immediately** (makes it more consistent)
 *  - By default, not handling rejections does not result in an unhandled-rejection (exiting the program). It's assumed that this is a legal case, cause you can query the status anyway.
 *  - You can resolve, reject and request cancel externally.
 *
 * <p>Usage: Subclass it and implement run. Use the static create method instead of the constructor
 * <pre><code>
 * class MyTask extends PromiseTask<string>{
 *   myProgressField = "i did not make progress yet";
 *   protected async run() {
 *       this.myProgressField = "on the way"; this.fireProgressChanged()
 *       // ...
 *       this.checkCanceled(); // Call this from time to handle it
 *       return "myResult"
 *   }
 *}
 *
 * // Crate and run task:
 * const myTask = MyTask.create({
 *    // I.e.: register the initial progressListeners here, to not miss any progress
 *    progressListeners:[(x) => console.log(x)]
 * });
 * const result = await myTask;
 * </code></pre>
 *
 * </p>
 */
 export abstract class PromiseTask<T> extends Promise<T> {
    // *** Config: ***

    /**
     * Default: false
     */
    exitOnUnhandledRejection: boolean

    // *** State: ***

    /**
     * Type-safe way, to access the state
     */
    promiseState: {state: "pending", cancelRequested?: unknown} | {state: "resolved", resolvedValue: T} | {state: "rejected", rejectReason: any};

    public progressListeners: ((p:this) => void)[];
    public cancelListeners: Set<((reason:unknown) => void)>;

    private _resolve!: ((value: T) => void);
    private _reject!: ((reason?: any) => void);


    protected abstract run(): Promise<T>;

    /**
     *
     * @param executor
     * @deprecated You must use the static create method instead!
     */
    constructor(executor?: (resolve: (value: (PromiseLike<T> | T)) => void, reject: (reason?: any) => void) => void) {
        if(executor) { // created by native code?. This occurs i.e. when using MyPromiseTask.create().then. The native then methods looks at the "constructor" field and wants to create a new promise and we land here
            super(executor);
        }
        else {
            // Create a promise that is externally resolvable:
            let resolve: ((value: T) => void) | undefined = undefined;
            let reject: ((reason?: any) => void) | undefined = undefined;
            super((res, rej) => {
                resolve = res;
                reject = rej;
            });
            this._resolve = resolve!;
            this._reject = reject!;
        }

        this.exitOnUnhandledRejection = false;
        this.promiseState = {state: "pending", cancelRequested: false};
        this.progressListeners = [];
        this.cancelListeners = new Set<any>();
    }

    static create<C extends PromiseTask<any>>(this: new () => C, options?: Partial<C>): C {
        const result = new (this as any)() as C;

        if(options) {
            Object.assign(result, options);
        }

        // Exec run:
        (async () => {
            try {
                result.fireProgressChanged(); // Notify listeners on the initial state
                const t = await result.run();
                result.checkCanceled()
                result.resolve(t);
            }
            catch (e) {
                result.reject(e)
            }
        })();

        if(!result.exitOnUnhandledRejection) {
            // handle rejections:
            result.catch(e => {
            })
        }

        return result;
    }

    /**
     * Adds a progress listener (=when fields change, except the promiseState)
     * @param listener
     */
    onProgress(listener: (p:this) => void) {
        this.progressListeners.push(listener);
        return this;
    }

    fireProgressChanged() {
        for (const listener of this.progressListeners) {
            listener(this);
        }
    }

    resolve(value: T) {
        this.promiseState = {state: "resolved", resolvedValue: value};
        this._resolve(value);
    }

    reject(reason: any) {
        this.promiseState = {state: "rejected", rejectReason: reason};
        this._reject(reason);
    }

    /**
     * Cancels this task, resulting in a fail.
     * @param reason this will be thrown / be the rejectedReason
     */
    cancel(reason?: any) {
        if(this.promiseState.state !== "pending") {
            throw new Error(`Too late to cancel. Promise is alrady ${this.promiseState.state}`)
        }

        reason = reason || new Error("Task was cancelled")
        this.promiseState.cancelRequested = reason;

        // Inform listeners:
        this.cancelListeners.forEach(l => l(reason));
    }

    /**
     * Adds a cancel listener
     * @param listener
     */
    onCancel(listener: (reason:unknown ) => void) {
        this.cancelListeners.add(listener);
        return this;
    }

    /**
     * Removes a cancel listener
     * @param listener
     */
    offCancel(listener: (reason:unknown ) => void) {
        this.cancelListeners.delete(listener);
        return this;
    }

    /**
     * Should be called by run often. Will throw, if this task was canceled.
     */
    checkCanceled() {
        if(this.promiseState.state === "pending" && this.promiseState.cancelRequested) {
            throw this.promiseState.cancelRequested;
        }
    }

    /**
     * Sleeps for the specified amount of time, while it support cancelling by {@see #cancel}.
     * @param ms
     */
    async sleep(ms: number) {
        const me  = this;
        return new Promise<void>((resolve, reject) => {
            let sleepWasRejeted = false;
            const cancelListener = (reason:unknown) => {
                reject(reason);
                sleepWasRejeted = true;
            }
            me.onCancel(cancelListener);

            setTimeout(() => {
                me.offCancel(cancelListener); // Unregister

                if(!sleepWasRejeted) {
                    resolve();
                }
            }, ms);
        })
    }

}

export async function deleteDir(dir: string, ignoreNonExisting=false) {
     if(!fs.existsSync(dir)) {
         if(ignoreNonExisting) {
             return;
         }
         throw new Error(`Directory ${dir} does not exist`);
     }
    await execa("rm", ["-rf", dir]);
}


/**
 * Lists subdirs as full path
 */
export function listSubDirs(baseDir: string, ignoreNonExisting=false): string[] {
    if(!fs.existsSync(baseDir)) {
        if(!ignoreNonExisting) {
            throw new Error(`Directory does not exist: ${baseDir}`);
        }
        return [];
    }
    const dirs = fs.readdirSync(baseDir, {encoding: "utf8"})
    return dirs.filter(dirName => fs.statSync(`${baseDir}/${dirName}`).isDirectory()).map(dirName => `${baseDir}/${dirName}`);
}