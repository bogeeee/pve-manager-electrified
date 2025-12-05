// This file is a bug workaround and provides you global symbols that can't stay in Application.ts. Because importing these symbols would cause circular references and makes vite's HMR fail (it just doesn't relead the page on changes anymore)
import type {Application} from "./Application"; // Import only the type. This is no real dependency!

export function getElectrifiedApp(){
    return (window as any).electrifiedApp as Application
}

export function gettext(text: string) {
    return getElectrifiedApp().getText(text);
}

/**
 * Translates text into the current ui language. It looks it up in the electrified translation repo.
 * It uses the "taged template" syntax which allows to easily inert variables.
 * <p>
 *     Usage example: <code>t`You have ${numberOfUnread} unread messages`</code>
 * </p>
 * TODO: create an electrified and plugin-wide text repo and look up text there
 * @param englishTextTokens
 * @param values
 */
export function t(englishTextTokens: TemplateStringsArray, ...values: any[]) {
    return getElectrifiedApp().getTranslatedTextWithTags(englishTextTokens, ...values);
}

// Copied from nodejs's BufferEncoding
/**
 *
 */
export type BufferEncoding =
    | "ascii"
    | "utf8"
    | "utf-8"
    | "utf16le"
    | "ucs2"
    | "ucs-2"
    | "base64"
    | "base64url"
    | "latin1"
    | "binary"
    | "hex";

export type MeteredValue = {
    value: number,
    /**
     * Age on server at the time it was fetched.
     * It is the middle of the first and last sample in the (1 second) sample window. Meaning, when it's super fresh, it will be 500.
     * In milliseconds
     * @see clientTimestamp
     */
    ageMs: number,
}