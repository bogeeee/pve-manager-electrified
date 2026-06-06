
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

    private directWatcher!: FSWatcher;

    /**
     * In case {@link directWatcher} silently fails to generate events
     */
    private fallbackPollingWatcher: FSWatcher;

    /**
     * Keep track, so we can only fire events on actual changes. False = file does not exist
     */
    lastFileState?: Buffer | String[] | false;

    listeners = new ClientCallbackSet<[stat: FileStats | false]>() as Set<(stat: any | false) => void> // Bug workaround: 'as Set...' to net export the ClientCallbackSet type because typescript-rtti gets the imports wrong

    constructor(file: string, fallbackPollInterval: number) {
        this.file = file;
        this.directWatcher = this.createWatchter({});
        this.fallbackPollingWatcher = this.createWatchter({usePolling: true, interval: fallbackPollInterval});
    }

    private createWatchter(options: any /* Rtti bug workaround: Partial<ChokidarOptions> -> any */) {
        const watcher = chokidar.watch(this.file, {
            ...options,
            persistent: false, atomic: true,
            ignoreInitial: true,
            depth: 0, // For directories, only the first child level
        });
        ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach(async (eventName) => {
            (watcher as any).on(eventName, async (trigger_path?: any) => {
                try {
                    const fileStat = await ElectrifiedSession.getFileStat(this.file);

                    //console.log("change event. Path: " + this.file + "; trigger_path:" + trigger_path + ": " + eventName + ", watcher.interval: " + options.interval + ",  stat: " + JSON.stringify(fileStat));

                    const getFileState = async () => {
                        try {
                            if (!fileStat) {
                                return false;
                            }
                            if (fileStat.isDirectory) {
                                return await fsPromises.readdir(this.file, {encoding: "utf8"})
                            } else
                                return await fsPromises.readFile(this.file); // The file still not existing was often observed
                        } catch (e) {
                            return false; // assume file does not exist
                        }
                    }
                    const currentFileState = await getFileState();
                    if (_.isEqual(this.lastFileState, currentFileState)) { // no change
                        return; // Don't call listeners twice
                    }

                    this.lastFileState = currentFileState;

                    (this.listeners as any).call(fileStat);
                }
                catch (e) {
                    console.error(e); // Only log. Don't kill the process
                }

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