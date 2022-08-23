import fs from 'fs'

/**
 *  A quick polyfill for "fs/promises" because we don't have that api in node < 14
 */
export default {
    stat(path: fs.PathLike): Promise<fs.Stats> {
        return new Promise((resolve, reject) => {
            fs.stat(path, (err: NodeJS.ErrnoException | null, stats: fs.Stats) => {
                if(err) {
                    reject(err);
                }
                else {
                    resolve(stats);
                }
            });
        });        
    }
}