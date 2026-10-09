/**
 * The limiter's kernel: one gain for every channel, made so it is at or under
 * the gain each peak needs by the time the peak is heard, and never above it.
 *
 * A block at a time, each stage over its frames in order, keeping its state
 * across blocks. The input is written into each channel's history. The
 * true-peak detector reads, for each frame, the peak `p` of the frame `d`
 * frames back (`true-peak.ts`), and the gain that frame needs is `r = T/p`
 * where `p` passes the detection target `T`, else 1. `T` is the ceiling times
 * `1 − 2⁻²⁰`, so neither the rounding of `T/p` and of the product, the store to
 * 32 bits, nor the meter's sums over the rounded output take a peak past the
 * ceiling. `r` is rounded down to a whole number of `2⁻³⁶`, so the sums below
 * are exact. A sliding minimum over the `L + 2R + 1` frames from `R` before to
 * `L + R` after the frame about to be written gives `m`. The release, a
 * one-pole smoother `q + a × (m − q)` taken only while `m` rises and rounded
 * down to a whole unit, makes `q ≤ m` of it. The mean of the last `L + 1`
 * values of `q` is the gain: it reaches each peak's gain as the peak arrives,
 * along a straight line from where it entered the look-ahead, and stays at or
 * under it over the `R` frames each side of it, which are all an interpolated
 * peak's output depends on. Every value it averages there is at most `r`, so
 * from one frame to the next it moves by at most `r / (L + 1)`, the bound the
 * detector allows for a gain that is not flat under a point. Over at most
 * `L + 1` of `2³⁶` the sum stays under `2⁵³`, so it never rounds. The output is
 * the input delayed by the latency, times the gain.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  channelAt,
  decibelsToGain,
  portAt,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import type { ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';
import { SmoothingTime } from './envelope.js';
import type { RampedParameters } from './ramped-parameters.js';
import { DETECTOR_HISTORY, TruePeakDetector, interpolationReach } from './true-peak.js';

/** `2³⁶`, the units a gain is counted in. */
const UNITS = 68_719_476_736;

/** `1 − 2⁻²⁰`, the margin under the ceiling that absorbs every rounding. */
const ROUNDING_MARGIN = 1 - 1 / 1_048_576;

/** What a limiter's kernel is made from, besides its parameters and its run. */
export interface LimiterSettings {
  readonly lookAheadFrames: number;
  readonly latencyFrames: number;
  /** The frame-by-frame ceiling, in dBTP, and release, in milliseconds. */
  readonly ceiling: Float64Array;
  readonly release: Float64Array;
}

/** Where each running value is kept, so no number lives in a field. */
const COUNT = 0;
const SUM = 1;
/** The least gain needed, released, in units. */
const RELEASED = 2;
const CEILING = 3;
const TARGET = 4;
/** The gain a frame needs, handed to the sliding minimum. */
const NEEDED = 5;

/** The smallest power of two of at least `frames`. */
function ringSize(frames: number): number {
  let size = 1;
  while (size < frames) size *= 2;
  return size;
}

/** The limiter, run a block at a time over every channel with one gain. */
export class LimiterKernel implements NodeKernel {
  readonly #parameters: RampedParameters;
  readonly #settings: LimiterSettings;
  readonly #detector: TruePeakDetector;
  readonly #releaseTime: SmoothingTime;
  /**
   * Each channel's input, in a ring long enough that a block written whole
   * overwrites nothing the block still reads: the latency, or the detector's
   * taps, and a block more.
   */
  readonly #histories: readonly Float32Array[];
  readonly #mask: number;
  /** The sliding minimum's candidates, oldest first, in a ring of the window's length. */
  readonly #windowFrames: Float64Array;
  readonly #windowGains: Float64Array;
  readonly #window: number;
  /** The last `L + 1` values of the minimum, in a ring. */
  readonly #recent: Float64Array;
  /** Each frame's peak, its release coefficient and its gain, over the block. */
  readonly #peaks: Float64Array;
  readonly #gains: Float64Array;
  readonly #releases: Float64Array;
  readonly #state = new Float64Array(6);
  #position = 0;
  #head = 0;
  #candidates = 0;
  #recentPosition = 0;

