import {detached, newDefaultWeakMap} from "./util";

let idGenerator = 0;

const debug_instanceIds = newDefaultWeakMap(o => ++idGenerator);

export class AsyncConstructableClass {
    constructor() {
        this.debug_instanceId; // trigger lazy initialization
    }


    protected async constructAsync(): Promise<void> {

    }

    static async create<C extends AsyncConstructableClass>(this: new () => C, initialFields?: Partial<C>): Promise<C> {
        const result = new (this as any)() as C;

        if(initialFields) {
            Object.assign(result, initialFields);
        }

        await result.constructAsync();
        return result;
    }

    get debug_instanceId() {
        return debug_instanceIds.get(this);
    }
}