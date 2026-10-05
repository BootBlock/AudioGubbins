/**
 * A numeric parameter a person may move while it plays, as a kernel holds it:
 * the engine's ramp, so a move is heard over a short ramp rather than in one
 * step, the value of each frame of the block being processed, and the value a
 * design last took from it, so a design is made again only when it moved.
 */

import {
  succeed,
  type DomainResult,
  type NumericParameterDescriptor,
  type SampleRate,
} from '@audiogubbins/domain';
import { ParameterRamp, parameterValueInvalid, rampFrames } from '@audiogubbins/audio-engine';

export class RampedParameter {
  readonly descriptor: NumericParameterDescriptor;
  readonly #ramp: ParameterRamp;
  /**
   * The value of each frame of the block being processed, which a kernel
   * reads in place rather than through a call: a number a call returns is
   * boxed wherever the call is not inlined, and V8 inlines no call that runs
   * rarely, as a design made only when a parameter moves does.
   */
  readonly values: Float64Array;
  /** The value a design last took, NaN before the first, which no value equals. */
  #taken = Number.NaN;

  constructor(
    descriptor: NumericParameterDescriptor,
    initial: number,
    sampleRate: SampleRate,
    blockFrames: number,
  ) {
    this.descriptor = descriptor;
    this.#ramp = new ParameterRamp(initial, rampFrames(sampleRate));
    this.values = new Float64Array(blockFrames);
  }

  /** Ramps to `value`, or refuses one outside the parameter's range, naming `type`. */
  set(type: string, value: number): DomainResult<void> {
    const { key, minimum, maximum } = this.descriptor;
    if (!(value >= minimum && value <= maximum)) {
      const range = `a number from ${String(minimum)} to ${String(maximum)}`;
      return parameterValueInvalid(type, key, value, range);
    }
    this.#ramp.set(value);
    return succeed(undefined);
  }

  /** Takes the value of each of the block's `frames` frames from the ramp. */
  fill(frames: number): void {
    this.#ramp.fill(this.values, frames);
  }

  /** Whether the value at `frame` differs from the one a design last took, which it takes. */
  moved(frame: number): boolean {
    const value = this.values[frame] ?? 0;
    if (value === this.#taken) return false;
    this.#taken = value;
    return true;
  }
}
