/**
 * The level detector and the gain computers the dynamics processors share.
 *
 * A detector follows each channel of its key, the processor's own input or a
 * side-chain, with a one-pole smoother whose coefficient is `exp(−1/(t·fs))`
 * by the canonical exponential, so a step in level reaches 1 − 1/e of its
 * height in `t`. Attack applies while the level rises above the state and
 * release while it falls below it. A peak detector smooths the magnitude; an
 * RMS detector smooths the square and answers its square root, so its level
 * of a steady sine is the sine's RMS.
 *
 * Channels are linked by taking the largest detector level of all the key's
 * channels for every channel, so one gain moves the whole image and a loud
 * left channel cannot pull the centre towards the right.
 *
 * The gain computers work in decibels, by the canonical conversions, and
 * soften a knee of width W by the standard quadratic interpolation: within
 * W/2 of the threshold the curve is the parabola that meets both straight
 * segments with their slopes, so the gain has no corner (Giannoulis, Massberg
 * and Reiss, JAES 60(6), 2012).
 */

import {
  channelCount,
  type ChannelLayout,
  type ChoiceOption,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  channelAt,
  decibelsToGain,
  exp,
  gainToDecibels,
  portAt,
  type AudioFrameBlock,
} from '@audiogubbins/audio-engine';

import type { ProcessorRun } from '../framework/processor-type.js';
import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';

/** What a detector measures. */
export const DetectorMode = { Peak: 'peak', Rms: 'rms' } as const;

/** What a detector measures. */
export type DetectorMode = (typeof DetectorMode)[keyof typeof DetectorMode];

/** The detector modes as a choice parameter lists them. */
export const DETECTOR_OPTIONS: readonly [ChoiceOption, ...ChoiceOption[]] = [
  { key: DetectorMode.Peak, label: 'Peak' },
  { key: DetectorMode.Rms, label: 'RMS' },
];

/** The detector mode a choice's key names; any key but RMS's is peak. */
export function detectorModeOf(key: string): DetectorMode {
  return key === DetectorMode.Rms ? DetectorMode.Rms : DetectorMode.Peak;
}

/**
 * Below this level a detector reads `LEVEL_FLOOR_DECIBELS`, so silence has a
 * level in decibels: 10⁻¹⁰, exactly the gain of −200 dB.
 */
const LEVEL_FLOOR = 1e-10;
const LEVEL_FLOOR_DECIBELS = -200;

/**
 * Replaces the time constant in milliseconds at `values[at]` with its
 * one-pole coefficient: `exp(−(1000 ÷ (ms × fs)))`, and 0, an instant
 * follower, for no time. In place, as it is worked out frame by frame while a
 * time ramps, on the audio thread, where a coefficient returned from a call
 * would be boxed.
 */
export function smoothingCoefficient(
  values: Float64Array,
  at: number,
  sampleRate: SampleRate,
): void {
  const milliseconds = values[at] ?? 0;
  values[at] = milliseconds > 0 ? exp(-(1_000 / (milliseconds * sampleRate))) : 0;
}

/**
 * The whole frames nearest `milliseconds` at the rate, a half rounded up:
 * `floor((ms × fs) ÷ 1000 + 0.5)`.
 */
export function framesOf(milliseconds: number, sampleRate: SampleRate): number {
  return Math.floor((milliseconds * sampleRate) / 1_000 + 0.5);
}

/**
 * A time constant's coefficients over a block, worked out again only when its
 * time moves, so a steady parameter costs no exponential per frame. The
 * coefficient is a function of the time alone, so the cache changes no bit.
 */
export class SmoothingTime {
  readonly #sampleRate: SampleRate;
  /** The time last worked out, and its coefficient. */
  readonly #last = Float64Array.of(Number.NaN, 0);

  constructor(sampleRate: SampleRate) {
    this.#sampleRate = sampleRate;
  }

  /** Writes the coefficient of each of the first `frames` times in `milliseconds` to `into`. */
  fill(milliseconds: Float64Array, into: Float64Array, frames: number): void {
    const last = this.#last;
    for (let frame = 0; frame < frames; frame += 1) {
      const time = milliseconds[frame] ?? 0;
      if (time !== last[0]) {
        last[0] = time;
        last[1] = time;
        smoothingCoefficient(last, 1, this.#sampleRate);
      }
      into[frame] = last[1] ?? 0;
    }
  }
}

/*
 * The gain computers below work a block at a time, each frame's arithmetic
 * written out in its loop: a number handed back from a call per frame is a
 * heap allocation on the audio thread wherever the call is not inlined. A
 * conversion is made on every path and its answer then chosen, never called
 * in a branch, since V8 inlines no call that runs rarely.
 */

/** Writes each of the first `frames` levels in decibels to `into`, silence at the floor, not −∞. */
export function levelsInDecibels(levels: Float64Array, into: Float64Array, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    const level = levels[frame] ?? 0;
    const decibels = gainToDecibels(level);
    into[frame] = level > LEVEL_FLOOR ? decibels : LEVEL_FLOOR_DECIBELS;
  }
}

/** Each frame's values of a gain computer's parameters, over a block. */
export interface CurveFrames {
  readonly threshold: Float64Array;
  readonly ratio: Float64Array;
  readonly knee: Float64Array;
}

/**
 * Turns each of the first `frames` levels `x` in decibels in `levels` into a
 * compressor's change of gain in decibels, at most 0: 0 below the knee,
 * `(1/R − 1)(x − T)` above it, and within it `(1/R − 1)(x − T + W/2)² ÷ (2W)`.
 */
