import https from "node:https"

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
}

function toplevelHandleError(caught: unknown) {
    console.error(caught);
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
        toplevelHandleError(e);
    }
}

/**
 * Spawns fn and handles top level Errors, with advanced global options for error diagnosis
 * @see ErrorDiagnosis
 * @param fn
 * @param exitOnError for compatibility with nodejs
 */
export function spawnAsync(fn: () => Promise<void>, exitOnError = false) {

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

        toplevelHandleError(caught);
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
    }

    /**
     * Should be called by run often. Will throw, if this task was canceled.
     */
    checkCanceled() {
        if(this.promiseState.state === "pending" && this.promiseState.cancelRequested) {
            throw this.promiseState.cancelRequested;
        }
    }

}

