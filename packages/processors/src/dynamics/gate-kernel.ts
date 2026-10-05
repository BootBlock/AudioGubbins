/**
 * The gate's kernel (`gate.ts` states the design), a block at a time in this
 * order: the parameters' ramps and the attack and release coefficients over
 * the block, the key over the block, the open or closed state with its hold
 * and the smoothed gain at each frame, and every channel times the gain.
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
import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';
import {
  DetectorKey,
  DetectorMode,
  LevelDetector,
  SmoothingTime,
  framesOf,
  smoothingCoefficient,
} from './envelope.js';
import type { RampedParameters } from './ramped-parameters.js';

/** How long the key takes to fall, in milliseconds: a period of 100 Hz. */
export const DETECTOR_RELEASE_MS = 10;

/** The gate's parameters' values over the block being processed. */
export interface GateFrames {
  readonly threshold: Float64Array;
  readonly hysteresis: Float64Array;
  readonly attack: Float64Array;
  readonly hold: Float64Array;
  readonly release: Float64Array;
  readonly range: Float64Array;
}

/** Where each running value is kept, so no number lives in a field. */
const GAIN = 0;
const HOLD_LEFT = 1;
const OPEN = 2;
const OPEN_LEVEL = 3;
const CLOSE_LEVEL = 4;
const FLOOR = 5;
const THRESHOLD = 6;
const HYSTERESIS = 7;
const RANGE = 8;

/** The gate, run a block at a time over every channel with one gain. */
export class GateKernel implements NodeKernel {
  readonly #parameters: RampedParameters;
  readonly #frames: GateFrames;
  readonly #key: DetectorKey;
  readonly #detector: LevelDetector;
  readonly #attackTime: SmoothingTime;
  readonly #releaseTime: SmoothingTime;
  readonly #sampleRate: ProcessorRun['sampleRate'];
  /** The key's coefficients: it follows a rise at once and falls by its own release. */
  readonly #keyAttack: Float64Array;
  readonly #keyRelease: Float64Array;
  readonly #attack: Float64Array;
  readonly #release: Float64Array;
  readonly #gains: Float64Array;
  readonly #state = new Float64Array(9).fill(Number.NaN);

  constructor(parameters: RampedParameters, run: ProcessorRun, frames: GateFrames) {
    this.#parameters = parameters;
    this.#frames = frames;
    this.#key = new DetectorKey({ input: run.input });
    this.#detector = new LevelDetector(this.#key.channels, DetectorMode.Peak, run.blockFrames);
    this.#attackTime = new SmoothingTime(run.sampleRate);
    this.#releaseTime = new SmoothingTime(run.sampleRate);
    this.#sampleRate = run.sampleRate;
    this.#keyAttack = new Float64Array(run.blockFrames);
    this.#keyRelease = new Float64Array(run.blockFrames).fill(DETECTOR_RELEASE_MS);
    smoothingCoefficient(this.#keyRelease, 0, run.sampleRate);
    this.#keyRelease.fill(this.#keyRelease[0] ?? 0);
    this.#attack = new Float64Array(run.blockFrames);
    this.#release = new Float64Array(run.blockFrames);
    this.#gains = new Float64Array(run.blockFrames);
    // It starts closed, at the floor of the range it was made with.
    this.#state[THRESHOLD] = run.parameters.number('threshold');
    this.#state[HYSTERESIS] = 0;
    this.#state[RANGE] = run.parameters.number('range');
    this.#designLevels();
    this.#designFloor();
    this.#state[GAIN] = this.#state[FLOOR] ?? 0;
    this.#state[HOLD_LEFT] = 0;
    this.#state[OPEN] = 0;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    this.#parameters.advance(frames);
    this.#attackTime.fill(this.#frames.attack, this.#attack, frames);
    this.#releaseTime.fill(this.#frames.release, this.#release, frames);
    this.#detector.follow(this.#key.block(inputs), frames, this.#keyAttack, this.#keyRelease);
    for (let frame = 0; frame < frames; frame += 1) this.#step(frame);
    const gains = this.#gains;
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    for (let channel = 0; channel < output.channels.length; channel += 1) {
      const from = channelAt(input, channel);
      const to = channelAt(output, channel);
      for (let frame = 0; frame < frames; frame += 1) {
        to[frame] = finiteSample(from[frame] ?? 0) * (gains[frame] ?? 0);
      }
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#parameters.set(name, value);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }

  /** Moves the state and the gain by frame `frame`, and writes the gain. */
  #step(frame: number): void {
    const values = this.#frames;
    const state = this.#state;
    const threshold = values.threshold[frame] ?? 0;
    const hysteresis = values.hysteresis[frame] ?? 0;
    const range = values.range[frame] ?? 0;
    if (threshold !== state[THRESHOLD] || hysteresis !== state[HYSTERESIS]) {
      state[THRESHOLD] = threshold;
      state[HYSTERESIS] = hysteresis;
      this.#designLevels();
    }
    if (range !== state[RANGE]) {
      state[RANGE] = range;
      this.#designFloor();
    }
    // Before the branch, not in it: V8 inlines no call that runs rarely, and
    // a number passed to a call it has not inlined is boxed.
    const hold = framesOf(values.hold[frame] ?? 0, this.#sampleRate);
    const level = this.#detector.linked[frame] ?? 0;
    const open = state[OPEN] === 1;
    if (level >= (state[OPEN_LEVEL] ?? 0) || (open && level >= (state[CLOSE_LEVEL] ?? 0))) {
      state[OPEN] = 1;
      state[HOLD_LEFT] = hold;
    } else if ((state[HOLD_LEFT] ?? 0) > 0) {
      state[HOLD_LEFT] = (state[HOLD_LEFT] ?? 0) - 1;
    } else {
      state[OPEN] = 0;
    }
    const target = state[OPEN] === 1 ? 1 : (state[FLOOR] ?? 0);
    const gain = state[GAIN] ?? 0;
    const coefficient = target > gain ? this.#attack[frame] : this.#release[frame];
    const next = target + flushSubnormal((coefficient ?? 0) * (gain - target));
    state[GAIN] = next;
    this.#gains[frame] = next;
  }

  /**
   * The open and close levels of the threshold and hysteresis in the state. The
   * step calls this and `#designFloor` only when their decibels move, too
   * rarely for V8 to inline a conversion called from there, so the conversions
   * are made here, where they run each time it does.
   */
  #designLevels(): void {
    const state = this.#state;
    const threshold = state[THRESHOLD] ?? 0;
    state[OPEN_LEVEL] = decibelsToGain(threshold);
    state[CLOSE_LEVEL] = decibelsToGain(threshold - (state[HYSTERESIS] ?? 0));
  }

  /** The floor of the range in the state: a gain of exactly 1 for no range. */
  #designFloor(): void {
    const state = this.#state;
    const range = state[RANGE] ?? 0;
    const floor = decibelsToGain(-range);
    state[FLOOR] = range === 0 ? 1 : floor;
  }
}
