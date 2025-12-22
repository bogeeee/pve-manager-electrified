import {ResourceMeter} from "./util/ResourceMeter.js";
import fs from "node:fs";
import {execa} from "execa";
import fsPromises from "node:fs/promises";
import {MapSet, newDefaultMap, spawnAsync} from "./util/util.js";
import {ElectrifiedSession} from "./ElectrifiedSession.js";

/**
 * Saves the last polled cpu usage. Offers methods to smarty collect the cpu usage of all guests
 *
 * TODO: There seems to be also good cpu usage info for lxcs under /sys/fs/cgroup/lxc/{id}/cpu.stat. This should be much faster collecting all descendant processes. https://www.reddit.com/r/Proxmox/comments/1przhbg/comment/nvcygm6/?context=1
 */
export class GuestCpuMeters {
    lastPollTime : Date | undefined;

    totalCpuMeter = new TotalCpuUsageMeter();

    /**
     * pid -> ...
     */
    processUsageMeters = newDefaultMap<number, ProcessCpuUsageMeter>((key) => new ProcessCpuUsageMeter(key));

    last_guest2Pids?: Awaited<ReturnType<GuestCpuMeters["fetchGuests2Pids"]>>

    /**
     * How much of one cpu core may the stats collection take. Normally, not when user gives a priority boost
     */
    MAX_OVERHEAD = 0.02; // 2% //TODO: It seams in reality, the costs are 5x as high. Remeasure the operations and adjust the ..._cost constants
    /**
     * When there was no poll for a while, we cap the ammount of collected coins. In milliseconds.
     */
    MAX_BURST_MS = 1000;


    /**
     * Remaining coins (not used from last poll).
     * 1 coin = 1 µs cpu time. Estimations are based on
     */
    coins = 0;

    isFetching = false;


    /**
     * @returns guest pids an their cpu usage
     */
    async getUsage() {
        const clockTicksPerSecond = await getClockTicksPerSecond();

        await this.fetchUsage();

        if(!this.last_guest2Pids) {
            throw new Error("Process list not fetched. This can be a race condition on fresh server start (that's ok) or not enough coins to fetch the process list even once. Please adjust the parameters then.")
        }

        const totalCpuUsage = this.totalCpuMeter.peekSpeed(1000);
        return {
            totalCpuUsage: totalCpuUsage?{
                value: totalCpuUsage.value / clockTicksPerSecond,
                ageMs: this.totalCpuMeter.getAgeMs(),
            }:undefined,

            guestCpuUsage: this.last_guest2Pids.map(g => {
                const processCpuUsageMeter = this.processUsageMeters.get(g.pid);
                const usage = processCpuUsageMeter.peekSpeed(1000);
                return {
                    guestId: g.guestId,
                    pid: g.pid,
                    currentCpuUsage: usage?{
                        value: usage.value / clockTicksPerSecond,
                        ageMs: processCpuUsageMeter.getAgeMs(),
                    }:undefined,
                }
            })
        };
    }


