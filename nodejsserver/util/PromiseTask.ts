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
    promiseState: { state: "pending", cancelRequested?: unknown } | { state: "resolved", resolvedValue: T } | { state: "rejected", rejectReason: any };

    public progressListeners: ((p: this) => void)[];
    public cancelListeners: Set<((reason: unknown) => void)>;

    private _resolve!: ((value: T) => void);
    private _reject!: ((reason?: any) => void);


    protected abstract run(): Promise<T>;

    /**
     *
     * @param executor
     * @deprecated You must use the static create method instead!
     */
    constructor(executor?: (resolve: (value: (PromiseLike<T> | T)) => void, reject: (reason?: any) => void) => void) {
        if (executor) { // created by native code?. This occurs i.e. when using MyPromiseTask.create().then. The native then methods looks at the "constructor" field and wants to create a new promise and we land here
            super(executor);
        } else {
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

        if (options) {
            Object.assign(result, options);
        }

        // Exec run:
        (async () => {
            try {
                result.fireProgressChanged(); // Notify listeners on the initial state
                const t = await result.run();
                result.checkCanceled()
                result.resolve(t);
            } catch (e) {
                result.reject(e)
            }
        })();

        if (!result.exitOnUnhandledRejection) {
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
    onProgress(listener: (p: this) => void) {
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
        if (this.promiseState.state !== "pending") {
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
    onCancel(listener: (reason: unknown) => void) {
        this.cancelListeners.add(listener);
        return this;
    }

    /**
     * Removes a cancel listener
     * @param listener
     */
    offCancel(listener: (reason: unknown) => void) {
        this.cancelListeners.delete(listener);
        return this;
    }

    /**
     * Should be called by run often. Will throw, if this task was canceled.
     */
    checkCanceled() {
        if (this.promiseState.state === "pending" && this.promiseState.cancelRequested) {
            throw this.promiseState.cancelRequested;
        }
    }

    /**
     * Sleeps for the specified amount of time, while it support cancelling by {@see #cancel}.
     * @param ms
     */
    async sleep(ms: number) {
        const me = this;
        return new Promise<void>((resolve, reject) => {
            let sleepWasRejeted = false;
            const cancelListener = (reason: unknown) => {
                reject(reason);
                sleepWasRejeted = true;
            }
            me.onCancel(cancelListener);

            setTimeout(() => {
                me.offCancel(cancelListener); // Unregister

                if (!sleepWasRejeted) {
                    resolve();
                }
            }, ms);
        })
    }

}