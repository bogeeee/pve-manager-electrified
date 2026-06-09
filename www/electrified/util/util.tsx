import {CSSProperties, FunctionComponent, ReactNode, useEffect, useLayoutEffect, useRef, useState} from "react";
import {stringify as brilloutJsonStringify} from "@brillout/json-serializer/stringify"

import {
    Button,
    ButtonGroup,
    Classes,
    Dialog as BlueprintDialog,
    DialogProps as BlueprintDialogProps, HTMLSelect, HTMLSelectProps, Icon,
    Intent,
    NonIdealState,
    NonIdealStateIconSize, Popover, PopoverProps,
    ProgressBar,
    Tag,
    Tooltip, TooltipProps
} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import "@blueprintjs/icons/lib/css/blueprint-icons.css";
import {createTheme, Dialog, DialogTitle, Paper, ThemeProvider} from "@mui/material";
import {DialogProps} from "@mui/material/Dialog";
import * as React from "react";
import Draggable from 'react-draggable';
import ReactDOM from "react-dom";
import { createRoot } from 'react-dom/client';
import {ValueOnObject, watched, watchedComponent} from "react-deepwatch";
import { ErrorBoundary } from "react-error-boundary";
import {getElectrifiedApp} from "../globals";
import {object} from "prop-types";
import _ from "underscore";
import ex = CSS.ex;

function gettext(text: string) {
    const app = getElectrifiedApp();
    if(!app) {
        return text; // fallback, when app failed to initialize, the util methods, especially for showing error dialogs, should still work
    }
    return app.getText(text);
}