    /**
     * Fetches as much as there are coins
     * @param overhead_boostFactor
     */
    protected async fetchUsage() {
        if(this.isFetching) { // Some other "thread" is currently doing the job?
            return;
        }

        try {
            this.isFetching = true;

            // give us some coins if the last poll is some time ago:
            const boostFactor = ElectrifiedSession.getBrowserWindows().some(w => w.isFocused) ? 3 : 1; // Give us more coins, when someone has the browser window focused
            const coinsPerMs = this.MAX_OVERHEAD * 1e6 / 1000;
            if (!this.lastPollTime || this.last_guest2Pids === undefined) { // first run?
                this.coins = Number.POSITIVE_INFINITY;
            } else {
                const diff = new Date().getTime() - this.lastPollTime.getTime();
                this.coins += diff * coinsPerMs * boostFactor;
            }
            this.coins = Math.min(this.coins, coinsPerMs * this.MAX_BURST_MS * boostFactor); // CAP to max burst size (+ allow more when boosted)
            this.lastPollTime = new Date();

            // Retrieve total cpu:
            const totalCpuMeasuring_cost = 11;
            if (this.coins < totalCpuMeasuring_cost) {
                return;
            }
            this.coins -= totalCpuMeasuring_cost;
            await this.totalCpuMeter.getSpeed(); // Measure

            // Retrieve all processes:
            const guests2Pids_cost = 6000;
            if (this.coins < guests2Pids_cost * 3) {
                return; // Not worth it
            }
            this.coins -= guests2Pids_cost;
            const guests2Pids = this.last_guest2Pids = await this.fetchGuests2Pids();

            // Clean up unused process meters:
            const rootPidsUsedByGuests = new Set(guests2Pids.map(g => g.pid));
            [...this.processUsageMeters.keys()].forEach(p => {
                if (!rootPidsUsedByGuests.has(p)) {
                    this.processUsageMeters.delete(p);
                }
            })

            // *** retrieve cpu usage of guests: ****
            if(!ElectrifiedSession.getBrowserWindows().some(w => w.needsCpuUsage)) { // no one needs it?
                return;
            }
            guests2Pids.sort((a, b) => (a.getMeasuringCost() / a.getUrgency() ) - (b.getMeasuringCost() / b.getUrgency()));  // Sort by cost
            for (const guest of guests2Pids) {
                if (this.coins < guest.getMeasuringCost()) { // Not enough coins left ?
                    continue;
                }

                const cpuUsageMeter = this.processUsageMeters.get(guest.pid);
                if(!cpuUsageMeter.up2date()) {
                    // Do the measurement
                    this.coins -= guest.getMeasuringCost();
                    try {
                        cpuUsageMeter.runtime_descendantPids = guest.descendantPids;
                        await cpuUsageMeter.getSpeed();
                    } finally {
                        cpuUsageMeter.runtime_descendantPids = undefined;
                    }
                }
            }
        }
        finally {
            this.isFetching = false;
        }
    }

    protected async fetchGuests2Pids() {
        const me = this;
        class Guest {
            guestId: number;
            guestType: "kvm" | "lxc";
            pid: number;
            descendantPids!: number[]

            constructor(guestId: number, guestType: "kvm" | "lxc", pid: number) {
                this.guestId = guestId;
                this.guestType = guestType;
                this.pid = pid;
            }

            getMeasuringCost() {
                const singleProcessCost = 11; //const singleProcessCost = 1500; // good value for testing
                return singleProcessCost + (this.descendantPids!.length * singleProcessCost);
            }

            getUrgency() {
                const processCpuUsageMeter = me.processUsageMeters.get(this.pid);
                return processCpuUsageMeter.getLatestSampleAgeMs();
            }
        }

        // Run the /bin/ps command, scan rows and collect parent->child pids and Guests (identified by lines with a certain command+args). Performance note: the ps command is much faster than scanning /proc for all child processes. fs.listDir calls take too long.
        const systemdPid = 1;
        const result: Guest[] = [];
        const childPids = new MapSet<number, number>();
        for (const line of (await execa("/usr/bin/ps",[ "--no-headers", "-A", "-o", "pid ppid args"])).stdout.split("\n")) {
            const tokens = line.trim().split(/\s+/);
            const pid = Number(tokens[0]);
            const parentPid = Number(tokens[1]);
            const command = tokens[2];
            const args = tokens.slice(3);

            childPids.add(parentPid, pid);

            let guestId: number;
            if (command === "/usr/bin/kvm") {
                if (args[0] !== "-id") {
                    continue;
                }
                guestId = Number(args[1]);
                result.push(new Guest(guestId, "kvm", pid) );
            } else if (command === "/usr/bin/lxc-start") {
                if(parentPid !== systemdPid) {
                    continue; // security: Ignore nested lxc-start lines that were spawned in a guest.
                }
                if (!(args[0] === "-F" && args[1] === "-n")) {
                    continue;
                }
                guestId = Number(args[2]);
                result.push(new Guest(guestId, "lxc", pid) );
            }
        }

        // Collect Guest#descendantPids:
        function addChildPids(target: number[], parentPid: number) {
            for(const c of childPids.get(parentPid)?.values() || []) {
                target.push(c);
                addChildPids(target, c);
            }
        }
        result.forEach(g => {
            g.descendantPids = [];
            addChildPids(g.descendantPids, g.pid);
        });

        return result;
    }
}




