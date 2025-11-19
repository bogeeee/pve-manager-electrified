import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {Guest} from "./Guest";
import {throwError} from "../util/util";
import {Node} from "./Node"
import {getElectrifiedApp} from "../globals";


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
        // construct nodes:
        this.nodes = new Map<string, Node>();
        for(const nodeResult of (await getElectrifiedApp().api2fetch("GET", "/nodes")) as any) {
            const name = nodeResult.node;
            const node = await Node.create({name});
            this.nodes.set(name, node);
        }
    }

    getNode_existing(name: string) {
        return this.nodes.get(name) || throwError(`Node does not exist: ${name}`);
    }

    /**
     * Synchronous / live
     * @return hasQuorum / cluster is in sync (from this node's perspective)
     */
    get hasQuorum() {
        return true; // TODO
    }

    onOnlineStatusChanged(listener: (online: boolean)=> void) {
        // TODO
    }
}