export interface DeclaredMenuItem {
    onlyForType?: "qemu" | "lxc"
    id?: string
    title: string
    run(): Promise<void> | void;
}

export abstract class MenuItem implements DeclaredMenuItem{
    onlyForType?: "qemu" | "lxc"
    id?: string
    abstract title: string

    abstract run(): Promise<void> | void;

    runOuter() {
        this.run();
    }

}