/**
 * For one process, including all its childs
 * the returns units are clock ticks and clock ticks / second
 */
export class ProcessCpuUsageMeter extends ResourceMeter {
    pid: number;
    runtime_descendantPids?: number[];
    recordWindowSizeMs = 30000;
    maxResolutionMs = 510;

    constructor(pid: number) {
        super();
        this.pid = pid;
    }

    protected async fetchDistance(): Promise<bigint> {
        let result = BigInt(0);
        for(const pid of [this.pid, ...this.runtime_descendantPids!]) {
            try {
                result += await ProcessCpuUsageMeter.getClockTicksForProcess(pid);
            }
            catch (e) { // I.e proc file does not exist anymore because the process has terminated in the meanwhile ?

            }
        }
        return result;
    }

    protected static async getClockTicksForProcess(pid: number): Promise<bigint> {
        // Read stat file:
        const statContent = fs.readFileSync(`/proc/${pid}/stat`, {encoding: "ascii" /* should be faster */}); // fs.readFileSync is ~2 times as fast as the fsPromises version.
        await yield_async(20); // Prevent too much blocking (theoretical), because this method gets called hundreds of times in a row.

        const tokens = statContent.split(" ");
        const utime = BigInt(tokens[13]); // user time in clock ticks
        const stime = BigInt(tokens[14]); // system time clock ticks
        const total = utime + stime;

        return total;
    }

    protected static async getChildPids(pid: number) {
        const result: number[] = [];
        for(const taskDir of await fsPromises. readdir(`/proc/${pid}/task`, {encoding: "ascii" /* should be faster */})) {
            const strChildren = (await fs.readFileSync(`/proc/${pid}/task/${taskDir}/children`, {encoding: "ascii" /* should be faster */})).trim();
            if(strChildren) {
                result.push(...strChildren.split(" ").map(c => Number(c)));
            }
        }
        return result;
    }
}

/**
 * For this whole machine
 * the returns units are clock ticks and clock ticks / second
 */
export class TotalCpuUsageMeter extends ResourceMeter {
    recordWindowSizeMs = 30000;
    maxResolutionMs = 510;

    protected async fetchDistance(): Promise<bigint> {
        // Read stat file:
        const statContent = fs.readFileSync(`/proc/stat`, {encoding: "ascii" /* should be faster */}); // fs.readFileSync is ~2 times as fast as the fsPromises version.
        await yield_async(20); // Prevent too much blocking (theoretical), because this method gets called hundreds of times in a row.
        let result = BigInt(0);
        for(const line of statContent.split("\n")) {
            if(!line.startsWith("cpu ")) {
                continue;
            }
            const tokens = statContent.trim().split(" ");
            const [cpu, user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice] = tokens;
            return (BigInt(user) + BigInt(nice) + BigInt(system) + BigInt(irq) + BigInt(softirq));
        }
        throw new Error("Illegal file content");
    }
}

let clockTicksPerSecond: number | undefined = undefined;
export async function getClockTicksPerSecond() {
    if(clockTicksPerSecond !== undefined) {
        return clockTicksPerSecond;
    }

    clockTicksPerSecond = Number((await execa("getconf", ["CLK_TCK"])).stdout);
    return clockTicksPerSecond;
}

//@ts-ignore
//spawnAsync(()=>getClockTicksPerSecond(),true); // Retrieve once


let yieldCounter: number = 0;
async function yield_async(every = 1) {
    yieldCounter++;
    if(yieldCounter < every) {
        return;
    }

    // yield:
    yieldCounter = 0;
    await new Promise((resolve) => setTimeout(resolve) );
}
