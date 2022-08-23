import fs from './util/fsPromises';


export default class WebBuildProcess {
    wwwSourceDir: string;
    /**
     * Bundles everything. Use for production (non ViteDevServer)
     */
    buildStaticFiles: boolean;

    constructor(wwwSourceDir: string, buildStaticFiles: boolean) {
        this.wwwSourceDir =  wwwSourceDir;
        this.buildStaticFiles = buildStaticFiles;
    }

    diagnosis_state?: string

        
    done = false;
    async build(release = true): Promise<BuildResult> {
        if(this.done) {
            throw new Error("Can't reuse the WebBuildProcess object");
        }

        try {            

            console.log("Building web");

            await this.createIndexHtml();
            // copy & modify package.json to enable/disable plugins
            // create listPlugins.js
            // npm prune (without triggers)
            // npm prune on all /root/pveme-plugin projects(without triggers)


            if(release) {
                // Build release
            }

            return {
                buildId: "123", 
                staticFilesDir: "/tmp"
            };
        }
        finally {
            this.done = true;
        }

    }

    /**
     * Creates the index.html from the template
     */
    async createIndexHtml() {
        this.diagnosis_state = "Create index.html";
        //const template = await fs.readFile(this.wwwSourceDir + "/index.html.tpl",{encoding: "utf-8"});
    }

     
}

export type BuildResult = {
    buildId: string,
    staticFilesDir: string,
};