
import {ClientCallbackSet} from "restfuncs-server";
import {ElectrifiedSession, FileStats} from "../ElectrifiedSession.js";
import chokidar, {ChokidarOptions, FSWatcher} from "chokidar";
import {spawnAsync} from "./util.js";
import fsPromises from "node:fs/promises";
import _ from "underscore";

/**
 * Watcher for one file.
 * This is is bug workaround because the chokidar watcher sometimes fails and does not fire events. Especially after the file was written to (mostly by this process but also by other processes).
 * So we use additional polling
 */
export class SaferFileWatcher {
    file!: string;

    directWatcher!: FSWatcher;

    /**
     * In case {@link directWatcher} silently fails to generate events
     */
    fallbackPollingWatcher: FSWatcher;

    /**
     * Keep track, so we can only fire events on actual changes. False = file does not exist
     */
    lastFileState?: Buffer | String[] | false;

    listeners = new ClientCallbackSet<[stat: FileStats | false]>();

    constructor(file: string, fallbackPollInterval: number) {
        this.file = file;
        this.directWatcher = this.createWatchter({});
        this.fallbackPollingWatcher = this.createWatchter({usePolling: true, interval: fallbackPollInterval});
    }

    createWatchter(options: Partial<ChokidarOptions>) {
        const watcher = chokidar.watch(this.file, {
            ...options,
            persistent: false, atomic: true,
            ignoreInitial: true,
            depth: 0, // For directories, only the first child level
        });
        ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach(async (eventName) => {
            (watcher as any).on(eventName, async (trigger_path?: any) => {
                //console.log("change event. Path: " + file + "; trigger_path:" + trigger_path + ": " + eventName + ", watcher.interval: " + watcher.interval + ",  stat: " + JSON.stringify(fileStat));

                const fileStat = await ElectrifiedSession.getFileStat(this.file);

                const getFileState = async ()=> {
                    try {
                        if(!fileStat) {
                            return false;
                        }
                        if(fileStat.isDirectory) {
                            return await fsPromises.readdir(this.file, {encoding: "utf8"})
                        }
                        else
                            return await fsPromises.readFile(this.file); // The file still not existing was often observed
                    }
                    catch (e) {
                        return false; // assume file does not exist
                    }
                }
                const currentFileState = await getFileState();
                if(_.isEqual(this.lastFileState, currentFileState)) { // no change
                    return; // Don't call listeners twice
                }

                this.lastFileState = currentFileState;

                this.listeners.call(fileStat);

            });
        });

        (watcher as any).on("error", async (error: unknown) => {
            console.error(error);
        });

        return watcher;
    }

    get pollInterval() {
        return this.fallbackPollingWatcher.options.interval;
    }

    set pollInterval(newInterval: number) {
        if(this.pollInterval === newInterval) {
            return;
        }

        // Re-create watcher:
        const oldWatcher = this.fallbackPollingWatcher;
        spawnAsync(() => oldWatcher.close(), false);
        this.fallbackPollingWatcher = this.createWatchter({usePolling: true, interval: newInterval});
    }
}