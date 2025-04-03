import https from "node:https"
import express from 'express'
import axios, {AxiosRequestConfig} from "axios";

/**
 *
 * execute a conditional function, to decide for each request whether the (express-) middleware should be executed or not
 *
 * Example. Only serve when url starts with /u2f-api.js:
 * expressApp.use("/", conditionalMiddleware((req) => req.url.startsWith("/u2f-api.js"), express.static(this.wwwSourceDir) ));
 *
 * @returns
 */
export function conditionalMiddleware(conditionFn: (req: express.Request) => boolean, router: express.RequestHandler) {
      const result = express.Router();
      result.use("/", function (req: express.Request, res: express.Response, next: express.NextFunction) { // The express doc says, it wont't with .use. But is works ! This way it is more usefull to securely restrict ALL requests.
        if (conditionFn(req)) {
          next();
        }
        else {
          next("router"); // skip everything in this router. The express doc says next("route") -> BUG ???
        }
      });

      result.use(router);

      return result;
  }

export async function better_fetch(...args: Parameters<typeof fetch>) {
    const request = args[0] as any;
    let result: Awaited<ReturnType<typeof fetch>>;
    try {
        result = await fetch(...args);
    }
    catch (e) {
        if((e as any)?.message === "fetch failed") {
            // Throw with a better message
            throw new Error(`could not fetch url: ${request?.url?request.url:request.toString()}${ ((e as any)?.cause?.message)?`: ${(e as any).cause.message}`:""}`, {cause: e});
        }
        throw e;
    }

    if(!result.ok) {
        throw new Error(`could not fetch url: ${request?.url?request.url:request.toString()}:  ${result.status}: ${result.statusText}`)
    }
    return result;
}

/**
 * Axios without certificate check
 * @param url
 * @param config
 */
export async function axiosExt(url: string, config?: AxiosRequestConfig) {
    return axios.request({
        url,
        // Disable cert check:
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
        }),
        ...(config || {})
    })
}

export function errorToString(e: any): string {
    // Handle other types:
    if (!e || typeof e !== "object") {
        return String(e);
    }
    if (!e.message) { // e is not an ErrorWithExtendedInfo ?
        return JSON.stringify(e);
    }
    e = e as Error;

    return (e.name ? `${e.name}: ` : "") + (e.message || String(e)) +
        (e.stack ? `\n${e.stack}` : '') +
        (e.fileName ? `\nFile: ${e.fileName}` : '') + (e.lineNumber ? `, Line: ${e.lineNumber}` : '') + (e.columnNumber ? `, Column: ${e.columnNumber}` : '') +
        (e.cause ? `\nCause: ${errorToString(e.cause)}` : '')
}