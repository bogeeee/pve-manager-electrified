// this .**js** file is always available, even when the vite-devserver refuses to serve files, it gets served by the route: `expressApp.use("/", express.static(this.wwwSourceDir));`
// It diagnoses, if the user has not enough permissions when running with vite-devserver and show a proper message then and also, if the vite connection did not work because of **outdated** permissions.
(async () => {
    const result = await (await better_fetch("/electrifiedAPI/diagnosis_canAccessWeb", {headers: {csrfProtectionMode: "corsReadToken"}})).json();
    if(result === false) { // Not enough permissions?
        // Show message to the user:
        document.body.innerHTML = `<strong>Not enough permissions</strong>. The server is in vite-devserver mode and you need to be logged in and have Sys.Console permissions to view the page.<br/>
Please use the <a target="webBuild" href="/webBuild">Web build control panel</a> to log in.`;
        document.head.innerHTML = `<title>PVE electrified - not enough permissions</title>`; // this kills als the other scripts
    }
    else if(result === "cachePermissionsWereOutDated") {
        // This means: vite-devserver connection was rejected, because it had no/outdated permissions, cause they were not initialized yet. (was = because the vite-client script always runs first and we can't control that order)

        window.location.reload(); // Try again now with the permissions in the cache (session)
    }
})()


// *** UTIL Functions ***
async function better_fetch(...args) {
    const request = args[0];
    let result;
    try {
        result = await fetch(...args);
    }
    catch (e) {
        if((e)?.message === "fetch failed") {
            // Throw with a better message
            throw new Error(`could not fetch url: ${request?.url?request.url:request.toString()}${ ((e)?.cause?.message)?`: ${(e).cause.message}`:""}`, {cause: e});
        }
        throw e;
    }

    if(!result.ok) {
        // Try to get content
        let content = "";
        try {
            content = " content:\n" + await result.text();
        }
        catch(e) {}

        throw new Error(`could not fetch url: ${request?.url?request.url:request.toString()}:  ${result.status}: ${result.statusText}${content}`)
    }
    return result;
}