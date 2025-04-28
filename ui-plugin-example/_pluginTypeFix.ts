// See pveme-ui/electrified/Plugin/Plugin.ts#fixPluginClass for the WHY
import type {PluginClass} from "pveme-ui/electrified/Plugin";

export class DummyPluginBase {

}

export const PvemePlugin = DummyPluginBase as any as PluginClass;

