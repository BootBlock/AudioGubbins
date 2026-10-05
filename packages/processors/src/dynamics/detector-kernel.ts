/**
 * The kernel of a processor whose gain is a static curve of a detected level:
 * the compressor and the expander, which differ only in their curve and in
 * the parameters it reads.
 *
 * A block at a time, in this order: the parameters' ramps and the attack and
 * release coefficients over the block; every key channel's detector over the
 * block; the curve's gain for the linked level or for each key channel's own at
 * each frame; and every output channel, its input times the gain of its key
 * channel. Each stage runs its frames in order and keeps its state across
 * blocks, so the output does not depend on where a block ends. A change of 0 dB
 * is a gain of exactly 1, so a curve that does nothing passes its input through
 * bit for bit.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  channelAt,
  portAt,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { finiteSample } from '../framework/sample-safety.js';
import type { DetectorKey, LevelDetector, SmoothingTime } from './envelope.js';
import type { RampedParameters } from './ramped-parameters.js';

/**
 * A processor's static curve, a block at a time: the gain of each frame's
 * level, by its change in decibels at that frame's parameter values.
 */
export interface StaticCurve {
  gains(levels: Float64Array, into: Float64Array, frames: number): void;
}

/** What a detector kernel is made of. */
export interface DetectorKernelParts {
  readonly parameters: RampedParameters;
  readonly curve: StaticCurve;
  readonly key: DetectorKey;
  readonly detector: LevelDetector;
  readonly linked: boolean;
  /** The frame-by-frame attack and release times, in milliseconds. */
  readonly attack: Float64Array;
  readonly release: Float64Array;
  readonly attackTime: SmoothingTime;
  readonly releaseTime: SmoothingTime;
  readonly blockFrames: number;
}

/** A detector, a static curve and a gain per channel, run a block at a time. */
export class DetectorKernel implements NodeKernel {
  readonly #parts: DetectorKernelParts;
  readonly #attack: Float64Array;
  readonly #release: Float64Array;
  /** Each key channel's gain at each frame, or the linked gain in the first. */
  readonly #gains: readonly Float64Array[];

  constructor(parts: DetectorKernelParts) {
    this.#parts = parts;
    this.#attack = new Float64Array(parts.blockFrames);
    this.#release = new Float64Array(parts.blockFrames);
    this.#gains = Array.from(
      { length: parts.linked ? 1 : parts.key.channels },
      () => new Float64Array(parts.blockFrames),
    );
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const { parameters, key, detector, linked } = this.#parts;
    parameters.advance(frames);
    this.#parts.attackTime.fill(this.#parts.attack, this.#attack, frames);
    this.#parts.releaseTime.fill(this.#parts.release, this.#release, frames);
    detector.follow(key.block(inputs), frames, this.#attack, this.#release);
    const gains = this.#gains;
    for (let index = 0; index < gains.length; index += 1) {
      const levels = linked ? detector.linked : detector.levels[index];
      const into = gains[index];
      if (levels !== undefined && into !== undefined) this.#parts.curve.gains(levels, into, frames);
    }
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    for (let channel = 0; channel < output.channels.length; channel += 1) {
      const from = channelAt(input, channel);
      const to = channelAt(output, channel);
      const gain = gains[linked ? 0 : key.channelOf(channel)];
      if (gain === undefined) continue;
      for (let frame = 0; frame < frames; frame += 1) {
        to[frame] = finiteSample(from[frame] ?? 0) * (gain[frame] ?? 0);
      }
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#parts.parameters.set(name, value);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }
}
