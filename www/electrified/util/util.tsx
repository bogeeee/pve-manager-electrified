import {CSSProperties, FunctionComponent, ReactNode, useEffect, useLayoutEffect, useState} from "react";

import {
    Button,
    ButtonGroup,
    Classes,
    Dialog as BlueprintDialog,
    DialogProps as BlueprintDialogProps, Icon,
    Intent,
    NonIdealState,
    NonIdealStateIconSize,
    ProgressBar,
    Tag,
    Tooltip
} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import { Dialog,  DialogTitle, Paper} from "@mui/material";
import {DialogProps} from "@mui/material/Dialog";
import * as React from "react";
import Draggable from 'react-draggable';
import ReactDOM from "react-dom";
import { createRoot } from 'react-dom/client';
import {watchedComponent} from "react-deepwatch";
import { ErrorBoundary } from "react-error-boundary";
import {gettext} from "../globals";


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
    try {
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
    catch (e) {
        return errorToString(new Error(`Error converting error to string. Original error's message: ${(e as any)?.message}`));
    }
}

/**
 * Removes redundant info from the error.stack + error.cause properties
 * @param error
 */
export function fixErrorStack(error: Error) {
    //Redundantly fix error.cause's
    //@ts-ignore
    if (error.cause && typeof error.cause === "object") {
        //@ts-ignore
        fixErrorStack(error.cause as Error);
    }

    if (typeof error.stack !== "string") {
        return;
    }

    // Remove repeated title from the stack:
    let title = (error.name ? `${error.name}: ` : "") + (error.message || String(error))
    if (error.stack?.startsWith(title + "\n")) {
        error.stack = error.stack.substring(title.length + 1);
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
}

function toplevelLogError(caught: unknown) {
    console.error(caught);
}

/**
 * Handles top level Errors, with advanced global options for error diagnosis
 * @see ErrorDiagnosis
 * @param fn
 * @param exitOnError produces an unhandled- rejection which exits the (nodejs) process.
 */
export function topLevel_withErrorLogging(fn: () => void, exitOnError = true) {
    try {
        fn();
    }
    catch (e) {
        toplevelLogError(e);
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

        toplevelLogError(caught);
    });
}

export async function showErrorDialog(e: unknown) {
    if (!(e instanceof Error)) {
        e = new Error(`Caught non-error value: ${e}`);
    }

    fixErrorStack(e as Error);
    console.error(e); // Also show in console, so there's a more accurate source map and better interactivity
    await showResultText(errorToString(e), "Error", "error");
}

/**
 * TODO: rename spawnWithErrorHandling
 * Shows an error dialog, if something goes wrong. Void version
 */
export function withErrorHandling(fn: () => void | Promise<void>): void {
    spawnAsync(async () => {
        try {
            await fn();
        }
        catch (e) {
            // Handle very very uncommon case of non-error:
            await showErrorDialog(e);
        }
    })
}

/**
 * Shows an error dialog, if something goes wrong. Version that returns back the value from fn
 */
