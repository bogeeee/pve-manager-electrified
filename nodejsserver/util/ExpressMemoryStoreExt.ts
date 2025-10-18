import {MemoryStore, SessionData} from "express-session";

/**
 * Adds a method to it
 */
export class ExpressMemoryStoreExt extends MemoryStore {
    getSessionSync(sessionId: string) {
        // Copied from node_modules/express-session/session/memory.js
        //@ts-ignore
        var sess = this.sessions[sessionId]

        if (!sess) {
            return
        }

        // parse
        sess = JSON.parse(sess)

        if (sess.cookie) {
            var expires = typeof sess.cookie.expires === 'string'
                ? new Date(sess.cookie.expires)
                : sess.cookie.expires

            // destroy expired session
            if (expires && expires <= Date.now()) {
                //@ts-ignore
                delete this.sessions[sessionId]
                return
            }
        }

        return sess as Record<string, unknown>;
    }
}