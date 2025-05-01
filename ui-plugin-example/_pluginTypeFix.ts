// See pveme-ui/electrified/Plugin/Plugin.ts#fixPluginClass for the WHY
import type {PluginClass} from "pveme-ui/electrified/Plugin";

export class DummyPluginBase {

}
(DummyPluginBase as any)["_isDummyPluginBase"] = true; // Add a marker, just in case that it is minified in the future

export const PvemePlugin = DummyPluginBase as any as PluginClass;