export function returnWithErrorHandling<T>(fn: () => T): T {
    async function handle(e: unknown) {
        await showErrorDialog(e);
    }

    try {
        const result = fn();
        if(result !== null && result instanceof Promise) {
            result.catch(handle);
        }
        return result;
    }
    catch (e) {
        spawnAsync(async () => handle(e));
        return undefined as T
    }
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


export function throwError(e: string | Error): never {
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
 * Replacement for ExtJs's this.callParent(args);
 * Reason: In strict mode, Extjs ittself cannot find out the name of the caller method. Therefore we somehow have to specify it explicitly
 *
 * Example:
 * MyClass = Ext.define("myclass", {
 *     constructor: function() {
 *         callParent(MyClass, this, "constructor", arguments);
           ...
 *     }
 *
 *     myMethod: function() {
 *         let myObj = ...
 *         callParent(MyClass, this, "myMethod", [myObj]);
 *     }
 * });
 *
 *
 * Or:
 * @param callerClass Ext.Class Object: Class of the method that calls this function. Cause the thisObject gives not enough information. It could already be of a subclass.
 * @param thisObject
 * @param methodName
 * @param args
 */
export function callParent(callerClass: any, thisObject: {}, methodName: string, args?: IArguments | any[] | undefined): any {
    return callerClass.superclass[methodName].apply(thisObject, args || []);
}



/**
 * Synchronizes simultaneous operations that they don't get executed twice / unnecessary. While mimicing the failover behaviour of http fetches.
 * If the operation is already running, then subsequent calls will wait for that single result promise. On fail, all will fail.
 * But after such a fail, next exec will do a retry.
 */
export class DropConcurrentOperation<T> {
    resultPromise?: Promise<T>

    /**
     *  See class description
     */
    exec(operation: (() => Promise<T>)): Promise<T> {
        if(this.resultPromise) {
            return this.resultPromise
        }

        return (this.resultPromise = (async () => {
            try {
                return await operation()
            }
            finally {
                this.resultPromise = undefined;
            }
        })());
    }

    /**
     * Next executor will try again
     */
    fail() {
        this.resultPromise = undefined;
    }

    /**
     * ..., does not care if the the promise succeeded or errored
     */
    async waitTilIdle() {
        if(this.resultPromise) {
            try {
                await this.resultPromise
            }
            catch (e) {
                // The other "thread" cares about catching errors. We don't care
            }
        }
    }

    expectIdle() {
        if(this.resultPromise !== undefined) {
            throw new Error("Operation is not idle");
        }
    }
}

/**
 * like {@see DropConcurrentOperation} but it stores a map of multiple operations
 */
export class DropConcurrentOperationMap<K, T> {
    resultPromises = new Map<K, Promise<T>>()

    /**
     *  See class description
     */
    exec(key: K, operation: (() => Promise<T>)): Promise<T> {
        const existing = this.resultPromises.get(key);
        if(existing) {
            return existing;
        }

        const resultPromise = (async () => {
            try {
                return await operation()
            }
            catch (e) {
                this.fail(key) // Next one will try again
                throw e;
            }
        })();

        this.resultPromises.set(key, resultPromise);
        return resultPromise;
    }

    /**
     * Next executor will try again
     */
    fail(key: K) {
        this.resultPromises.delete(key);
    }

    /**
     * Waits for aöö outstanding results. Ignores failed
     */
    async getAllSucceeded(): Promise<T[]> {
        const result = []
        for(const promise of this.resultPromises.values()) {
            try {
                // @ts-ignore TS2345: Don't know why. This comes only when build is run with a ts-patch transformProgram transformer
                result.push(await promise);
            }
            catch (e) {
                // No throw. Not our concern if connection failed to initialize
            }
        }
        return result;
    }
}

/**
 * Concurrent and later exec calls will wait for that single promise to be resolved.
 * On a fail, the next exec call will try again.
 */
export class RetryableResolver<T> {
    resultPromise?: Promise<T>;

    /**
     * Concurrent and later exec calls will wait for that single promise to be resolved.
     * On a fail, the next exec call will try again.
     * @param resolver
     */
    exec(resolver: (() => Promise<T>)): Promise<T> {
        if (this.resultPromise === undefined) {
            return this.resultPromise = (async () => {
                try {
                    return await resolver();
                } catch (e) {
                    this.resultPromise = undefined; // Let the next one try again
                    throw e;
                }
            })()
        }
        return this.resultPromise;
    }
}

/**
 * A Map<K, Set<V>>. But automatically add a new Set if needed
 */
export class MapSet<K, V> {
    map = new Map<K, Set<V>>()

    add(key: K, value: V) {
        let set = this.map.get(key);
        if(set === undefined) {
            set = new Set<V>();
            this.map.set(key, set);
        }
        set.add(value);
    }

    delete(key: K, value: V) {
        let set = this.map.get(key);
        if(set !== undefined) {
            set.delete(value);
            if(set.size === 0) {
                this.map.delete(key); // Clean up
            }
        }
    }

    get(key: K) {
        return this.map.get(key);
    }
}

/**
 * A WeakMap<K, Set<V>>. But automatically add a new Set if needed
 */
export class WeakMapSet<K extends object, V> extends MapSet<K, V> {
    map = new WeakMap<K, Set<V>>() as Map<K, Set<V>>;
}


/**
 * This Map does not return empty values, so there's always a default value created
 */
export abstract class DefaultMap<K, V> extends Map<K,V>{
    abstract createDefaultValue(key: K): V;

    get(key: K): V {
        let result = super.get(key);
        if(result === undefined) {
            result = this.createDefaultValue(key);
            this.set(key, result);
        }
        return result;
    }
}

/**
 * This Map does not return empty values, so there's always a default value created
 */
export abstract class DefaultWeakMap<K extends Object, V> extends WeakMap<K,V>{
    abstract createDefaultValue(key: K): V;

    get(key: K): V {
        let result = super.get(key);
        if(result === undefined) {
            result = this.createDefaultValue(key);
            this.set(key, result);
        }
        return result;
    }
}

/**
 *
 * @param createDefaultValueFn
 * @returns a Map that creates and inserts a default value when that value does not exist. So the #get method always returns something.
 */
export function newDefaultMap<K,V>(createDefaultValueFn: (key: K) => V): DefaultMap<K, V> {
    return new class extends DefaultMap<K, V> {
        createDefaultValue(key:K): V {
            return createDefaultValueFn(key);
        }
    }()
}

/**
 *
 * @param createDefaultValueFn
 * @returns a WeakMap that creates and inserts a default value when that value does not exist. So the #get method always returns something.
 */
export function newDefaultWeakMap<K,V>(createDefaultValueFn: (key: K) => V): DefaultMap<K, V> {
    return new class extends DefaultMap<K, V> {
        createDefaultValue(key:K): V {
            return createDefaultValueFn(key);
        }
    }()
}


/**
 * More friendly way to show a modal blueprint dialog. Usage:
 * <pre><code>
 import { Button, ButtonGroup, Classes, Intent,} from "@blueprintjs/core";
 import "@blueprintjs/core/lib/css/blueprint.css"; // don't forget these
 import "@blueprintjs/icons/lib/css/blueprint-icons.css"; // don't forget these
 import "@blueprintjs/icons/lib/css/blueprint-icons.css"; // don't forget these
 import {useWatchedState} from "react-deepwatch";

 const result = await showBlueprintDialog({title: "SayHello"},(props) => {
     const state = useWatchedState({}); // contentComponentFn was wrapped for you in a watchedComponent, so you can use its features
     return <div>
                <div className={Classes.DIALOG_BODY}>
                    ...
                </div>

                <div className={Classes.DIALOG_FOOTER}>
                    <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                        <ButtonGroup>
                            <Button onClick={() => props.resolve(myResult)} intent={Intent.PRIMARY}>OK</Button>
                            <Button onClick={() => props.resolve(undefined)}>Cancel</Button>
                        </ButtonGroup>
                    </div>
                </div>
            </div>;
   });

   ... code after dialog was closed...
 * </code></pre>
 * For a dialog with dragging and resizing, {@see showMuiDialog}
 * @param dialogProps
 * @param contentComponentFn
 */
export async function showBlueprintDialog<T>(dialogProps: Partial<BlueprintDialogProps>, contentComponentFn: FunctionComponent<{resolve: (result: T) => void, close: () => void}>) {
    return new Promise<T|undefined>((resolve) => {
        // We need some <div/> to render into
        const targetDiv = document.createElement("div");
        targetDiv.className = "ContainerForDialog"; // Tag it just for better debugging
        document.body.append(targetDiv);

        const WatchedContentComponentFn = watchedComponent(contentComponentFn, {fallback:<div style={{margin: "16px", textAlign: "center"}}>{gettext("Loading...")}</div>});

        /**
         * Wrapper component so we can control the open state
         * @param props
         * @constructor
         */
        function Wrapper(props: {}) {
            let [open, setOpen] = useState(true);

            function close() {
                setOpen(false);
                targetDiv.remove(); // clean up target div. A bit dirty but works
            }

            return <BlueprintDialog className={isPVEDarkTheme()?"bp5-dark":undefined} usePortal={true} portalContainer={document.body} isOpen={open} {...dialogProps} onClose={() => {
                    close();
                    resolve(undefined);
                }}><ErrorBoundary fallbackRender={ErrorState}>
                    <WatchedContentComponentFn close={close} resolve={(result) => {
                        close();
                        resolve(result);
                    }}/>
                    </ErrorBoundary>
                </BlueprintDialog>


        }
        createRoot(targetDiv).render(<Wrapper/>, );
    })
}


/**
 * More friendly way to show a modal MUI dialog. The dialog is also draggable and resizable. Usage:
 * <pre><code>
 import { DialogActions, DialogContent, DialogContentText} from "@mui/material";

 const result = await showMuiDialog("My dialog", {}, (props) => {
       return <React.Fragment>
           <DialogContent>
               <DialogContentText>
                   text
               </DialogContentText>
               other content
           </DialogContent>
           <DialogActions>
                <Button type="submit" onClick={() => props.resolve("OK")} >OK</Button>
                <Button onClick={() => props.resolve(undefined)}>Cancel</Button>
           </DialogActions>
       </React.Fragment>
     }, {width: "650px", height: "260px"}); // Specify css for default width/height (here), or minWidth/minHeight, or omit to fit content
 });

 ... code after dialog was closed...
 </code></pre>
 * For docs, see: https://mui.com/material-ui/api/dialog/
 * @param dialogProps
 * @param ContentComponent
 */
export async function showMuiDialog<T>(title: string | React.ReactElement, dialogProps: Partial<DialogProps>, ContentComponent: FunctionComponent<{resolve: (result: T) => void, close: () => void}>, paperSx?: CSSProperties) {
    return new Promise<T|undefined>((resolve) => {
        // We need some <div/> to render into
        const targetDiv = document.createElement("div");
        targetDiv.className = "ContainerForDialog"; // Tag it just for better debugging
        document.body.append(targetDiv);

        /**
         * Wrapper component so we can control the open state
         * @param props
         * @constructor
         */
        function Wrapper(props: {}) {
            let [open, setOpen] = useState(true);

            function close() {
                setOpen(false);
                targetDiv.remove(); // clean up target div. A bit dirty but works
            }

            return <Dialog open={open} {...dialogProps}
                           onClose={() => {
                               close();
                               resolve(undefined);
                           }}
                           PaperComponent={PaperComponent}
                           maxWidth={false}
                           aria-labelledby="draggable-dialog-title" {...dialogProps}>
                <DialogTitle style={{cursor: 'move'}} id="draggable-dialog-title">{title}</DialogTitle>
                <ContentComponent close={close} resolve={(result) => {
                    close();
                    resolve(result);
                }}/>
            </Dialog>
        }
        createRoot(targetDiv).render(<Wrapper/>);
    })


    function PaperComponent(props: any) {
        return (
            <Draggable handle="#draggable-dialog-title" cancel={'[class*="MuiDialogContent-root"]'}>
                <Paper {...props} sx={{resize: "both", ...(props.sx || {}), ...(paperSx || {})}} />
            </Draggable>
        );
    }
}



/**
 * Shows the (big) text content (like an exception) in a popup dialog
 * @param value
 * @param title
 * @param icon
 */
export async function showResultText(value: string, title?: string, icon?: string) {
    //TODO: For more space and resizability, we should use showMuiDialog instead
    await showBlueprintDialog({title, icon: icon as any, style:{width:`${window.document.documentElement.clientWidth - 20}px`, height: `${window.document.documentElement.clientHeight - 100}px`} }, (props) => {
        return <div style={{height: "100%", display: "flex", flexDirection: "column"}}>
            <div className={Classes.DIALOG_BODY} style={{flexGrow: 1, transform: "translate(0,0)"}}>
                <div style={{position: "absolute", right:"24px", top:"8px"}}><Button icon={"duplicate"} onClick={() => copyStringToClipboard(value)}></Button></div>
                <textarea style={{width: "100%", height: "100%"}} value={value} readOnly={true}/>
            </div>
            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <Button onClick={() => props.resolve(true)} intent={Intent.PRIMARY} autoFocus={true}>OK</Button>
                    </ButtonGroup>
                </div>
            </div>
        </div>
    });
}

export async function withLoadingDialog(exec: () => Promise<unknown>,title =  "Loading...") {
    let close: (() => void) | undefined;
    try {
        const ignoredPromise  = showBlueprintDialog({title},(props) => {
            close = props.close;
            return <div>
                <div className={Classes.DIALOG_BODY}>
                    <ProgressBar/>
                </div>
            </div>;
        });
        return await exec();
    }
    finally {
        close?.();
    }
}


/**
 * get/sets the whole part of the url after the #: i.e. http://localhost:8181/#mainpart?someOtherParam=xyz
 * would see "mainpart?someOtherParam=xyz"
 *
 * Copied from here: https://www.30secondsofcode.org/react/s/use-hash
 */
export function useHash(): [string, (newHash: string) => void] {
    const [hash, setHash] = React.useState<string>(window.location.hash);

    const hashChangeHandler = React.useCallback(() => {
        setHash(window.location.hash);
    }, []);

    React.useEffect(() => {
        window.addEventListener('hashchange', hashChangeHandler);
        return () => {
            window.removeEventListener('hashchange', hashChangeHandler);
        };
    }, []);

    const updateHash = React.useCallback(
        (newHash: string) => {
            if (newHash !== hash) window.location.hash = newHash;
        },
        [hash]
    );

    return [hash, updateHash];
};


/**
 * Gets / sets a param of the url after the #..?
 * I.e.: http://localhost:8181/#?myParam=xyz
 */
export function useHashParam(name: string, initialValue?: string): [string|undefined, (newHash?: string) => void] {
    const [hash, setHash] = useHash();



    function setValue(newValue?: string) {
        const params = getParamsFromUrl(hash);
        //@ts-ignore
        params[name] = newValue;

        let pairs: string[] = [];
        Object.keys(params).forEach(key => {
            const value = params[key];
            if(value) {
                //@ts-ignore
                pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            }
        });


        let newHash = hash.replace(/\?.*/,""); // remove ?... part
        newHash+= "?" + pairs.join("&");
        setHash(newHash);
    }

    const currentValue = getParamsFromUrl(hash)[name];

    // set initial value
    useEffect(() => {
        if(!currentValue) {
            setValue(initialValue);
        }
    },[]);

    return [currentValue, setValue]
}

export function getParamsFromUrl(url: string) {
    let regExp = /.*\?(.*)/;
    if(!regExp.test(url)) {
        return {}
    }
    const paramsPart = regExp.exec(url)![1];

    const result:Record<string, string> = {};
    paramsPart.split("&").forEach( paramPart => {
        let tokens = paramPart.split("=");
        if(tokens.length == 2) {
            result[decodeURIComponent(tokens[0])] = decodeURIComponent(tokens[1]);
        }
    })

    return result;
}


/**
 * Like useHashParam, but allows to set any value that will then be encoded / decocoded to json in the url
 */
export function useJsonHashParam<T>(name: string, initialValue?: T): [T, (newValue?: T) => void] {
    function toString(value: unknown) {
        return value === undefined ? undefined : JSON.stringify(value);
    }

    const [stringValue, setStringValue] = useHashParam(name, toString(initialValue));
    const currentValue = stringValue === undefined?undefined:JSON.parse(stringValue);

    return [currentValue, (newValue?: T) => setStringValue(toString(newValue))]
}

export function ExceptionPopover(props: any) {
}

/**
 * Show a NonIdealState with a popup that shows the full stacktrace + causes.
 * <p>Has the side effect of fixErrorStack</p>
 *
 * @param props
 * @constructor
 */
export function ErrorState(props: any) {
    fixErrorStack(props.error)
    const fullError = errorToString(props.error);

    const onClick = () => {
        showResultText(fullError, props.error.message, "error");
        setTimeout(() => { // not in the thread that's caught by reacts error handler
            throw props.error // ### Don't look here, this line is just the error reporter! ### / Show error to console so the javascript source mapping will be resolved
        })
    }

    return <Tooltip content={"Click to show full error (+copy to clipboard)"}>
        <a style={{cursor: "pointer"}} onClick={onClick}>
            <NonIdealState icon={"error"} iconSize={NonIdealStateIconSize.SMALL} description={props.error.message}/>
        </a>
    </Tooltip>
}

export function copyStringToClipboard(text: string) {
    // Copy to clipboard
    if(window.navigator.clipboard) { // method exists (modern browsers) ?
        navigator.clipboard.writeText(text);
    }
    else { // @ts-ignore
        if(window.clipboardData && window.clipboardData.setData) { // old ie / edge < 79 (without chromium)
            text = text.replace(/\r?\n/g,"\r\n"); // Zeilenumbrüche immer als \r\n. Sonst klappt das Pasten z.b. nach Notepad nicht richtig
            // @ts-ignore
            window.clipboardData.setData('Text', text);
        }
    }
}

/**
 * Calls effectFn on resize and initially
 * @param effectFn Function that i.e. implements **responsive** dom corrections
 * @param deps
 */
export function useWindowResizeEffect(effectFn:  () => void, deps?: React.DependencyList | undefined) {
    useLayoutEffect(() => {
        window.addEventListener("resize", effectFn);

        effectFn(); // Call initially

        return function cleanUp() {
            window.removeEventListener("resize", effectFn)
        }

    },deps);
}

/**
 * Calls effectFn on resize and initially
 * @param watchedElementRef
 * @param effectFn
 * @param deps
 */
export function useResizeEffect(watchedElementRef: React.RefObject<HTMLElement>, effectFn:  () => void, deps?: React.DependencyList | undefined) {
    useLayoutEffect(() => {
        if(!watchedElementRef.current) {
            return
        }

        let elementToWhichTheListenerWasAdded = watchedElementRef.current; // Refs can change over time. So we make sure to add and clean it on the exact one
        elementToWhichTheListenerWasAdded.addEventListener("resize", effectFn);

        effectFn(); // Call initially

        return function cleanUp() {
            if(elementToWhichTheListenerWasAdded) {
                elementToWhichTheListenerWasAdded.removeEventListener("resize", effectFn)
            }
        }

    },deps);
}

/**
 * You can see the the instance id change over time this component is re-instantiated
 * @param props
 * @constructor
 */
export function DebugInstanceId(props: {}) {
    let [instanceId] = useState(Math.random())
    return <span>InstanceId: {instanceId}</span>
}

export type Clazz<T> = {
    new(...args: any[]): T
}

function getCookieByName(name: string) {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(';');
    for(let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(nameEQ)) {
            return cookie.substring(nameEQ.length);
        }
    }
    return undefined;
}

export function isPVEDarkTheme() {
    return getCookieByName( "PVEThemeCookie") === "proxmox-dark";
}

export function InfoTooltip(props: {children: React.ReactElement}) {
    return <Tooltip content={props.children} interactionKind={"hover"}><Icon icon={"small-info-sign"}/></Tooltip>
}

/**
 *
 * @param title
 * @param message
 * @param icon
 * @return
 */
export async function confirm(title: string, message: string | ReactNode, icon: string = "warning-sign") {
    return (await showBlueprintDialog({title: <div style={{paddingLeft: "4px"}}><Icon icon={icon as any} />{title}</div>}, (props) => {
        return <div>
            <div className={Classes.DIALOG_BODY}>

                {message}
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <Button onClick={() => props.resolve(true)} intent={Intent.PRIMARY}>{gettext("OK")}</Button>
                        <Button onClick={() => props.resolve(false)}>{gettext("Cancel")}</Button>
                    </ButtonGroup>
                </div>
            </div>
        </div>;
    }))?true:false;
}


export function formatDate(date: Date) {
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}