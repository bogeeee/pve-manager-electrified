
type Sample= {
    time: bigint,
    /**
     * The measured value
     */
    distanceValue: bigint | undefined
}

export abstract class ResourceMeter {
    // *** config ***
    maxResolutionMs = 10;
    recordWindowSizeMs = 10000;

    // *** state ***
    protected samples: Sample[] = []
    protected abstract fetchDistance(): Promise<bigint | undefined>

    protected async poll() {
        if(this.up2date() ) { // already up 2 date?
            return;
        }

        const now = process.hrtime.bigint();
        this.samples.push({time: now, distanceValue: await this.fetchDistance()})
        this.cleanUpSamples();
    }

    up2date() {
        const now = process.hrtime.bigint();
        const lastSample = this.samples.length > 0?this.samples[this.samples.length -1]:undefined;
        return (lastSample && lastSample.time + (BigInt(this.maxResolutionMs) * BigInt(1e6)) > now);
    }

    protected cleanUpSamples() {
        const samples = this.samples;
        const minTime = process.hrtime.bigint() - (BigInt(this.recordWindowSizeMs) * BigInt(1e6));
        let i = 0;
        while(i < samples.length && samples[i].time < minTime) { // While sample too old
            i++;
        }
        this.samples = this.samples.slice(i);
    }

    /**
     *
     * @param minTimeWindowMs maximum.
     * @returns speed in distance per second
     */
    peekSpeed(minTimeWindowMs = 1000) {
        const samples = this.samples;
        const minTimeWindow = (BigInt(minTimeWindowMs) * BigInt(1e6));
        // Collect  earliest and latest valid sample as good as possible:
        let earliest: Sample | undefined = undefined;
        let latest: Sample | undefined = undefined;
        for(let i = samples.length -1; i >= 0; i--) {
            const sample = samples[i]

            if(sample.distanceValue === undefined) {
                continue;
            }

            if(!latest) {
                latest= sample
            }
            earliest = sample;

            if(earliest.time < (latest.time - minTimeWindow)) { // Difference between collected samples is big enough?
                break;
            }
        }

        if(earliest !== undefined && latest !== undefined) {
            if(earliest.time > (latest.time - minTimeWindow)) { // Difference between collected samples is not big enough?
                return undefined;
            }
            const timeDiff = latest.time - earliest.time;
            const distanceDiff = latest.distanceValue! - earliest.distanceValue!;
            const second =BigInt(1e9);
            return {
                value:  Number(distanceDiff) * Number(second) / Number(timeDiff),
                earliestSample: earliest,
                latestSample: latest,
            }

        }
        return undefined;
    }

    async getSpeed(timeWindowMs = 1000) {
        await this.poll();
        return this.peekSpeed(timeWindowMs);
    }

    /**
     * Age of reading in milliseconds. It's the middle between the first and last sample in the window.
     * Maximum is recordWindowSizeMs
     */
    getAgeMs(minTimeWindowMs = 1000) {
        const speed = this.peekSpeed(minTimeWindowMs);
        if(speed === undefined) {
            return this.recordWindowSizeMs;
        }

        const now = process.hrtime.bigint();
        return Number(now - (speed.earliestSample.time + speed.latestSample.time) / BigInt(2)) / 1e6;
    }

    /**
     * Age of last sample in milliseconds
     * Maximum is recordWindowSizeMs
     */
    getLatestSampleAgeMs() {
        const speed = this.peekSpeed(0);
        if(speed === undefined) {
            return this.recordWindowSizeMs;
        }

        const now = process.hrtime.bigint();
        return Number(now - speed.latestSample.time) / 1e6;
    }
}