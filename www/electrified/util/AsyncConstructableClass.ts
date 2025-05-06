export class AsyncConstructableClass {
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
}