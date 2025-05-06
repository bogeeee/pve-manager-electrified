import {Node} from "./Node";

/**
 * A dir an a pve node, that is live-watched.
 * See {@link Node#getDir}
 */
export class Dir {
    node: Node

    /**
     * Full path
     */
    path: string


    constructor(node: Node, path: string) {
        this.node = node;
        this.path = path;
    }
}