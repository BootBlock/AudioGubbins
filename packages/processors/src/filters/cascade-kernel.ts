/**
 * The kernel of a processor that is one cascade of sections run over every
 * channel alike, and the clock its sections are designed again by.
 *
 * A parameter moved while it plays ramps a frame at a time, but designing a
 * section costs a cosine, a sine and a power, so the sections are designed
 * again from the ramped values every {@link DESIGN_INTERVAL} frames and held
 * between. The interval is counted from the kernel's first frame, never from
 * a block's, so the frames a design is made at, and so the output, are the
 * same however the stream is cut into blocks.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  channelAt,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import type { BiquadCascade } from './biquad.js';
import type { RampedParameter } from './ramped-parameter.js';

/** Frames between the designs of a running filter: under a millisecond at 48 kHz. */
export const DESIGN_INTERVAL = 32;

/** Where a kernel is in the interval between designs, counted from its first frame. */
export class DesignClock {
  #phase = 0;

  /** Whether a design is due at the frame the clock has reached. */
  get due(): boolean {
    return this.#phase === 0;
  }

  /** The frames, of `remaining`, to run before the next design is due. */
  span(remaining: number): number {
    return Math.min(remaining, DESIGN_INTERVAL - this.#phase);
  }

  /** Moves the clock past `frames` frames. */
  advance(frames: number): void {
    this.#phase = (this.#phase + frames) % DESIGN_INTERVAL;
  }
}

/** What designs a cascade's sections from its parameters. */
export interface CascadeDesigner {
  /** The parameters that may move while it plays. */
  readonly ramps: readonly RampedParameter[];

  /**
   * Designs every section whose parameters moved since it was last designed,
   * from their values at `frame` of the block; the first call designs every
   * section.
   */
  design(cascade: BiquadCascade, frame: number): void;
}

/** A cascade over every channel of its input, designed by its designer as its parameters ramp. */
export class CascadeKernel implements NodeKernel {
  readonly #type: string;
  readonly #cascade: BiquadCascade;
  readonly #designer: CascadeDesigner;
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  readonly #clock = new DesignClock();
  /** One interval of a channel's output in f64, before it is stored as f32. */
  readonly #filtered = new Float64Array(DESIGN_INTERVAL);

  /** A kernel of `cascade`, which a refusal names as a `type` node. */
  constructor(type: string, cascade: BiquadCascade, designer: CascadeDesigner) {
    this.#type = type;
    this.#cascade = cascade;
    this.#designer = designer;
    this.#byKey = new Map(designer.ramps.map((ramp) => [ramp.descriptor.key, ramp]));
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    for (const ramp of this.#designer.ramps) ramp.fill(frames);
    const filtered = this.#filtered;
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#designer.design(this.#cascade, frame);
      const count = this.#clock.span(frames - frame);
      for (let channel = 0; channel < input.channels.length; channel += 1) {
        this.#cascade.run(channel, channelAt(input, channel), frame, count, filtered, 0);
        const to = channelAt(output, channel);
        for (let index = 0; index < count; index += 1) to[frame + index] = filtered[index] ?? 0;
      }
      this.#clock.advance(count);
      frame += count;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    if (ramp === undefined) return unknownParameter(this.#type, name);
    return ramp.set(this.#type, value);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }
}
