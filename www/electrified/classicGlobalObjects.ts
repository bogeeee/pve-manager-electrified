// This module makes  global objects from legacy libraries available
let global: any = window;

export const Ext = global.Ext; // js/Ext/ext-all-debug.js

if(Ext === undefined) { // safety check if ext (and other stuff is really available)
    throw "Ext is not defined. Make sure to load/include the classic scripts **before** the electrified ones";
}

