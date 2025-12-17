import {Node} from "./Node";
import {
    asyncResource2retsync,
    checkThatCallerHandlesRetsync,
    cleanResource,
    promise2retsync,
    retsync2promise,
    RetsyncWaitsForPromiseException
} from "proxy-facades/retsync";
import {FileStats} from "pveme-nodejsserver/ElectrifiedSession";
import _ from "underscore";
import {spawnWithErrorHandling} from "../util/util";
import {WatchedProxyFacade} from "proxy-facades";
import {BufferEncoding, getElectrifiedApp} from "../globals";

/**
 * A file or directory on a pve node, that is live-watched.
 * See {@link Node#getFile}
 */
export class File {
    node: Node

    /**
     * Full path and filename. Normalized
     * @see normalizePath
     */
    path: string

    /**
     * ... + false when file does not exist
     */
    protected cache_stat?: FileStats | false;

    /**
     * We save the result of getStringContent (redundantly), so react-deepwatch can track live changes
     * encoding -> content
     * @protected
     */
    protected cache_stringContent = new Map<BufferEncoding, string>();

    protected cache_dirContent?: ReturnType<File["getDirectoryContents"]>

    protected watchesForChanges = false;

    protected changeListeners = new Set<(() => void)>();

    getStringContent(encoding: BufferEncoding): string {
        checkThatCallerHandlesRetsync();

        if(!this.exists) {
            throw new Error(`File does not exist: ${this.path}`);
        }

        if(this.cache_stringContent.has(encoding)) { // Cache hit?
            return this.cache_stringContent.get(encoding)!;
        }

        return asyncResource2retsync(async () => {
            await this.ensureWatchesForChangesOnDisk();

            const result = await this.node.electrifiedApi.getFileContent(this.path, encoding);

            this.cache_stringContent.set(encoding, result);
            return result;
        }, this.cache_stringContent, `getStringContent_${encoding}`);
    }

    protected setStringContent_writeOperation?: {newValue: string, encoding: BufferEncoding, promise: Promise<void>};

    /**
     * @returns the string content (interpreted as utf8)
     * @see getStringContent
     */
    get content() {
        return this.getStringContent("utf8");
    }

    /**
     * Writes the string content utf8 encoded
     * @param value
     * @see setStringContent
     */
    set content(value: string) {
        this.setStringContent(value, "utf8")
    }

    protected removeOperation?: Promise<void>

    setStringContent(newValue:string, encoding: BufferEncoding) {
        // Validity check:
        if(newValue === undefined) {
            throw new Error("Illegal argument: undefined");
        }

        checkThatCallerHandlesRetsync();

        if(this.cache_stringContent.get(encoding) === newValue) { // Nothing has changed / already up2date ?
            return;
        }

        if(this.setStringContent_writeOperation?.encoding === encoding && this.setStringContent_writeOperation?.newValue === newValue) { // Write operation is already in progress ?

        }
        else {
            this.setStringContent_writeOperation = {
                newValue: newValue,
                encoding: encoding,
                promise: (async () => {
                    await this.ensureWatchesForChangesOnDisk();
                    await this.checkWriteAllowed();
                    await this.node.electrifiedApi.setFileContent(this.path, newValue, encoding);
                    this.cache_stringContent.clear(); // Clear values for other encodings
                    this.cache_stringContent.set(encoding, newValue);
                    this.setStringContent_writeOperation = undefined; // We dont' need it anymore, so let's clear the memory which holds a big string
                })()
            }
        }

        promise2retsync(this.setStringContent_writeOperation.promise);
    }

    remove() {
        checkThatCallerHandlesRetsync();

        if(this.exists) {
            this.removeOperation = this.removeOperation || (async () => {
                try {
                    await this.checkWriteAllowed();
                    await this.node.electrifiedApi.removeFile(this.path);
                    await this.cleanup();
                }
                finally {
                    this.removeOperation = undefined;
                }
            })()

            return promise2retsync(this.removeOperation);
        }
    }

    get stats(): FileStats {
        const result = this.getStats();
        if(result === false) {
            throw new Error(`File does not exist: ${this.path}`);
        }
        return result;
    }

    protected getStats() : FileStats | false {
        checkThatCallerHandlesRetsync();

        if(this.cache_stat !== undefined) { // Cache hit?
            return this.cache_stat;
        }

        return asyncResource2retsync(async () => {
            await this.ensureWatchesForChangesOnDisk();

            return this.cache_stat = await this.node.electrifiedApi.getFileStat(this.path);
        }, this, `stats`);
    }

    get exists() {
        return this.getStats() !== false
    }

