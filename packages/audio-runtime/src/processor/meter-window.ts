/**
 * A meter's readings over the blocks between two reports.
 *
 * A meter node measures every quantum, and the processor reports at a slower
 * rate, since a report is a message and a display redraws far less often. So
 * the report covers every block since the last, not the last alone: the peak
 * is the largest of the window, and the root mean square is over all its
 * frames, the squares summed in f64. A short transient between two reports is
 * seen rather than skipped.
 *
 * The correlation of each pair the meter names is the mean of its blocks'
 * readings, each weighted by its frames. The kernel reports a block's
 * correlation and not the sums it was found from, so the window's is an
 * average of the blocks' rather than one taken over all its frames at once:
 * what a correlation meter shows, a steady reading of how the pair has moved
 * together lately, which is all a display needs.
 */

import type { MeterReading, MeterTarget } from '@audiogubbins/audio-engine';

/** What a report of the window says: one value per channel, and one per pair correlated. */
export interface WindowReport {
  readonly peak: number[];
  readonly rms: number[];
  readonly correlation: number[];
}

/** The meter target that gathers a window of readings for one meter node. */
export class MeterWindow implements MeterTarget {
  readonly #peak: Float64Array;
  readonly #squares: Float64Array;
  /** Each pair's correlation times its block's frames, summed. */
  readonly #correlation: Float64Array;
  #frames = 0;

  constructor(channels: number, pairs: number) {
    this.#peak = new Float64Array(channels);
    this.#squares = new Float64Array(channels);
    this.#correlation = new Float64Array(pairs);
  }

  receive(reading: MeterReading): void {
    for (let channel = 0; channel < this.#peak.length; channel += 1) {
      const peak = reading.peak[channel] ?? 0;
      const rms = reading.rms[channel] ?? 0;
      if (peak > (this.#peak[channel] ?? 0)) this.#peak[channel] = peak;
      this.#squares[channel] = (this.#squares[channel] ?? 0) + rms * rms * reading.frames;
    }
    for (let pair = 0; pair < this.#correlation.length; pair += 1) {
      this.#correlation[pair] =
        (this.#correlation[pair] ?? 0) + (reading.correlation[pair] ?? 0) * reading.frames;
    }
    this.#frames += reading.frames;
  }

  /**
   * The window's report, in arrays of its own for a message to carry, and a
   * new window begun; `undefined` for a window no block reached.
   */
  take(): WindowReport | undefined {
    if (this.#frames === 0) return undefined;
    const frames = this.#frames;
    const report = {
      peak: Array.from(this.#peak),
      rms: Array.from(this.#squares, (squares) => Math.sqrt(squares / frames)),
      correlation: Array.from(this.#correlation, (sum) => sum / frames),
    };
    this.clear();
    return report;
  }

  /** Forgets the window, as a fresh start needs. */
  clear(): void {
    this.#peak.fill(0);
    this.#squares.fill(0);
    this.#correlation.fill(0);
    this.#frames = 0;
  }
}
