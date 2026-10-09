/**
 * The limiter's true-peak detector: the true peak of each frame as the
 * canonical peak meter reads it (`peak.rs`, ITU-R BS.1770-4 Annex 2), so the
 * ceiling the limiter keeps in dBTP is the one any meter here reads, by one
 * table of taps (`truePeakPhases`, the engine's).
 *
 * As input frame `n` arrives the meter writes, for each of its phases at the
 * rate, `Σ P[p][j] · x[n − j]` over the 12 frames to `n`, `j` from 0 in that
 * order: points between frames `n − 6` and `n − 5`. The detector answers for
 * frame `k = n − 6` the largest of its sample's magnitude, which a true peak
 * never falls under, and of those points, summed in the meter's order. So it
 * reads 6 frames past the frame, and a point depends on frames `k − 5` to
 * `k + 6`, the 6 each side of the frame over which the limiter keeps the gain
 * at or under the gain the point needs.
 *
 * That gain is not flat there: it may move by up to `r / (L + 1)` a frame, `r`
 * the gain the point needs and `L` the look-ahead (`limiter-gain.ts`), so by
 * `Δ = 11r / (L + 1)` from tap to tap. A point is `V = Σ c_j`, with
 * `c_j = P[p][j] · x[n − j]`, and with each `c_j` scaled by a gain between
 * `g − Δ` and `g ≤ r` it reaches at most `r·|V| + Δ·S`, where `S` sums the
 * `c_j` of the sign opposite to `V`'s. So a point reads as
 * `|V| + 11·S / (L + 1)`, and the gain `T` over that reading keeps it at or
 * under `T` however the gain moves; where every `c_j` has `V`'s sign the
 * reading is `|V|` exactly.
 *
 * The meter reads no points from 192 kHz, and at an oversampling of 1 the
 * detector reads none either: the limiter is then a sample-peak limiter. Any
 * oversampling above 1 reads the meter's points, since dBTP is what the meter
 * reads, and reading more points than it does would hold the output under a
 * peak no meter here reports.
 */

import { TRUE_PEAK_TAPS, truePeakPhases } from '@audiogubbins/audio-engine';

/** Frames past a frame the meter's points for it read, and that each side of it they depend on. */
const REACH = TRUE_PEAK_TAPS / 2;

/** The meter's phases the detector reads at `oversampling` and `rate`. */
function phasesOf(oversampling: number, rate: number): readonly (readonly number[])[] {
  return oversampling > 1 ? truePeakPhases(rate) : [];
}

/** Frames of input the detector reads past the frame it answers for, at `oversampling` and `rate`. */
export function detectionDelay(oversampling: number, rate: number): number {
  return phasesOf(oversampling, rate).length > 0 ? REACH : 0;
}

/**
 * Frames on each side of a frame whose gain a point the meter reads for it
 * depends on, at `oversampling` and `rate`.
 */
export function interpolationReach(oversampling: number, rate: number): number {
  return detectionDelay(oversampling, rate);
}

/** The fewest frames of history the detector reads. */
export const DETECTOR_HISTORY = TRUE_PEAK_TAPS;

/** The true peak over every channel of each frame of a block, read from their histories. */
export class TruePeakDetector {
  /** Every phase's taps, phase after phase, tap `j` for the frame `j` before the newest. */
  readonly #taps: Float64Array;
  readonly #phases: number;
  readonly #delay: number;
  /** `11 / (L + 1)`: the share of a point's opposed sum its reading adds. */
  readonly #spread: number;

  constructor(oversampling: number, rate: number, lookAheadFrames: number) {
    const phases = phasesOf(oversampling, rate);
    this.#taps = Float64Array.from(phases.flat());
    this.#phases = phases.length;
    this.#delay = detectionDelay(oversampling, rate);
    this.#spread = (TRUE_PEAK_TAPS - 1) / (lookAheadFrames + 1);
  }

  /**
   * Writes to `into[f]`, for each of the first `frames` frames of a block, the
   * largest magnitude over every channel of the frame `delay` before the one at
   * `first + f` in each history, a ring of `mask + 1` frames, and of the
   * readings of the meter's points for it. The channels are read in order.
   */
  peaks(
    histories: readonly Float32Array[],
    first: number,
    frames: number,
    mask: number,
    into: Float64Array,
  ): void {
    into.fill(0, 0, frames);
    for (const history of histories) this.#channelPeaks(history, first, frames, mask, into);
  }

  #channelPeaks(
    history: Float32Array,
    first: number,
    frames: number,
    mask: number,
    into: Float64Array,
  ): void {
    const taps = this.#taps;
    const size = mask + 1;
    for (let frame = 0; frame < frames; frame += 1) {
      const newest = first + frame + size;
      let largest = Math.max(
        into[frame] ?? 0,
        Math.abs(history[(newest - this.#delay) & mask] ?? 0),
      );
      for (let phase = 0; phase < this.#phases; phase += 1) {
        const start = phase * TRUE_PEAK_TAPS;
        let sum = 0;
        let rising = 0;
        let falling = 0;
        for (let tap = 0; tap < TRUE_PEAK_TAPS; tap += 1) {
          const term = (taps[start + tap] ?? 0) * (history[(newest - tap) & mask] ?? 0);
          sum += term;
          rising += term > 0 ? term : 0;
          falling += term < 0 ? -term : 0;
        }
        const opposed = sum < 0 ? rising : falling;
        largest = Math.max(largest, Math.abs(sum) + this.#spread * opposed);
      }
      into[frame] = largest;
    }
  }
}
