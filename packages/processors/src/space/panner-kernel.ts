/**
 * The spatial panner's kernel (`spatial-panner.ts`): the emitter's law
 * (`emitter-laws.ts`) worked out again every 32 frames (`DESIGN_INTERVAL`)
 * from the parameters' ramped values, counted from the kernel's first frame,
 * and each output's gain moved in a straight line from the last design's to
 * the new one's across the interval, so a moving emitter neither steps nor
 * clicks and the output is the same however the stream is cut into blocks.
 *
 * Each channel is filtered before its gain is applied, where Godot filters
 * after: the two differ only while the gain moves, and filtering the input
 * lets the shelf read it as it arrives. A mono input's one channel is heard
 * on both outputs; a stereo input's left is the left output's and its right
 * the right's, with no cross-feed, as Godot's mixer scales a stereo stream.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  channelAt,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { BiquadCascade } from '../filters/biquad.js';
import { DESIGN_INTERVAL, DesignClock } from '../filters/cascade-kernel.js';
import type { RampedParameter } from '../filters/ramped-parameter.js';
import {
  EMITTER_LAW_LENGTH,
  EmitterLaw,
  HIGHEST_CUTOFF_FRACTION,
  designDistanceShelf,
  emitterLaw,
  type Attenuation,
  type Space,
} from './emitter-laws.js';

/** What a refusal names a panner node. */
const TYPE = 'spatial panner';

/** What the kernel is made of. */
export interface PannerParts {
  readonly space: Space;
  readonly model: Attenuation;
  readonly rate: number;
  readonly channels: number;
  readonly ramps: readonly RampedParameter[];
  /** Where each ramp's value is held in the law, by the ramp's index. */
  readonly places: readonly number[];
  readonly cutoff: RampedParameter;
}

export class PannerKernel implements NodeKernel {
  readonly #parts: PannerParts;
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  readonly #clock = new DesignClock();
  readonly #law = new Float64Array(EMITTER_LAW_LENGTH);
  readonly #shelf: BiquadCascade;
  /**
   * The interval of the input's left channel through the shelf, before it is
   * scaled, and of its right: a mono input's one channel is both.
   */
  readonly #heardLeft = new Float64Array(DESIGN_INTERVAL);
  readonly #heardRight: Float64Array;
  /** The left and right gains the interval moves from, and to. */
  readonly #from = new Float64Array(2);
  readonly #to = new Float64Array(2);
  /** Frames of the current interval already written. */
  #into = 0;
  #designed = false;

  constructor(parts: PannerParts) {
    this.#parts = parts;
    this.#byKey = new Map(
      [...parts.ramps, parts.cutoff].map((ramp) => [ramp.descriptor.key, ramp] as const),
    );
    this.#shelf = new BiquadCascade(parts.channels, 1);
    this.#heardRight = parts.channels === 1 ? this.#heardLeft : new Float64Array(DESIGN_INTERVAL);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const { ramps, cutoff, channels } = this.#parts;
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const left = channelAt(output, 0);
    const right = channelAt(output, 1);
    for (const ramp of ramps) ramp.fill(frames);
    cutoff.fill(frames);
    const from = this.#from;
    const to = this.#to;
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#design(frame);
      const count = this.#clock.span(frames - frame);
      const heardLeft = this.#heardLeft;
      const heardRight = this.#heardRight;
      this.#shelf.run(0, channelAt(input, 0), frame, count, heardLeft, 0);
      if (channels === 2) this.#shelf.run(1, channelAt(input, 1), frame, count, heardRight, 0);
      const fromLeft = from[0] ?? 0;
      const fromRight = from[1] ?? 0;
      const stepLeft = (to[0] ?? 0) - fromLeft;
      const stepRight = (to[1] ?? 0) - fromRight;
      for (let at = 0; at < count; at += 1) {
        const along = this.#into + at + 1;
        left[frame + at] = (fromLeft + (stepLeft * along) / DESIGN_INTERVAL) * (heardLeft[at] ?? 0);
        right[frame + at] =
          (fromRight + (stepRight * along) / DESIGN_INTERVAL) * (heardRight[at] ?? 0);
      }
      this.#into += count;
      this.#clock.advance(count);
      frame += count;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    return ramp === undefined ? unknownParameter(TYPE, name) : ramp.set(TYPE, value);
  }

  release(): void {
    // A panner holds nothing outside the JavaScript heap.
  }

  /**
   * Starts an interval at `frame`: its gains move from where the last one
   * ended, to the law at the parameters' values at `frame` where any moved;
   * the first starts at its own law, so the output does not rise from silence.
   */
  #design(frame: number): void {
    const { ramps, places, cutoff, space: heardIn, model, rate } = this.#parts;
    const from = this.#from;
    const to = this.#to;
    from[0] = to[0] ?? 0;
    from[1] = to[1] ?? 0;
    this.#into = 0;
    const law = this.#law;
    let moved = cutoff.moved(frame);
    for (let index = 0; index < ramps.length; index += 1) {
      // Not `ramp?.`: the undefined it might give boxes the value read here.
      const ramp = ramps[index];
      if (ramp === undefined) continue;
      if (ramp.moved(frame)) moved = true;
      law[places[index] ?? 0] = ramp.values[frame] ?? 0;
    }
    if (!moved) return;
    emitterLaw(heardIn, model, law);
    to[0] = law[EmitterLaw.Left] ?? 0;
    to[1] = law[EmitterLaw.Right] ?? 0;
    // `cutoffTurns` written out: a double it returned would be boxed here.
    law[EmitterLaw.CutoffTurns] =
      Math.min(cutoff.values[frame] ?? 0, HIGHEST_CUTOFF_FRACTION * rate) / rate;
    designDistanceShelf(law, this.#shelf.coefficients, 0);
    if (this.#designed) return;
    this.#designed = true;
    from[0] = to[0];
    from[1] = to[1];
  }
}
