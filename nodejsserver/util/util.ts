
import express from 'express'

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