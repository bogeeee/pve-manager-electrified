import {Node} from "./Node";
import {asyncResource2retsync, checkThatCallerHandlesRetsync} from "proxy-facades/retsync";
import {FileStats} from "pveme-nodejsserver/ElectrifiedSession";

// Copied from nodejs's BufferEncoding
/**
 *
 */
type BufferEncoding =
    | "ascii"
    | "utf8"
    | "utf-8"
    | "utf16le"
    | "ucs2"
    | "ucs-2"
    | "base64"
    | "base64url"
    | "latin1"
    | "binary"
    | "hex";



/**
 * A file or directory on a pve node, that is live-watched.
 * See {@link Node#getFile}
 */
export class File {
    node: Node

    /**
     * Full path and filename
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

    getStringContent(encoding: BufferEncoding) {
        checkThatCallerHandlesRetsync();

        if(!this.exists) {
            throw new Error(`File does not exist: ${this.path}`);
        }

        if(this.cache_stringContent.has(encoding)) { // Cache hit?
            return this.cache_stringContent.get(encoding);
        }

        return asyncResource2retsync(async () => {
            await this.ensureWatchesForChanges();

            const result = await this.node.electrifiedApi.getFileContent(this.path, encoding);

            this.cache_stringContent.set(encoding, result);
            return result;
        }, this.cache_stringContent, `getStringContent_${encoding}`);
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
            await this.ensureWatchesForChanges();

            return this.cache_stat = await this.node.electrifiedApi.getFileStat(this.path);
        }, this, `stats`);
    }

    get exists() {
        return this.getStats() !== false
    }

    /**
     * Subscribes to and handles file changes
     * @protected
     */
    protected async ensureWatchesForChanges() {
        // Subscribe for file changes:
        if(!this.watchesForChanges) { // not yet already watching?
            await this.node.electrifiedClient.withReconnect(async () => {
                await this.node.electrifiedApi.watchFileChanges(this.path, async(new_stats ) => {
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
                });
            })
            this.watchesForChanges = true;
        }
    }

    /**
     * Watches file changes on the server
     * @param listener
     */
    onChange(listener: () => void) {
        this.changeListeners.add(listener);
    }

    offChange(listener: () => void) {
        this.changeListeners.delete(listener);
    }

    constructor(node: Node, path: string) {
        this.node = node;
        this.path = path;
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
            await this.ensureWatchesForChanges();
            return this.cache_dirContent = (await this.node.electrifiedApi.getDirectoryContents(this.path)).map((fileName) => this.node.getFile(`${this.path}/${fileName}`));
        }, this, `getDirectoryContents`);
    }
}