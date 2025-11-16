/**
 * Reflects /etc/pve/local/electrified.json
 */
export class ElectrifiedJsonConfig {
    static readonly filePath = "/etc/pve/local/electrified.json";
    plugins: {
        name: string,
        version: string,
        codeLocation: "local"|"datacenter"|"npm",
    }[] = []
}