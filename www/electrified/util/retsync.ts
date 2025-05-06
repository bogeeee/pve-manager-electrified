// Retsync means: retryable-synchronous.
// retsync code is synchronous code, which when deep inside, it needs to wait for some Promise, it makes the ancestor await it and re-run that code again.
// The "ancestor" is a retsync2promise call
// Semantics: Retsync code must be repeatable. It can change state, as long as that leads to the same result when repeated. R

type Retsync2promiseOptions = {
    /**
     * Whenever retsyncFn hits a promise2retsync. it is run again and checked, if it behaves fine and repeatable and hits that same promise again (saves it properly)
     */
    checkSaved?: boolean
}

const resolvedPromiseValues = new WeakMap<Promise<any>, unknown>();

/**
 * Let's you run retsync code and wait, till it is finished.
 * @param repeatableFn
 * @param options
 */
export async function retsync2promise<T>(repeatableFn: () => T, options: Retsync2promiseOptions = {}): Promise<T> {
    while(true) {
        try {
            return repeatableFn();
        } catch (e) {
            if (e instanceof RetsyncWaitsForPromiseException) {
                if (options.checkSaved !== false) {
                    const optionHint = `Hint: See also: Retsync2promiseOptions#checkSaved`
                    // Check if repeatableFn is behaving in repeatable symantics and saves the promise
                    try {
                        repeatableFn();
                        throw new Error(`repeatableFn is not repeatable. On the first run, it was waiting for a Promise by calling promise2retsync (see cause). After a second immediate test run, it returned successful without such.\n${optionHint}`, {cause: e});
                    } catch (eChecked) {
                        if (!(eChecked !== null && eChecked instanceof RetsyncWaitsForPromiseException)) {
                            throw new Error(`repeatableFn is not repeatable. On the first run, it was waiting for a Promise by calling promise2retsync. After a second immediate test run, it threw.\n ${optionHint}\n First run's stack: \n${e.stack}\n 2nd run's stack: See cause`, {cause: eChecked});
                        }

                        eChecked.promise.then().catch(); // Make sure, that promise is caught once, to prevent unhandledRejections, just because of our checking functionality.

                        if (eChecked.stack !== e.stack) {
                            throw new Error(`repeatableFn is not repeatable. On the first run, it was waiting for a Promise by calling promise2retsync. After a second immediate test run, it behaved diffently.\n ${optionHint}\n First run's stack: \n${e.stack}\n 2nd run's stack: See cause`, {cause: eChecked});
                        }
                        if (eChecked.promise !== e.promise) {
                            e.message = `The savedPromise was not saved = you provided a different instance on a second run,... \n ${optionHint}`, {cause: new Error("...or repeatableFn does not behave repeatable")};
                            throw e;
                        }
                    }
                }

                resolvedPromiseValues.set(e.promise, await e.promise);
                // Try again. Now it will hit the resolved value
            } else {
                throw e;
            }
        }
    }
}

/**
 * Makes a promise usable in retsync code.
 * @param savedPromise You must save/fix the promise somewhere, so you reuse it the next time you encounter it.
 */
export function promise2retsync<T>(savedPromise: Promise<T>): T {
    if(resolvedPromiseValues.has(savedPromise)) {
        return resolvedPromiseValues.get(savedPromise) as T;
    }

    throw new RetsyncWaitsForPromiseException(savedPromise)
}



export class RetsyncWaitsForPromiseException extends Error {
    promise: Promise<any>;

    constructor(promise: Promise<any>) {
        super("Some retsync style code (see call stack / caller of promise2retsync) want to await an async operation. To make this possible, you need to it on some ancestor caller level with retsync2promise. I.e. 'const result = await retsync2promise(() => {...your **retryable*** - synchronous code...}});");
        this.promise = promise;
    }
}



/**
 * Makes a an async function usable in retsync code.
 */
//export function asyncFn2retsync<T>(asyncFn: () => Promise<T>): T {
    // The call must be re-identified. It's only possible, when all reads were recorded, like with react-deepwatch. See react-deepwatch.txt
//}
