import {AsyncConstructableClass} from "../util/AsyncConstructableClass";
import {newDefaultMap, throwError} from "../util/util";
import {File} from "./File";
import {Dir} from "./Dir";
import {RestfuncsClient} from "restfuncs-client";
import type {ElectrifiedSession} from "pveme-nodejsserver/ElectrifiedSession"
import {Guest} from "./Guest";

export class Node extends AsyncConstructableClass {
    electrifiedApi = new RestfuncsClient<ElectrifiedSession>("/electrifiedAPI", {/* options */}).proxy // TODO: path for this node

    protected files = newDefaultMap<string, File>((path) => new File(this, path));
    protected dirs = newDefaultMap<string, File>((path) => new Dir(this, path));
    protected guests!: Map<number, Guest>

    get name() {
        throw new Error("TODO");
    }
    
    getFile(path: string): File {
        return this.files.get(path);
    }

    getDir(path: string): Dir {
        return this.dirs.get(path);
    }

    getGuest(id: number) : Guest | undefined{
        return this.guests.get(id);
    }

    getGuest_existing(id: number){
        return this.getGuest(id) || throwError(`Guest with id ${id} does not exist on node: ${this.name}`);
    }
}