  constructor(parameters: RampedParameters, run: ProcessorRun, settings: LimiterSettings) {
    const oversampling = run.quality.oversampling;
    this.#parameters = parameters;
    this.#settings = settings;
    this.#detector = new TruePeakDetector(oversampling, run.sampleRate, settings.lookAheadFrames);
    this.#releaseTime = new SmoothingTime(run.sampleRate);
    const reach = Math.max(settings.latencyFrames + 1, DETECTOR_HISTORY);
    const size = ringSize(reach + run.blockFrames);
    this.#histories = run.input.roles.map(() => new Float32Array(size));
    this.#mask = size - 1;
    this.#window =
      settings.lookAheadFrames + 2 * interpolationReach(oversampling, run.sampleRate) + 1;
    this.#windowFrames = new Float64Array(this.#window);
    this.#windowGains = new Float64Array(this.#window);
    this.#recent = new Float64Array(settings.lookAheadFrames + 1).fill(UNITS);
    this.#peaks = new Float64Array(run.blockFrames);
    this.#gains = new Float64Array(run.blockFrames);
    this.#releases = new Float64Array(run.blockFrames);
    this.#state[SUM] = UNITS * (settings.lookAheadFrames + 1);
    this.#state[RELEASED] = UNITS;
    this.#state[CEILING] = Number.NaN;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    this.#parameters.advance(frames);
    this.#releaseTime.fill(this.#settings.release, this.#releases, frames);
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const histories = this.#histories;
    const mask = this.#mask;
    const first = this.#position;
    for (let channel = 0; channel < histories.length; channel += 1) {
      const from = channelAt(input, channel);
      const history = histories[channel];
      if (history === undefined) continue;
      for (let frame = 0; frame < frames; frame += 1) {
        history[(first + frame) & mask] = finiteSample(from[frame] ?? 0);
      }
    }
    this.#detector.peaks(histories, first, frames, mask, this.#peaks);
    for (let frame = 0; frame < frames; frame += 1) this.#gainAt(frame);
    const gains = this.#gains;
    const read = first - this.#settings.latencyFrames + mask + 1;
    for (let channel = 0; channel < histories.length; channel += 1) {
      const to = channelAt(output, channel);
      const history = histories[channel];
      if (history === undefined) continue;
      for (let frame = 0; frame < frames; frame += 1) {
        to[frame] = (history[(read + frame) & mask] ?? 0) * (gains[frame] ?? 0);
      }
    }
    this.#position = (first + frames) & mask;
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#parameters.set(name, value);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }

  /** Turns frame `frame`'s peak into the gain of the frame the latency behind it. */
  #gainAt(frame: number): void {
    const state = this.#state;
    const peak = this.#peaks[frame] ?? 0;
    this.#target(frame);
    const target = state[TARGET] ?? 0;
    state[NEEDED] = peak > target ? Math.floor((target / peak) * UNITS) : UNITS;
    this.#slidingMinimum();
    const least = this.#windowGains[this.#head] ?? UNITS;
    const previous = state[RELEASED] ?? UNITS;
    const coefficient = this.#releases[frame] ?? 0;
    // Released on every frame and then chosen, never in a branch: V8 inlines
    // no call that runs rarely, and a number crossing a call it has not
    // inlined is boxed. Rounded down to a whole unit, which is at least the
    // last and at most the least, so the sum stays exact.
    const released = Math.floor(least + coefficient * (previous - least));
    const held = least <= previous ? least : released;
    state[RELEASED] = held;
    const recent = this.#recent;
    const sum = (state[SUM] ?? 0) + held - (recent[this.#recentPosition] ?? 0);
    recent[this.#recentPosition] = held;
    this.#recentPosition =
      this.#recentPosition + 1 === recent.length ? 0 : this.#recentPosition + 1;
    state[SUM] = sum;
    this.#gains[frame] = sum / recent.length / UNITS;
  }

  /**
   * Adds the gain needed in the state to the last `window` gains needed, whose
   * least is then the candidate at the head of a ring of candidates each
   * smaller than every one after it: the oldest leaves once it is out of the
   * window, and a new gain drops every candidate it is not larger than. Given
   * through the state, as a number passed to a call each frame is boxed
   * wherever the call is not inlined.
   */
  #slidingMinimum(): void {
    const needed = this.#state[NEEDED] ?? 0;
    const window = this.#window;
    const frames = this.#windowFrames;
    const gains = this.#windowGains;
    const count = this.#state[COUNT] ?? 0;
    if (this.#candidates > 0 && (frames[this.#head] ?? 0) <= count - window) {
      this.#head = (this.#head + 1) % window;
      this.#candidates -= 1;
    }
    while (this.#candidates > 0) {
      const last = (this.#head + this.#candidates - 1) % window;
      if ((gains[last] ?? 0) < needed) break;
      this.#candidates -= 1;
    }
    const slot = (this.#head + this.#candidates) % window;
    frames[slot] = count;
    gains[slot] = needed;
    this.#candidates += 1;
    this.#state[COUNT] = count + 1;
  }

  /** The detection target of frame `frame`'s ceiling in dBTP, worked out again only when it moves. */
  #target(frame: number): void {
    const ceiling = this.#settings.ceiling[frame] ?? 0;
    const state = this.#state;
    if (ceiling !== state[CEILING]) {
      state[CEILING] = ceiling;
      this.#designTarget();
    }
  }

  /**
   * The detection target of the ceiling in the state. Out of line, as a moved
   * ceiling is too rare for V8 to inline a conversion called from there.
   */
  #designTarget(): void {
    const state = this.#state;
    state[TARGET] = decibelsToGain(state[CEILING] ?? 0) * ROUNDING_MARGIN;
  }
}
