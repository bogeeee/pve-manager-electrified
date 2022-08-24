import {execa} from "execa";


/**
 * 
 */
const port = 8006;

(async () => {

    try {
        await execa("fuser", ["-n", "tcp", "-k", `${port}`]);

        console.log(`killed old process(es) on port ${port}`);
    }
    catch(e) {
        // ignore
    }
    
})();
