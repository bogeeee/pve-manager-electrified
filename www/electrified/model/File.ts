import {Node} from "./Node";
import {asyncResource2retsync, promise2retsync} from "../util/retsync";

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
 * A file an a pve node, that is live-watched.
 * See {@link Node#getFile}
 */
export class File {
    node: Node

    /**
     * Full path and filename
     */
    path: string

    protected changeListeners = new Set<(() => void)>();

    /**
     * We save the result of getStringContent, so react-deepwatch can track live changes
     * encoding -> content
     * @protected
     */
    protected cache_stringContent = new Map<BufferEncoding, string>(); // TODO: Theoretically this cache is redundant with that from asyncResource2retsync. Improve it

    protected watching = false;

    getStringContent(encoding: BufferEncoding) {
        if(this.cache_stringContent.has(encoding)) { // Cache hit?
            return this.cache_stringContent.get(encoding);
        }

        return asyncResource2retsync(async () => { // Thought: the following is not strictly a "Resource" because it has side effects of manipulating the cache at any time
            // Subscribe for file changes:
            if(!this.watching) { // not yet already watching?
                await this.node.electrifiedClient.withReconnect(async () => {
                    await this.node.electrifiedApi.watchFileChanges(this.path, async() => {
                        // Re-populate cache content:
                        for(const encoding of this.cache_stringContent.keys()) {
                            this.cache_stringContent.set(encoding, await this.node.electrifiedApi.getFileContent(this.path, encoding));
                        }

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
                this.watching = true;
            }

            const result = await this.node.electrifiedApi.getFileContent(this.path, encoding);

            this.cache_stringContent.set(encoding, result);
            return result;
        }, this, `getStringContent_${encoding}`);
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