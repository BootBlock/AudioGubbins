/**
 * A meter's readings over the blocks between two reports.
 *
 * A meter node measures every quantum, and the processor reports at a slower
 * rate, since a report is a message and a display redraws far less often. So
 * the report covers every block since the last, not the last alone: the peak
 * is the largest of the window, and the root mean square is over all its
 * frames, the squares summed in f64. A short transient between two reports is
 * seen rather than skipped.
 */

import type { MeterReading, MeterTarget } from '@audiogubbins/audio-engine';

/** What a report of the window says, per channel. */
export interface MeterReport {
  readonly peak: number[];
  readonly rms: number[];
}

/** The meter target that gathers a window of readings for one meter node. */
export class MeterWindow implements MeterTarget {
  readonly #peak: Float64Array;
  readonly #squares: Float64Array;
  #frames = 0;

  constructor(channels: number) {
    this.#peak = new Float64Array(channels);
    this.#squares = new Float64Array(channels);
  }

  receive(reading: MeterReading): void {
    for (let channel = 0; channel < this.#peak.length; channel += 1) {
      const peak = reading.peak[channel] ?? 0;
      const rms = reading.rms[channel] ?? 0;
      if (peak > (this.#peak[channel] ?? 0)) this.#peak[channel] = peak;
      this.#squares[channel] = (this.#squares[channel] ?? 0) + rms * rms * reading.frames;
    }
    this.#frames += reading.frames;
  }

  /**
   * The window's report, in arrays of its own for a message to carry, and a
   * new window begun; `undefined` for a window no block reached.
   */
  take(): MeterReport | undefined {
    if (this.#frames === 0) return undefined;
    const frames = this.#frames;
    const report = {
      peak: Array.from(this.#peak),
      rms: Array.from(this.#squares, (squares) => Math.sqrt(squares / frames)),
    };
    this.clear();
    return report;
  }

  /** Forgets the window, as a reset for a seek needs. */
  clear(): void {
    this.#peak.fill(0);
    this.#squares.fill(0);
    this.#frames = 0;
  }
}
