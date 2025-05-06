import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {throwError} from "../util/util";
import {Node} from "./Node"


export class Datacenter extends AsyncConstructableClass{
    nodes!: Map<string, Node>;

    getGuest(id: number): Guest | undefined {
        for(const node of this.nodes.values()) {
            const guest = node.getGuest(id);
            if(guest) {
                return guest;
            }
        }
    }

    protected async constructAsync(): Promise<void> {
        // TODO: construct nodes. Also see application constructor because of currentNode
    }

    getNode_existing(name: string) {
        return this.nodes.get(name) || throwError(`Node does not exist: ${name}`);
    }
}