/**
 * The limiter's true-peak detector: the largest magnitude of a frame and of
 * the waveform between it and the frame before, read at `M` times the rate.
 *
 * The points between frames come from a polyphase interpolator: one windowed
 * sinc, cut off at the input's Nyquist frequency and windowed by Kaiser's
 * window, sampled at the `M − 1` fractions `k/M` of a frame. The cut-off is
 * exactly at Nyquist, so the sinc is zero at every other whole frame and the
 * frame itself is read as it is, which keeps every sample peak exact. The
 * design is a stated set: a passband to 0.95 of Nyquist and a stopband from
 * 1.05, symmetric about it, with 60 dB of attenuation, so by Kaiser's formulas
 * a half width of `(A − 7.95) ÷ (4.57π · 0.1)` frames, 36.25, and
 * `β = 0.1102 (A − 8.7)`. Each phase's taps are scaled to sum to one, so a
 * steady level reads as itself. The window's Bessel function is the fixed
 * series ADR-0032 names, the engine's own.
 *
 * Every tap is a sample of one function of the time between a point and a
 * frame, so the taps do not depend on the rate and are made once, here.
 */

import { besselI0, cosineOfTurns, decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';

const PASSBAND_EDGE = 0.95;
const DESIGN_ATTENUATION = 60;
const TRANSITION = 2 * (1 - PASSBAND_EDGE);
const HALF_WIDTH = (DESIGN_ATTENUATION - 7.95) / (4.57 * Math.PI * TRANSITION);
const BETA = 0.1102 * (DESIGN_ATTENUATION - 8.7);

/** Whole frames the taps reach on each side of a point between two frames. */
const REACH = Math.ceil(HALF_WIDTH);

/** Taps of one phase: the frames from `REACH` before a point's interval to `REACH − 1` after it. */
const TAPS = 2 * REACH;

const BESSEL_OF_BETA = besselI0(BETA);

/** The interpolator at `t` frames from a point: `sin(πt)/(πt) · w(t / half width)`. */
function tap(t: number): number {
  const position = t / HALF_WIDTH;
  const inside = 1 - position * position;
  if (inside <= 0) return 0;
  const sinc = t === 0 ? 1 : sineOfTurns(t / 2) / (Math.PI * t);
  return (sinc * besselI0(BETA * Math.sqrt(inside))) / BESSEL_OF_BETA;
}

/**
 * The taps of every phase `k` from 1 to `M − 1`, phase after phase, each over
 * the frames `i − REACH` to `i + REACH − 1` for the point `i − 1 + k/M`, and
 * each scaled to sum to one.
 */
function phaseTaps(oversampling: number): Float64Array {
  const taps = new Float64Array((oversampling - 1) * TAPS);
  for (let phase = 1; phase < oversampling; phase += 1) {
    const start = (phase - 1) * TAPS;
    let sum = 0;
    for (let index = 0; index < TAPS; index += 1) {
      const value = tap(REACH - 1 - index + phase / oversampling);
      taps[start + index] = value;
      sum += value;
    }
    for (let index = 0; index < TAPS; index += 1) {
      taps[start + index] = (taps[start + index] ?? 0) / sum;
    }
  }
  return taps;
}

/** Every oversampling a quality setting offers above 1, with its taps. */
const TAPS_BY_FACTOR: ReadonlyMap<number, Float64Array> = new Map(
  [2, 4, 8].map((factor) => [factor, phaseTaps(factor)]),
);

/**
 * How far the detection target sits under the ceiling, as a factor, for the
 * waveform between the points read. A signal band-limited to σ = 2π · 0.95 ·
 * fs/2 and peaking at P is at least `P cos(σΔ)` a time Δ from its peak
 * (Szegő's inequality), and a point is read within half a point's spacing of
 * it, so from 4 times the rate, where that costs 0.63 dB, the target is the
 * ceiling times `cos(0.95π ÷ 2M)` and less the passband's ripple, 60 dB down:
 * then no peak of what the passband holds passes the ceiling between the
 * points. Below 4 times it would cost 2.7 dB or more, so there the points read
 * are what is held, and a single rate is a sample-peak limiter.
 */
export function truePeakAllowance(oversampling: number): number {
  if (oversampling < 4) return 1;
  const spacing = cosineOfTurns(PASSBAND_EDGE / (4 * oversampling));
  return spacing * (1 - decibelsToGain(-DESIGN_ATTENUATION));
}

/** Frames of input the detector reads past the frame it answers for, at `oversampling`. */
export function detectionDelay(oversampling: number): number {
  return oversampling > 1 ? REACH - 1 : 0;
}

/** Frames on each side of a frame whose gain a peak between frames depends on, at `oversampling`. */
export function interpolationReach(oversampling: number): number {
  return oversampling > 1 ? REACH : 0;
}

/** The fewest frames of history the detector reads. */
export const DETECTOR_HISTORY = TAPS;

/** The true peak over every channel of each frame of a block, read from their histories. */
export class TruePeakDetector {
  readonly #taps: Float64Array;
  readonly #phases: number;
  readonly #delay: number;

  constructor(oversampling: number) {
    this.#taps = TAPS_BY_FACTOR.get(oversampling) ?? new Float64Array(0);
    this.#phases = oversampling - 1;
    this.#delay = detectionDelay(oversampling);
  }

  /**
   * Writes to `into[f]`, for each of the first `frames` frames of a block, the
   * largest magnitude over every channel of the frame `delay` before the one at
   * `first + f` in each history, a ring of `mask + 1` frames, and of the points
   * between it and the frame before. Each point sums its taps from the earliest
   * frame on; the channels are read in order.
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
      const newest = first + frame;
      let largest = Math.max(
        into[frame] ?? 0,
        Math.abs(history[(newest - this.#delay + size) & mask] ?? 0),
      );
      const earliest = newest - (TAPS - 1) + size;
      for (let phase = 0; phase < this.#phases; phase += 1) {
        const start = phase * TAPS;
        let sum = 0;
        for (let index = 0; index < TAPS; index += 1) {
          sum += (taps[start + index] ?? 0) * (history[(earliest + index) & mask] ?? 0);
        }
        largest = Math.max(largest, Math.abs(sum));
      }
      into[frame] = largest;
    }
  }
}
