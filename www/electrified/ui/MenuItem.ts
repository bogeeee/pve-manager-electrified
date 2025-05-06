export interface DeclaredMenuItem {
    onlyForType?: "qemu" | "lxc"
    id?: string
    title: string
    run();
}

export abstract class MenuItem implements DeclaredMenuItem{
    onlyForType?: "qemu" | "lxc"
    id?: string
    abstract title: string

    abstract run();

    runOuter() {
        this.run();
    }

}