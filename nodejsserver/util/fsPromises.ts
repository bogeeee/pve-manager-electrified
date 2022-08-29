import fs from 'fs'

/**
 *  A quick polyfill for "fs/promises" because we don't have that api in node < 14
 */
export default {

    readFile(path: fs.PathLike, options:
        {
            encoding: string;
            flag?: fs.OpenMode | undefined;
        }
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.readFile(path, (options as any), (err: NodeJS.ErrnoException | null, data: Buffer) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(data as any); // Idk, cast this to a string
                }
            })
        });
    },

    writeFile(file: fs.PathLike,
        data: string | NodeJS.ArrayBufferView,
        options: fs.WriteFileOptions
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.writeFile(file, data, options, (err: NodeJS.ErrnoException | null) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    },

    stat(path: fs.PathLike): Promise<fs.Stats> {
        return new Promise((resolve, reject) => {
            fs.stat(path, (err: NodeJS.ErrnoException | null, stats: fs.Stats) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(stats);
                }
            });
        });
    },

    exists(path: fs.PathLike): Promise<boolean> {
        return new Promise((resolve, reject) => {
            fs.exists(path, resolve);
        });
    },


}