export class FetchError extends Error {
    httpStatusCode!: number;
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
        const error = new FetchError(`could not fetch url: ${request?.url?request.url:request.toString()}:  ${result.status}: ${result.statusText}`);
        error.httpStatusCode = result.status;
        throw error
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

export function toError(err: any): Error {
    if(!err) {
        return new Error();
    }
    if(err instanceof Error) {
        return err;
    }
    if(typeof err === "string") {
        return new Error(err);
    }
    return new Error(`<${typeof err}>`);
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
    const origTitle = window.document.title;
    try {
        window.document.title = (e as Error).message;
        await showResultText(errorToString(e), "Error", "error");
    }
    finally {
        window.document.title = origTitle;
    }
}

/**
 * Shows an error dialog, if something goes wrong. Void version
 */
export function spawnWithErrorHandling(fn: () => void | Promise<void>): void {
    spawnAsync(async () => {
        try {
            await fn();
        }
        catch (e) {
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

//@ts-ignore
export const muiTheme = createTheme({
    palette: {
        mode: isPVEDarkTheme()?"dark":"light",
    },
});



/**
 * More friendly way to show a modal blueprint dialog. Usage:
 * <pre><code>
 import { Button, ButtonGroup, Classes, Intent,} from "@blueprintjs/core";
 import "@blueprintjs/core/lib/css/blueprint.css"; // don't forget these
 import "@blueprintjs/icons/lib/css/blueprint-icons.css"; // don't forget these
 import "@blueprintjs/icons/lib/css/blueprint-icons.css"; // don't forget these
 import {useWatchedState} from "react-deepwatch";

 const result = await showBlueprintDialog({title: "SayHello"},(props) => {
     const state = useWatchedState({}); // contentComponentFn was wrapped for you in a watchedComponent, so you can use watchedComponent features (see react-deepwatch)
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
 * @param dialogProps see the Blueprint dialog props. + The property electrify niceElectrifiedStyle (default: true)
 * @param contentComponentFn
 */
export async function showBlueprintDialog<T>(dialogProps: Partial<BlueprintDialogProps & {niceElectrifiedStyle?: boolean | {maxSparkWidth?: number}}>, contentComponentFn: FunctionComponent<{resolve: (result: T) => void, close: () => void}>) {
    dialogProps = {
        transitionDuration:(dialogProps.niceElectrifiedStyle !== false)?0:100,
        backdropProps: {style: {opacity: 0.75}},
        className: (dialogProps.niceElectrifiedStyle !== false)?"electrified_hide_while_initializing": undefined, // this is to prevent flickering while adding the niceElectrifiedStyle effects
        ...dialogProps,
    }

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

            // Set the cool background
            const containerRef = useRef<HTMLElement>()
            useEffect(() => {
                if(dialogProps.niceElectrifiedStyle === false) {
                    return;
                }
                spawnAsync(async () => {
                    // Wait till containerRef.current is set (it is not set from the beginning on an there seems to be no working event for it):
                    await retryTilSuccess(async () => {
                        containerRef.current || throwError(new RetryableError("got no containerRef"))
                    }, {maxTime: 1000})

                    const contentDiv: HTMLElement = containerRef.current!.querySelector(".electrifiedBlueprintDialogContent")!;

                    const consts = coolBackgroundMask_consts;
                    const topSpikeXPosition = 407; // so the headerbar can exactly be aligned
                    const lowerSpikeXPosition = 250; // So the footer bar's right edge can be aligned to it
                    const maxSparkWidth = ((typeof dialogProps.niceElectrifiedStyle === "object") && dialogProps.niceElectrifiedStyle?.maxSparkWidth) || 350
                    const yScaleFactor = contentDiv.offsetHeight / consts.maskImagesSourceHeight;
                    const xScaleFactor = Math.min(consts.maskImageRightSourceWidth * yScaleFactor, Math.min(consts.maskImageRightSourceWidth, maxSparkWidth)) / consts.maskImageRightSourceWidth;


                    const shiftSparkToTheLeft = 65;

                    const enhancedContentWidthPx = (consts.maskImageRightSourceWidth - shiftSparkToTheLeft) * xScaleFactor;
                    const dialog = contentDiv.parentElement!;
                    const body = dialog!.querySelector(".bp6-dialog-body") as HTMLElement;
                    const originalBodyOffsetWidth = body?.offsetWidth;

                    dialog.style.width = `${dialog.offsetWidth + enhancedContentWidthPx}px`;

                    const margin = 16;
                    if(body) {
                        body.style.width = `${originalBodyOffsetWidth - 2 * margin}px`
                    }



                    //contentDiv.style.width = `${contentDiv.offsetWidth + enhancedContentWidthPx}px`; // Enhance widht of contentDiv

                    // Align header:
                    const headerDiv = dialog!.querySelector(".bp6-dialog-header") as HTMLElement;
                    const origHeaderWidth = headerDiv.offsetWidth;
                    headerDiv.style.width = `${origHeaderWidth + (-consts.maskImageRightSourceWidth + topSpikeXPosition) * xScaleFactor}px`

                    // Align footer:
                    const footerDiv = dialog!.querySelector(".bp6-dialog-footer") as HTMLElement;
                    if(footerDiv) {
                        footerDiv.style.width = `${footerDiv.offsetWidth + (-consts.maskImageRightSourceWidth + (footerDiv.offsetHeight < (170 * xScaleFactor) ? lowerSpikeXPosition : 0)) * xScaleFactor}px`
                    }

                    dialog.style.backgroundColor = "initial";
                    dialog.style.boxShadow = "initial";
                    coolBackgroundMask(contentDiv!, "dialog");

                    setTimeout(() => dialog.classList.remove("electrified_hide_while_initializing"), 50);
                })

                }, []);


            return <BlueprintDialog containerRef={containerRef as any} className={isPVEDarkTheme()?"bp6-dark":undefined} usePortal={true} portalContainer={document.body} isOpen={open} {...dialogProps} onClose={() => {
                    close();
                    resolve(undefined);
                }}>
                <ThemeProvider theme={muiTheme}>
                    <div className={"electrifiedBlueprintDialogContent"} style={{width: "100%", height: "100%"}}>
                        <ErrorBoundary fallbackRender={ErrorState}>
                        <WatchedContentComponentFn close={close} resolve={(result) => {
                            close();
                            resolve(result);
                        }}/>
                        </ErrorBoundary>
                    </div>
                </ThemeProvider>
                </BlueprintDialog>


        }
        createRoot(targetDiv).render(<Wrapper/>, );
    })
}

export function SmallErrorIndicator(props: {error: Error}) {
    fixErrorStack(props.error)
    const fullError = errorToString(props.error);

    const onClick = () => {
        showResultText(fullError, props.error.message, "error");
        setTimeout(() => { // not in the thread that's caught by reacts error handler
            throw props.error // ### Don't look here, this line is just the error reporter! ### / Show error to console so the javascript source mapping will be resolved
        })
    }

    return <Tooltip content={`${props.error.message || ""}. ${gettext(`Click to show full error`)}`}>
        <a style={{cursor: "pointer"}} onClick={onClick}>
            <Icon icon={"error"} size={14}/>
        </a>
    </Tooltip>
}

/**
 * ... renders as a small inline "(!)" symbol
 * @param props
 * @constructor
 */
export function SmallErrorBoundary(props: {children: ReactNode}) {
    return <ErrorBoundary fallbackRender={SmallErrorIndicator}>{props.children}</ErrorBoundary>
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
export async function showMuiDialog<T>(title: string | React.ReactElement, dialogProps: Partial<DialogProps>, contentComponentFn: FunctionComponent<{resolve: (result: T) => void, close: () => void}>, paperSx?: CSSProperties) {
    return new Promise<T|undefined>((resolve) => {
        // We need some <div/> to render into
        const targetDiv = document.createElement("div");
        targetDiv.className = "ContainerForDialog"; // Tag it just for better debugging
        document.body.append(targetDiv);

        const WatchedContentComponent = watchedComponent(contentComponentFn, {fallback:<div style={{margin: "16px", textAlign: "center"}}>{gettext("Loading...")}</div>});

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

            return <ThemeProvider theme={muiTheme}>
                <Dialog open={open} {...dialogProps}
                        onClose={() => {
                            close();
                            resolve(undefined);
                        }}
                        PaperComponent={PaperComponent}
                        maxWidth={false}
                        className={isPVEDarkTheme()?"bp6-dark":undefined}
                        aria-labelledby="draggable-dialog-title" {...dialogProps}>
                    <DialogTitle style={{cursor: 'move'}} id="draggable-dialog-title">{title}</DialogTitle>
                    <ErrorBoundary fallbackRender={ErrorState}>
                        <WatchedContentComponent close={close} resolve={(result) => {
                            close();
                            resolve(result);
                        }}/>
                    </ErrorBoundary>
                </Dialog>
            </ThemeProvider>
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
    await showBlueprintDialog({title, icon: icon as any, niceElectrifiedStyle: false, style:{width:`${window.document.documentElement.clientWidth - 20}px`, height: `${window.document.documentElement.clientHeight - 100}px`} }, (props) => {
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

    return <Tooltip content={"Click to show full error"}>
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

export function getCookieByName(name: string) {
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
    const themeCookie = getCookieByName( "PVEThemeCookie");
    if( themeCookie === "proxmox-dark") {
        return true;
    }
    else if(themeCookie === "crisp") {
        return false;
    }
    else { // Auto?
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark;
    }
}

/**
 * Shows an info icon with a tooltip with the specified content
 * <p>
 * You need to add this css to your app: .utilInfoTooltip { display: inline-block !important; }
 * </p>
 * @param props
 * @constructor
 */
export function InfoTooltip(props: {children: React.ReactElement} & Omit<TooltipProps, "content">) {
    return <Tooltip {...props} content={props.children} interactionKind={"hover"} className={"utilInfoTooltip"} ><Icon icon={"small-info-sign"}/></Tooltip>
}

/**
 * Shows a Tooltip on hover
 * Usage: <HoverTooltip tooltip={"Here's a message"} showHand={true}>Hover me!</HoverTooltip>
 * @param props set fullDiv i.e. if your children are also divs, so when you need full block divs spanning 100% instead of spans
 * @constructor
 */
export function HoverTooltip(props: PopoverProps & {tooltip: React.ReactNode, children: React.ReactElement, showHand?:boolean, fullDiv?:boolean}) {
    const enabled = props.tooltip?true:false;
    const fullDivStyle = props.fullDiv?{width: "100%", height: "100%", display: "block"}:{}
    return <span style={{cursor: (enabled && props.showHand)?"pointer":undefined, ...fullDivStyle}}><Popover interactionKind={"hover-target"} enforceFocus={false /* no important use case*/} hoverOpenDelay={0} hoverCloseDelay={0} transitionDuration={50} targetProps={{style: fullDivStyle} as any} {...props}
        isOpen={enabled?undefined:false /* Enforce rendering the same tree also when disabled. The RememberChoiceButton's icon css transition does not work otherwise */}
                    content={<div style={{padding: "6px"}}>{props.tooltip}</div>}
    >
        {props.children}
    </Popover></span>
}

/**
 *
 * @constructor
 */
export const RememberChoiceButton = watchedComponent<{currentValue: unknown, storageBind: ValueOnObject<unknown>, tooltip?: string, disabled?: boolean}>(<T,>(props: {currentValue: T, storageBind: ValueOnObject<T>, tooltip?: string, disabled?: boolean}) => {
    // Save default value:
    useEffect(() => {
        if(props.storageBind.value === undefined && props.currentValue !== undefined) {
            props.storageBind.value = props.currentValue;
        }
    }, [props.currentValue, props.storageBind.value])

    const disabled = (props.disabled === true) || props.currentValue === props.storageBind.value;

    const save = () => {
        props.storageBind.value = props.currentValue;
    }

    return <HoverTooltip tooltip={!disabled?(props.tooltip || gettext(`Set as default for this dialog`)):undefined}><a style={{cursor:disabled?"initial":"pointer"}} onClick={() => save()}><span className="fa fa-save" style={{opacity: disabled?"0.2":"1", transition:!disabled?"opacity 0.35s":undefined}} /></a></HoverTooltip>
});

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

/**
 * Shows an informational message popup, like <code>alert()</code>
 * @param title
 * @param message
 * @param icon "info-sign", "warning-sign", or any other blueprint icon
 * @return
 */
export async function messageBox(title: string, message: string | ReactNode, icon: string = "info-sign") {
    return (await showBlueprintDialog({title: <div style={{paddingLeft: "4px"}}><Icon icon={icon as any} />{title}</div>, niceElectrifiedStyle: false}, (props) => {
        return <div>
            <div className={Classes.DIALOG_BODY}>
                <form onKeyDown={(event) => {if(event.key === "Enter") { event.preventDefault();props.resolve(true) }}}>
                    {message}
                </form>
            </div>

            <div className={Classes.DIALOG_FOOTER}>
                <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                    <ButtonGroup>
                        <Button onClick={() => props.resolve(true)} intent={Intent.PRIMARY} autoFocus={true}>{gettext("OK")}</Button>
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

/**
 * @return An id that can be safely used in a file path
 */
export function createSessionId() {
    return "" + Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
}

let renderCounter = 0;
export const TestComponent = watchedComponent(() =>  {
    return <span>Hello! fromTestComponent ${renderCounter++}</span>
});

/**
 * Throws an error if a duplicate entry was found
 * @param array
 * @param prop property name or derivation function. when undefined, the array elements them selves  are checked
 * @param onError You can specify a message or a callback to throw/call in case, a duplicate entry was found
 */
export function checkForDuplicates<T>(array: T[], prop?: keyof T | ((element: T) => unknown), onError?: string | ((value: any, e1:T, e2:T, index1:number, index2: number) => void)) {
    const values2elements = new Map<unknown, {index: number, element: T}>();
    for(let i = 0;i<array.length; i++) {
        const element = array[i];

        // Determine value:
        let value;
        if(prop === undefined) {
            value = element;
        }
        else if(typeof prop === "string") {
            value = element[prop];
        }
        else if(typeof prop === "function") {
            value = prop(element);
        }

        const existing = values2elements.get(value);
        if(existing !== undefined) {
            // error:
            if(onError === undefined) {
                throw new Error(`Duplicate ${prop?prop.toString():"entry"}: ${value}`);
            }
            else if(typeof onError === "string") {
                throw new Error(onError);
            }
            else if(typeof onError === "function") {
                onError(value, existing.element, element, existing.index, i);
            }
        }

        values2elements.set(value, {index: i, element});
    }
}
const detachedValues = newDefaultWeakMap((key:object) => new Map<string, unknown>())

/**
 * Hides the property from frameworks (i.e. proxy-facades). The property is stored outside the object.
 * @param target
 * @param propName
 */
export function detached(target: object, propName: string) {
    // Store initial value:
    //@ts-ignore
    const initialValue: unknown = target[propName];
    detachedValues.get(target).set(propName, initialValue);

    Object.defineProperty(target, propName, {
        get() {
            return detachedValues.get(target).get(propName)
        },
        set(value: unknown) {
            detachedValues.get(target).set(propName, value);
        },
    });
}

let  objectHTMLSelect_idGenerator = 0;
const objectHTMLSelect_ObjIds = newDefaultWeakMap<object, number>(obj => ++objectHTMLSelect_idGenerator);
type SelectItem<T> = { value: T, content: ReactNode };

type ObjectHtmlSelectProps<T> = { binding: ValueOnObject<T>, items: SelectItem<T>[] };
/**
 * Normal html selects only support string|number as target value, but here you can use object instances.
 * Usage: <code><ObjectHTMLSelect binding={binding(state.myObj)} items={[{value: undefined, content: "please select"}, {value: {x: "myInstance1"}, content: "myInstance1"}, {value: {x: "myInstance1"}, content: "myInstance2"}]} />
 */
export const ObjectHTMLSelect = watchedComponent((props: HTMLSelectProps & ObjectHtmlSelectProps<unknown>) => {
    function getKeyForItem(item: SelectItem<unknown>) {
        return getKey(item.value);
    }
    function getKey(value: unknown) {
        return isObject(value)?objectHTMLSelect_ObjIds.get(value as object):value as string | number | undefined;
    }
    function key2value(key: string | number | undefined) {
        return props.items.find(item => String(getKeyForItem(item)) === String(key))?.value
    }

    return <HTMLSelect {...props} value={getKey(props.binding.value)} onChange={e => props.binding.value = key2value(e.target.value)}>{props.items.map(item => <option key={`${getKeyForItem(item)}`} value={getKeyForItem(item)}>{item.content}</option>)}</HTMLSelect>
}) as (<T,>(props: HTMLSelectProps & ObjectHtmlSelectProps<T>) => any)

/**
 * Quick implementation / slow at runtime
 * @param a
 * @param b
 */
export function isDeepEqual<T>(a: T, b:T) {
    return brilloutJsonStringify(a) === brilloutJsonStringify(b);
}

/**
 *
 * @param initialName
 * @param existingNames
 * @returns unique name with `-[number]` suffix if needed,
 */
export function getUniqueName(initialName: string, existingNames: Set<string | undefined>, maxLength?: number) {
    const limitLength = (value: string) => maxLength?value.slice(0, maxLength):value;
    initialName = limitLength(initialName);
    if(!existingNames.has(initialName)) {
        return initialName;
    }

    const idx2name = (idx: number) => {
        const suffix = `-${idx}`
        return `${maxLength?initialName.slice(0, maxLength - suffix.length):initialName}${suffix}`;
    }
    let idx = 2;
    while(existingNames.has(idx2name(idx))) {
        idx++;
    }
    return idx2name(idx);

}
export class RetryableError extends Error {}

export type RetryTilSuccessOptions = { initialRetryDelay?: number, maxTime?: number };

/**
 * Usage
 * <code>await retryTilSuccess( async() => {do some stuff and evetually throw new RetryableError("message) })) </code>
 *
 * @param executer
 */
export async function retryTilSuccess<T>(executer: () => Promise<T>, options?: RetryTilSuccessOptions) {
    let retryDelay = options?.initialRetryDelay || 20;
    let triesDone = 0;
    const startTime = new  Date().getTime();
    while(true) {
        try {
            triesDone++;
            return await executer();
        }
        catch (e) {
            if(e !== null && e instanceof RetryableError) {
                if(new  Date().getTime() > (startTime + (options?.maxTime || 10000))) {
                    e.message+=`\nTimed out after ${triesDone} retries`;
                    throw e;
                }
                await sleep(retryDelay);
                retryDelay*=1.2;
                continue; // Try again
            }
            throw e;
        }
    }
}

/**
 * Like {@link _#extend}. But does not complain if you extend a getter (with no setter)
 */
export function extend_quick<DEST extends object, SOURCE extends object>(dest: DEST, source: SOURCE): (DEST & SOURCE) {
    for(const key in source) {
        const propDesc = Object.getOwnPropertyDescriptor(source, key)!; // TODO: (now **own**)
        Object.defineProperty(dest, key, propDesc);
    }
    return dest as any;
}

export function capitalize(value: string) {
    if(!value) {
        return value;
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Exposes the resolve and reject methods to the outside
 */
export class ExternalPromise<T> implements Promise<T> {
    private promise: Promise<T>;
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: any) => void;

    diagnosis_creatorCallStack?: Error["stack"]
    static diagnosis_recordCallstacks = false;

    constructor() {
        if(ExternalPromise.diagnosis_recordCallstacks) {
            this.diagnosis_creatorCallStack = new Error("Dummy error, to record creator stack").stack;
        }
        const thisExternalPromise = this;

        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            // this.reject = reject, but with more diagnosis:
            this.reject = (reason?: any) => {
                let creatorStack = thisExternalPromise.diagnosis_creatorCallStack
                if(creatorStack) {
                    // Fix creatorStack:
                    creatorStack = creatorStack.replace(/^.*Dummy error, to record creator stack.*?\n/, ""); // remove that confusing line

                    if (reason instanceof Error) {
                        reason.stack = `${reason.stack}\n*** creator stack: ***\n${creatorStack}`
                    } else {
                        reason = fixErrorForJest(new Error(`Promise was rejected.\n${creatorStack}\n*** ignore this following stack and skip to 'reason' ****`, {cause: reason}));
                    }
                }
                else {
                    // Add hint:
                    const hint = `Hint: if you want to see the creator- (mostly the awaiter) call stack for this error, do: import {ExternalPromise} from 'restfuncs-common'; ExternalPromise.diagnosis_recordCallstacks=true;`
                    if (reason instanceof Error) {
                        reason.message+="\n" +  hint;
                    } else {
                        reason = fixErrorForJest(new Error(`Promise was rejected. ${hint}`, {cause: reason}));
                    }
                }

                reject(reason);
            }

        });
    }

    then<TResult1 = T, TResult2 = never>(
        onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.promise.then(onFulfilled, onRejected);
    }

    catch<TResult = never>(
        onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
    ): Promise<T | TResult> {
        return this.promise.catch(onRejected);
    }

    finally(onFinally?: (() => void) | null): Promise<T> {
        return this.promise.finally(onFinally);
    }

    readonly [Symbol.toStringTag]: string = "WrappedPromise"; // Must offer this when implementing Promise. Hopefully this is a proper value
}


/**
 * For parsing key1=value1,key2=value2 entries from a guest config file
 * @param rawConfigString
 */
export function guestConfigEntry2Record(rawConfigString: string) {
    const tokens = rawConfigString.split(",");

    const result = new Map<string, string>();
    if(!rawConfigString) {
        return result;
    }

    tokens.forEach(t => {
        const v = t.split("=");
        if (v.length === 1) {
            result.set("main", v[0]);
        }
        else if (v.length === 2) {
            result.set(v[0], v[1]);
        }
        else {
            throwError(`Illegal config token in ${rawConfigString}`);
        }
    })

    record2guestConfigEntry(result) === rawConfigString || throwError(`Raw config string does not serialize back to the exact same result. Original:\n${rawConfigString}\nRe-serialized:\n${record2guestConfigEntry(result)}`)

    return result;
}

export function record2guestConfigEntry(record: Map<string, string>) {
    return [...record.keys()].map(key => `${key==="main"?"":`${key}=`}${record.get(key)!}`).join(",");
}

const coolBackgroundMask_keys = ["backgroundImage", "backgroundSize", "backgroundRepeat", "backgroundPositionX"];
var coolBackgroundMask_consts = {
    maskImageRightSourceWidth: 486,
    maskImageLeftSourceWidth: 0,
    maskImagesSourceHeight: 660,
    backgroundOverLap: 150, // Overlap the background into the mask images to prevent quirks sometins

}
/**
 *
 * @param el
 * @param colorClass i.e. "hovered", "selected". Will automaticalled be suffixed with dark theme
 */
export function coolBackgroundMask(el: HTMLElement, colorClass: string, maxImageRightWidh = 350) {
    const consts = coolBackgroundMask_consts;
    el.style.backgroundColor = "initial"; // Clear classic style

    const cssValues: {}[] = []

    const yScaleFactor = el.offsetHeight / consts.maskImagesSourceHeight;
    const xLeftScaleFactor = yScaleFactor;
    const xRightScaleFactor = Math.min(consts.maskImageRightSourceWidth * yScaleFactor, maxImageRightWidh) / consts.maskImageRightSourceWidth;



    /*
    // Left mask
    cssValues.push({
        backgroundImage: `url(/images/cool_background_mask_left_${colorClass}_${isPVEDarkTheme()?"darkTheme":"lightTheme"}.png)`,
        backgroundSize: `${maskImageLeftSourceWidth * scaleFactor}px ${el.offsetHeight}px`,
        backgroundRepeat: "no-repeat",
        backgroundPositionX: "0",
    })
    */

    // Right mask
    cssValues.push({
        backgroundImage: `url(/images/cool_background_mask_right_${colorClass}_${isPVEDarkTheme()?"darkTheme":"lightTheme"}.png)`,
        backgroundSize: `${consts.maskImageRightSourceWidth * xRightScaleFactor}px ${el.offsetHeight}px`,
        backgroundRepeat: "no-repeat",
        backgroundPositionX: "right",
    })

    // Pixels:
    cssValues.push({
        backgroundImage: `url(/images/cool_background_mask_pixel_${colorClass}_${isPVEDarkTheme()?"darkTheme":"lightTheme"}.png)`,
        backgroundSize: `${el.offsetWidth + (-consts.maskImageLeftSourceWidth * xLeftScaleFactor) + ((-consts.maskImageRightSourceWidth + consts.backgroundOverLap) * xRightScaleFactor)}px ${el.offsetHeight}px`,
        backgroundRepeat: "no-repeat",
        backgroundPositionX: `${consts.maskImageLeftSourceWidth * xLeftScaleFactor}px`,
    })

    // Apply cssValues
    for(const key of coolBackgroundMask_keys) {
        //@ts-ignore
        const allValues = cssValues.filter(obj => obj[key] !== undefined).map(obj => obj[key]).join(",")
        //@ts-ignore
        el.style[key] = allValues;
    }
}

export function coolBackgroundMask_remove(el: HTMLElement) {
    for(const key of coolBackgroundMask_keys) {
        //@ts-ignore
        el.style[key] = "";

    }
}

/**
 * Wraps a ValueOnObject and prevents hammering writes by making sure, there's a minimum interval kept between the writes
 * Usage in a watchedComponent
 * <pre></code></code>
 * const state = useWatchedState(new class {
 *       bufferedValue = new WriteBufferedValueOnObject(binding(myObj, myProperty),1000);
 * })
 * ...
 * <input type="text> {...bind(state.bufferedValue.value)} />
 * </pre>
 */
export class WriteBufferedValueOnObject<T> implements ValueOnObject<T> {
    // ** Config: **

    orig: ValueOnObject<T>;
    minIntervalMs: number

    // ** State: **
    lastTimeSet?: number;
    stagingValue?: {value: T}


    constructor(orig: ValueOnObject<T>, maxDelayMs: number) {
        this.orig = orig;
        this.minIntervalMs = maxDelayMs;
    }

    get value() {
        if(this.stagingValue) {
            return this.stagingValue.value;
        }
        else {
            return this.orig.value;
        }
    }

    set value(newValue: T) {
        if(this.stagingValue) {
            this.stagingValue.value = newValue; // Just take it over
            return;
        }

        const now = new Date().getTime();
        if(!this.lastTimeSet || this.lastTimeSet + this.minIntervalMs < now) { // no staging needed?
            // Set immediately:
            this.lastTimeSet = now;
            this.orig.value = newValue;
        }
        else {
            // Set value later via staging:
            this.stagingValue = {
                value: newValue,
            }
            setTimeout(() => {
                let newValue = this.stagingValue!.value;
                this.lastTimeSet = new Date().getTime();
                this.stagingValue = undefined;
                this.orig.value = newValue;

            }, this.minIntervalMs - (now - this.lastTimeSet))
        }
    }
}

/**
 * Formats a value in 1024 based kilo/mega/giga K/M/G/... human readable format
 * @param value
 * @param unit
 * @param unitLowest special case when not praefixed with k/M/G
 */
export function formatBinary(value: number, unit: string, unitLowest?: string) {
    function dec(value: number) {
        return new Intl.NumberFormat(undefined, {
            maximumFractionDigits: value > 100?0:(value>10?1:2),
            minimumFractionDigits: 0,
        }).format(value);
    }
    if(value < 1024) {
        return `${dec(value)} ${unitLowest || unit}`
    }
    if(value < (1024 * 1024)) {
        return `${dec(value / 1024)} K${unit}`
    }
    if(value < (1024 * 1024 * 1024)) {
        return `${dec(value / 1024 / 1024)} M${unit}`
    }
    else {
        return `${dec(value / 1024 / 1024 / 1024)} G${unit}`
    }
}

/**
 *
 * @param valueInBytes
 * @returns value as human readable ... MiB or ... kiB
 */
export function formatMem(valueInBytes: number) {
    return formatBinary(valueInBytes, "iB", "B");
}

export function sum(arr: number[]) {
    let result = 0;
    for(const n of arr) {
        result+=n;
    }
    return result;
}

export function highest(arr: number[]) {
    let result = Number.NEGATIVE_INFINITY;
    for(const n of arr) {
        result = Math.max(result, n);
    }
    return result;
}

export function ignoreErr<T>(fn: () => T) {
    try {
        return fn()
    }
    catch (e) {
        return undefined;
    }
}

export type ClassOf<T> = {
    new(...args: unknown[]): T
}

export function isSubclassOf(Subclass: ClassOf<any>, Parent: ClassOf<any>): boolean {
    return Subclass === Parent || (Object.getPrototypeOf(Subclass) && isSubclassOf(Object.getPrototypeOf(Subclass), Parent));
}

export const LoadingSpinner= (props: {}) => <img src="data:image/gif;base64,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"/>

/**
 * Quick hacky way to allows to coninue watching into global objects from inside model code (non- watchedcomponend code). TODO: find a good concept to implement this in react-deepwatch
 * @param obj
 * @param options
 */
export function tryWatched<T extends object>(obj: T, options?: any) {
    try {
        return watched(obj, options)
    }
    catch (e) {
        return obj;
    }
}