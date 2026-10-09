/**
 * The input's levels in words, for a person who sets their gain by ear or
 * with a screen reader (`REQ-UX-005`).
 *
 * A meter changes thirty times a second, and a live region read at that rate
 * would say nothing usable. So the levels are summarised: on request, as they
 * stand and as they have peaked since last said; and once the input goes quiet
 * after a passage, the highest it reached in the passage, and whether it
 * clipped. A person plays a phrase, stops, and hears how loud it was.
 */

import type { InputMeterReport } from '@audiogubbins/audio-runtime';

import { peakText } from '../audio-format.js';

/** A peak at or below this is quiet: −50 dB, below a room's noise through most inputs. */
const QUIET_PEAK = 10 ** (-50 / 20);

/** How long the input must stay quiet before a passage is summarised. */
const QUIET_SECONDS = 1.5;

/** A peak at full scale is taken as clipped: the input could not give more. */
const CLIPPED_PEAK = 0.999;

/** The highest of a report's channels, or nothing for a report of none. */
function highest(peaks: readonly number[]): number {
  return peaks.reduce((most, peak) => Math.max(most, peak), 0);
}

/** What a peak was, in words: its level, and whether it clipped. */
function peakSaid(peak: number): string {
  return peak >= CLIPPED_PEAK ? `${peakText(peak)}, and clipped` : peakText(peak);
}

/** Holds the input's peaks between summaries. */
export class LevelSummary {
  /** The highest peak since the levels were last said. */
  #held = 0;
  /** Whether a passage louder than quiet has been heard since it was last summarised. */
  #passage = false;
  /** The context frame the input went quiet at, while it stays quiet after a passage. */
  #quietSince: number | undefined;
  #latest: InputMeterReport | undefined;

  /**
   * Takes a report of the levels at context frame `frame`, at `rate`, and
   * answers the passage's summary where the input has just gone quiet after
   * one.
   */
  heard(meter: InputMeterReport, frame: number, rate: number): string | undefined {
    this.#latest = meter;
    const peak = highest(meter.peak);
    this.#held = Math.max(this.#held, peak);
    if (peak > QUIET_PEAK) {
      this.#passage = true;
      this.#quietSince = undefined;
      return undefined;
    }
    if (!this.#passage) return undefined;
    this.#quietSince ??= frame;
    if (frame - this.#quietSince < QUIET_SECONDS * rate) return undefined;
    const said = `The input peaked at ${peakSaid(this.#held)}.`;
    this.#reset();
    return said;
  }

  /** The levels now and the peak since they were last said, which saying them starts again from. */
  say(): string {
    const latest = this.#latest;
    if (latest === undefined) return 'No levels have arrived from the input yet.';
    const now = latest.peak.map((peak, channel) =>
      latest.peak.length === 1
        ? peakText(peak)
        : `channel ${String(channel + 1)} ${peakText(peak)}`,
    );
    const said = `The input is at ${now.join(', ')}; it peaked at ${peakSaid(this.#held)}.`;
    this.#reset();
    return said;
  }

  #reset(): void {
    this.#held = 0;
    this.#passage = false;
    this.#quietSince = undefined;
  }
}
