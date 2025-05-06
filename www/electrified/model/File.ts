import {Node} from "./Node";

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


    constructor(node: Node, path: string) {
        this.node = node;
        this.path = path;
    }
}