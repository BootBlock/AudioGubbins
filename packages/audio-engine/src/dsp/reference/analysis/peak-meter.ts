/**
 * Sample peak and true peak per channel, as `peak.rs` measures them: the
 * interpolating filter of ITU-R BS.1770-4 Annex 2, four phases of 12 taps,
 * each phase's output `Σ P[p][j] · x[n − j]` for `j` from 0 to 11, all four
 * below 96 kHz, phases 0 and 2 from 96 kHz, none from 192 kHz, and a reading
 * including the filter's tail, its true peak never under its sample peak.
 */

import { gainToDecibels } from '../decibels.js';

/** The taps of each phase. */
export const TRUE_PEAK_TAPS = 12;
const TAPS = TRUE_PEAK_TAPS;

/** ITU-R BS.1770-4 (10/2015), Annex 2, Table 1, as four phases; see `PHASES` in `peak.rs`. */
const PHASES: readonly (readonly number[])[] = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875,
    0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125,
    0.014892578125, -0.00830078125,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
    0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625,
    0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875,
    0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125,
    0.001708984375,
  ],
];

/**
 * The phases the true peak is read with at `rate`: all four below 96 kHz, two
 * below 192 kHz, and none from there. Phase `p`'s tap `j` multiplies the
 * input `j` frames before the newest, so the 48 taps, symmetric about 23.5,
 * put phase `p`'s point `5.875 − p/4` frames before it. The one table of
 * dBTP, which the limiter detects with too.
 */
export function truePeakPhases(rate: number): readonly (readonly number[])[] {
  if (rate < 96_000) return PHASES;
  if (rate < 192_000) return [PHASES[0] ?? [], PHASES[2] ?? []];
  return [];
}

/**
 * Moves `value` into `history`, newest first, and answers `peak` or the largest
 * magnitude any of `phases` writes for it, whichever is larger; `step`.
 */
function step(
  history: Float64Array,
  value: number,
  phases: readonly (readonly number[])[],
  peak: number,
): number {
  history.copyWithin(1, 0, TAPS - 1);
  history[0] = value;
  let largest = peak;
  for (const taps of phases) {
    let sum = 0;
    for (let tap = 0; tap < TAPS; tap += 1) sum += (taps[tap] ?? 0) * (history[tap] ?? 0);
    const magnitude = Math.abs(sum);
    if (magnitude > largest) largest = magnitude;
  }
  return largest;
}

/** The peaks of each channel of a stream, its settings already checked. */
export class ReferencePeakMeter {
  readonly channels: number;
  readonly #phases: readonly (readonly number[])[];
  readonly #history: Float64Array[];
  readonly #samplePeaks: Float64Array;
  readonly #truePeaks: Float64Array;
  readonly #drained = new Float64Array(TAPS);

  constructor(channels: number, sampleRate: number) {
    this.channels = channels;
    this.#phases = truePeakPhases(sampleRate);
    this.#history = Array.from({ length: channels }, () => new Float64Array(TAPS));
    this.#samplePeaks = new Float64Array(channels);
    this.#truePeaks = new Float64Array(channels);
  }

  /** Measures one chunk, one array per channel, its shape checked by the port. */
  push(input: readonly Float32Array[]): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      const samples = input[channel];
      const history = this.#history[channel];
      if (samples === undefined || history === undefined) continue;
      let samplePeak = this.#samplePeaks[channel] ?? 0;
      let truePeak = this.#truePeaks[channel] ?? 0;
      // eslint-disable-next-line @typescript-eslint/prefer-for-of -- a for-of here measured an allocation a sample on the reference path's allocation test
      for (let index = 0; index < samples.length; index += 1) {
        const value = samples[index] ?? 0;
        const magnitude = Math.abs(value);
        if (magnitude > samplePeak) samplePeak = magnitude;
        truePeak = step(history, value, this.#phases, truePeak);
      }
      this.#samplePeaks[channel] = samplePeak;
      this.#truePeaks[channel] = truePeak;
    }
  }

  /** Writes four values a channel, the tail drained on a copy; `reading` in `peak.rs`. */
  read(into: Float64Array): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      const samplePeak = this.#samplePeaks[channel] ?? 0;
      this.#drained.set(this.#history[channel] ?? this.#drained);
      let truePeak = this.#truePeaks[channel] ?? 0;
      for (let count = 1; count < TAPS; count += 1) {
        truePeak = step(this.#drained, 0, this.#phases, truePeak);
      }
      truePeak = Math.max(truePeak, samplePeak);
      into[4 * channel] = samplePeak;
      into[4 * channel + 1] = gainToDecibels(samplePeak);
      into[4 * channel + 2] = truePeak;
      into[4 * channel + 3] = gainToDecibels(truePeak);
    }
  }
}
