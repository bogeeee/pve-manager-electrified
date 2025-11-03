import {Node} from "./Node";
import {asyncResource2retsync, checkThatCallerHandlesRetsync} from "proxy-facades/retsync";

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
 * Copied from nodejsserver/node_modules/@types/node/fs.d.ts
 */
export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: Number;
    ino: Number;
    mode: Number;
    nlink: Number;
    uid: Number;
    gid: Number;
    rdev: Number;
    size: Number;
    blksize: Number;
    blocks: Number;
    atimeMs: Number;
    mtimeMs: Number;
    ctimeMs: Number;
    birthtimeMs: Number;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
}

/**
 * A file an a pve node, that is live-watched.
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
    protected cache_stat?: Stats | false;

    protected changeListeners = new Set<(() => void)>();

    /**
     * We save the result of getStringContent (redundantly), so react-deepwatch can track live changes
     * encoding -> content
     * @protected
     */
    protected cache_stringContent = new Map<BufferEncoding, string>();

    protected watchesForChanges = false;

    getStringContent(encoding: BufferEncoding) {
        checkThatCallerHandlesRetsync();

        if(!this.exists) {
            throw new Error("File does not exist");
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

    get stat(): Stats {
        const result = this.getStats();
        if(result === false) {
            throw new Error("File does not exist");
        }
        return result;
    }

    protected getStats() : Stats | false {
        checkThatCallerHandlesRetsync();

        if(this.cache_stat !== undefined) { // Cache hit?
            return this.cache_stat;
        }

        return asyncResource2retsync(async () => {
            await this.ensureWatchesForChanges();

            return this.cache_stat = await this.node.electrifiedApi.getFileStat(this.path);
        }, this.cache_stringContent, `stats`);
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
                    // Re-populate whole cache content:
                    const new_cache_stringContents = new Map<BufferEncoding, string>();
                    if(new_stats !== false) { // File exists?
                        for (const encoding of this.cache_stringContent.keys()) {
                            try {
                                new_cache_stringContents.set(encoding, await this.node.electrifiedApi.getFileContent(this.path, encoding));
                            } catch (e) { // I.e. the file was deleted (race condition)
                            }
                        }
                    }
                    // Atomically flip fields at once:
                    this.cache_stat = new_stats;
                    this.cache_stringContent = new_cache_stringContents;  // this will also make asyncResource2retsync do a fresh fetch. In case of file was deleted or file was re-added

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
}