    protected changeOnDiskHandler = (async(new_stats: FileStats | false ) => {
        // *** Re-populate whole cache content ***:
        // Retrieve cache_stringContents:
        const new_cache_stringContents = new Map<BufferEncoding, string>();
        if(new_stats !== false) { // File exists?
            for (const encoding of this.cache_stringContent.keys()) {
                try {
                    new_cache_stringContents.set(encoding, await this.node.electrifiedApi.getFileContent(this.path, encoding));
                } catch (e) { // I.e. the file was deleted (race condition)
                }
            }
        }
        // Retrieve cache_dirContents
        let new_cache_dirContent: File["cache_dirContent"] = undefined;
        if(new_stats !== false && this.cache_dirContent !== undefined) { // File exists and cache exists?
            new_cache_dirContent = (await this.node.electrifiedApi.getDirectoryContents(this.path)).map((fileName) => this.node.getFile(`${this.path}/${fileName}`));
        }
        // Atomically flip fields at once:
        this.cache_stat = new_stats;
        this.cache_stringContent = new_cache_stringContents;  // this will also make asyncResource2retsync do a fresh fetch. In case of file was deleted or file was re-added
        this.cache_dirContent = new_cache_dirContent;

        // Inform listeners:
        this.changeListeners.forEach(l => {
            try {
                l();
            } catch (e) {
                console.error(e);
            }
        });
    }).bind(this);

    /**
     * Subscribes to and handles file changes
     * @protected
     */
    protected async ensureWatchesForChangesOnDisk() {
        // Subscribe for file changes:
        if(!this.watchesForChanges) { // not yet already watching?
            await this.node.electrifiedClient.withReconnect(async () => {
                await this.node.electrifiedApi.onFileChanged(this.path, this.changeOnDiskHandler);
            })
            this.watchesForChanges = true;
        }
    }

    /**
     * Watches file changes on the server or when it was added or deleted.
     * For directories, when the directory was added or deleted or it's children were added/deleted (not deep).
     * @param listener
     */
    onChange(listener: () => void) {
        this.changeListeners.add(listener);
    }

    offChange(listener: () => void) {
        this.changeListeners.delete(listener);
    }

    /**
     *
     * @param node
     * @param path Must be normalized. Seet {@link normalizePath}
     */
    constructor(node: Node, path: string) {
        this.node = node;
        this.path = path;
        this._jsonObject_watchedProxyFacade.onAfterChange(() => spawnWithErrorHandling(() => retsync2promise(() => this.writeJsonObjectToDisk(this.cache_jsonObject as object))));
        this._jsonObject_safe_watchedProxyFacade.onAfterChange(() => this.writeJsonObjectToDisk(this.cache_jsonObject as object));
    }

    get isFile() {
        return this.stats.isFile;
    }

    get isDirectory() {
        return this.stats.isDirectory;
    }

    get isSymbolicLink() {
        return this.stats.isSymbolicLink
    }

    /**
     * null = file does not exist (redundant but this way we can query it from non-retsync code)
     * @protected
     */
    protected cache_jsonObject?: object | Error | null;
    protected _jsonObject_watchedProxyFacade = new WatchedProxyFacade();
    protected _jsonObject_safe_watchedProxyFacade = new WatchedProxyFacade();

    writeJsonObjectToDisk(jsonObject: object) {
        this.setStringContent(JSON.stringify(jsonObject, undefined, 4), "utf8"); // Write to disk
    }

    /**
     * Retrieves and sets this._cache_jsonObject.
     * @protected
     */
    protected updateJsonObjectFromDisk() {
        try {
            if(!this.exists) {
                this.cache_jsonObject = null;
                return;
            }

            const newObject = JSON.parse(this.getStringContent("utf8"));
            if(newObject === null || (typeof newObject) !== "object") {
                throw new Error(`${this.path} does not have an **object** as root element`)
            }
            if(!_.isEqual(this.cache_jsonObject, newObject)) { // Version on disk is different?
                this.cache_jsonObject = newObject;
            }
        }
        catch (e) {
            if(e != null && e instanceof RetsyncWaitsForPromiseException) {
                throw e;
            }
            this.cache_jsonObject = e as Error;
        }
    }

    protected jsonOnDiskChangeHandlerFn = (() =>  retsync2promise(() => this.updateJsonObjectFromDisk())).bind(this)