export function compressionDecibels(
  levels: Float64Array,
  curve: CurveFrames,
  frames: number,
): void {
  for (let frame = 0; frame < frames; frame += 1) {
    const over = (levels[frame] ?? 0) - (curve.threshold[frame] ?? 0);
    const knee = curve.knee[frame] ?? 0;
    const slope = 1 / (curve.ratio[frame] ?? 1) - 1;
    let change = 0;
    if (2 * over >= knee) change = slope * over;
    else if (2 * over > -knee) {
      const into = over + knee / 2;
      change = (slope * into * into) / (2 * knee);
    }
    levels[frame] = change;
  }
}

/**
 * Turns each of the first `frames` levels `x` in decibels in `levels` into a
 * downward expander's change of gain in decibels, at most 0 and at least
 * `−range`: 0 above the knee, `(R − 1)(x − T)` below it, and within it
 * `−(R − 1)(x − T − W/2)² ÷ (2W)`.
 */
export function expansionDecibels(
  levels: Float64Array,
  curve: CurveFrames & { readonly range: Float64Array },
  frames: number,
): void {
  for (let frame = 0; frame < frames; frame += 1) {
    const over = (levels[frame] ?? 0) - (curve.threshold[frame] ?? 0);
    const knee = curve.knee[frame] ?? 0;
    const slope = (curve.ratio[frame] ?? 1) - 1;
    let change = 0;
    if (2 * over <= -knee) change = slope * over;
    else if (2 * over < knee) {
      const from = over - knee / 2;
      change = -(slope * from * from) / (2 * knee);
    }
    const range = curve.range[frame] ?? 0;
    levels[frame] = change < -range ? -range : change;
  }
}

/** Turns each of the first `frames` changes in decibels into its gain, exactly 1 for none. */
export function gainsOfChanges(changes: Float64Array, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    const change = changes[frame] ?? 0;
    const gain = decibelsToGain(change);
    changes[frame] = change === 0 ? 1 : gain;
  }
}

/** Whether a side-chain of `sideChain` can key a processor of `input`: one channel, or as many. */
export function acceptsSideChain(input: ChannelLayout, sideChain: ChannelLayout): boolean {
  const keys = channelCount(sideChain);
  return keys === 1 || keys === channelCount(input);
}

/**
 * Where a detector's key is read: the side-chain where the node has one,
 * else the input. The engine gives a kernel its blocks in its step's port
 * order, and a processor node's step lists `input` first, so the side-chain
 * is the second block.
 */
export class DetectorKey {
  readonly channels: number;
  readonly #port: number;
  readonly #mono: boolean;

  constructor(run: Pick<ProcessorRun, 'input' | 'sideChain'>) {
    const key = run.sideChain ?? run.input;
    this.channels = channelCount(key);
    this.#port = run.sideChain === undefined ? 0 : 1;
    this.#mono = this.channels === 1;
  }

  block(inputs: readonly AudioFrameBlock[]): AudioFrameBlock {
    return portAt(inputs, this.#port);
  }

  /** The key channel that keys output channel `channel`: a one-channel key keys them all. */
  channelOf(channel: number): number {
    return this.#mono ? 0 : channel;
  }
}

/** A detector of every channel of a key, each with its own state. */
export class LevelDetector {
  readonly #rms: boolean;
  /** Each channel's smoothed magnitude, or its smoothed square for RMS. */
  readonly #state: Float64Array;
  /** Each key channel's level at each frame of the block last followed. */
  readonly levels: readonly Float64Array[];
  /** The largest of the channels' levels at each frame: the linked level. */
  readonly linked: Float64Array;

  constructor(channels: number, mode: DetectorMode, blockFrames: number) {
    this.#rms = mode === DetectorMode.Rms;
    this.#state = new Float64Array(channels);
    this.levels = Array.from({ length: channels }, () => new Float64Array(blockFrames));
    this.linked = new Float64Array(blockFrames);
  }

  /**
   * Follows the first `frames` frames of every channel of `key`, each frame
   * with its coefficients in `attack` and `release`, into `levels` and
   * `linked`. Each state moves as `x + a × (s − x)`, in that order.
   */
  follow(key: AudioFrameBlock, frames: number, attack: Float64Array, release: Float64Array): void {
    const state = this.#state;
    const linked = this.linked;
    linked.fill(0, 0, frames);
    for (let channel = 0; channel < state.length; channel += 1) {
      const samples = channelAt(key, channel);
      const levels = this.levels[channel];
      if (levels === undefined) continue;
      let current = state[channel] ?? 0;
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = finiteSample(samples[frame] ?? 0);
        const x = this.#rms ? sample * sample : Math.abs(sample);
        const coefficient = x > current ? (attack[frame] ?? 0) : (release[frame] ?? 0);
        current = flushSubnormal(x + coefficient * (current - x));
        const level = this.#rms ? Math.sqrt(current) : current;
        levels[frame] = level;
        if (level > (linked[frame] ?? 0)) linked[frame] = level;
      }
      state[channel] = current;
    }
  }
}

/**
 * Frames a detector's memory takes to fall to e⁻⁷ of a step, under 0.1 %,
 * at the longest of `milliseconds`: what a processor started part way
 * through a stream needs to have heard before its gain is its own.
 */
export function settlingFrames(sampleRate: SampleRate, ...milliseconds: number[]): number {
  const longest = Math.max(0, ...milliseconds);
  return Math.ceil((7 * longest * sampleRate) / 1_000);
}
