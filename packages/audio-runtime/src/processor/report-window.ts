/**
 * What the processor gathers between two reports, and when one is due.
 *
 * A starved feed underruns every quantum, 375 times a second at 48 kHz, and a
 * meter measures every quantum too; a message for each would be an allocation
 * on the audio thread and a task on the main thread every time. So they are
 * gathered here, the underruns summed and the meters in their windows
 * (`meter-window.ts`), and sent in one report every so many quanta, the rate
 * the load asked for, with the count of where playback is.
 */

import type { MeterReport } from '../protocol/processor-messages.js';
import type { WatchedMeter } from './loaded-graph.js';

/** The underruns since the last report, and when the next is due. */
export class ReportWindow {
  #quanta = 0;
  #underrunFrames = 0;
  #underruns = 0;

  /** Counts a quantum that ran short, `frames` frames of silence. */
  underran(frames: number): void {
    this.#underrunFrames += frames;
    this.#underruns += 1;
  }

  /** Counts a quantum, and answers whether a report is due at one every `every`; never at zero. */
  due(every: number): boolean {
    if (every === 0) return false;
    this.#quanta += 1;
    if (this.#quanta < every) return false;
    this.#quanta = 0;
    return true;
  }

  /**
   * The underruns since the last report, and every meter's window that a
   * block reached, and a new window begun for each.
   */
  take(meters: readonly WatchedMeter[]): {
    readonly underrunFrames: number;
    readonly underruns: number;
    readonly meters: readonly MeterReport[];
  } {
    const reports: MeterReport[] = [];
    for (const meter of meters) {
      const report = meter.window.take();
      if (report !== undefined) reports.push({ node: meter.node, ...report });
    }
    const taken = {
      underrunFrames: this.#underrunFrames,
      underruns: this.#underruns,
      meters: reports,
    };
    this.#underrunFrames = 0;
    this.#underruns = 0;
    return taken;
  }

  /** Forgets everything gathered, and starts the count to the next report again. */
  clear(meters: readonly WatchedMeter[]): void {
    this.#quanta = 0;
    this.#underrunFrames = 0;
    this.#underruns = 0;
    for (const meter of meters) meter.window.clear();
  }
}