    /**
     * This .json file, parsed as a object. Changes to the returned object (can be deep) will result in a write (ignoring errors / only showing a popup).
     * Will always return the same object instance unless there's a write to the file through some other way.
     * Once initialized, it can be used from non-retsync calls.
     * @return object or undefined if file does not exist
     * @see jsonObject_safe For a version with safer writes, not ignoring errors.
     */
    get jsonObject(): object | undefined {
        if(this.cache_jsonObject === undefined) { // not yet initialized?
            this.updateJsonObjectFromDisk();
            this.onChange(this.jsonOnDiskChangeHandlerFn);
        }

        if(this.cache_jsonObject != null && this.cache_jsonObject instanceof Error) {
            throw this.cache_jsonObject;
        }
        else if(this.cache_jsonObject === null) { // File does not exist?
            return undefined;
        }
        return this._jsonObject_watchedProxyFacade.getProxyFor(this.cache_jsonObject);
    }

    /**
     * @see jsonObject
     */
    get jsonObject_safe(): object | undefined {
        return this._jsonObject_safe_watchedProxyFacade.getProxyFor(this.jsonObject);
    }

    /**
     * Sets the new json content and the content will be written to disk (lazily, only if there are changes).
     * <p>
     *     Note: If it's the same json object **instance** since the previous setter call, no change is detected. You have to call {@see writeJsonObjectToDisk} then.
     *     Or it's a good idea to call the getter after setting it. So you retrieve a proxy with change-tracking.
     *     TODO: Implement proxy-facades/PartialGraph#viral feature and automatically track the new value for changes.
     * </p>
     * @param newObject ..., undefined  deletes the file.
     */
    set jsonObject(newObject) {
        // Validate argument
        if(newObject !== undefined && (newObject === null || (typeof newObject) !== "object")) {
            throw new Error(`newObject is not an object`)
        }

        this.onChange(this.jsonOnDiskChangeHandlerFn);

        if(newObject === undefined) {
            if(this.exists) {
                this.remove();
            }
            this.cache_jsonObject = null;
            return;
        }


        if(!_.isEqual(this.cache_jsonObject, newObject)) { // Version on disk is different?
            this.writeJsonObjectToDisk(newObject);
            this.cache_jsonObject = newObject;
        }
        this.cache_jsonObject = newObject;
    }


    /**
     * Not yet implemented
     */
    get preservedJsonObject() {
        throw new Error("TODO")
    }


    /**
     * @returns all child files and directories
     */
    getDirectoryContents(): File[] {
        checkThatCallerHandlesRetsync();

        if(!this.isDirectory) {
            throw new Error(`File is not a directory: ${this.path}`);
        }

        if(this.cache_dirContent !== undefined) { // Cache hit?
            return this.cache_dirContent;
        }

        return asyncResource2retsync(async () => {
            await this.ensureWatchesForChangesOnDisk();
            return this.cache_dirContent = (await this.node.electrifiedApi.getDirectoryContents(this.path)).map((fileName) => this.node.getFile(`${this.path}/${fileName}`));
        }, this, `getDirectoryContents`);
    }

    async checkWriteAllowed() {
        const isClusterFile = this.path.startsWith("/etc/pve/") && !this.path.startsWith("/etc/pve/local/");
        if(isClusterFile) {
           if(!await getElectrifiedApp().datacenter.queryHasQuorum()) { // Cluster has no quorum? Performance note: There shouldn't be so many writes, to it's worth it to do a **fresh** check.
               throw new Error(`Cannot modify file ${this.path}: Cluster has no quorum.`) // Node: It seems like pve's corosync is also denying write access then.
           }
        }
    }

    async cleanup() {
        this.cache_stat = undefined;
        cleanResource(this, `stats`);

        this.cache_stringContent = new Map<BufferEncoding, string>();

        this.cache_jsonObject = undefined;

        this.cache_dirContent = undefined
        cleanResource(this, `getDirectoryContents`);

        if(this.watchesForChanges) {
            await this.node.electrifiedApi.offFileChanged(this.path, this.changeOnDiskHandler);
            this.watchesForChanges = false;
        }
    }
}

/**
 * From: https://stackoverflow.com/questions/71557013/normalize-file-path-in-javascript-front-end
 * @param path
 */
export function normalizePath(path: string) {
    // remove multiple slashes
    path = path.replace(/\/+/g, '/');
    // remove leading slash, will be added further
    if (path.startsWith("/"))
        path = path.substring(1)
    // remove trailing slash
    if (path.endsWith("/"))
        path = path.slice(0, -1);
    let segments = path.split("/");
    let normalizedPath = "/";
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segement = segments[segmentIndex];
        if (segement === "." || segement === "") {
            // skip single dots and empty segments
            continue;
        }
        if (segement === "..") {
            // go up one level if possible
            normalizedPath = normalizedPath.substring(0, normalizedPath.lastIndexOf("/") + 1);
            continue;
        }
        // append path segment
        if (!normalizedPath.endsWith("/"))
            normalizedPath = normalizedPath + "/"
        normalizedPath = normalizedPath + segement;
    }
    return normalizedPath;
}