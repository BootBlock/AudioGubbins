/**
 * The numeric parameters of a dynamics kernel that a person may move while it
 * plays, each ramping by the engine's `ParameterRamp` so a move is heard
 * without a click.
 *
 * A kernel reads each one a block at a time, as the frame-by-frame values of
 * its ramp, so the value at a frame is a function of the frames since the
 * move alone and a stream gives the same bits however it is cut into blocks.
 * A value is checked against its descriptor before the ramp moves, as the
 * node's own settings were; a choice or a toggle changes what the kernel is
 * and is never one of these.
 */

import {
  succeed,
  validateParameterValue,
  type DomainResult,
  type NumericParameterDescriptor,
  type ParameterValues,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  ParameterRamp,
  parameterValueInvalid,
  rampFrames,
  unknownParameter,
} from '@audiogubbins/audio-engine';

import type { ParameterReader } from '../framework/processor-type.js';

interface Ramped {
  readonly descriptor: NumericParameterDescriptor;
  readonly ramp: ParameterRamp;
  readonly frames: Float64Array;
}

/** A kernel's moving parameters by key, and each one's values over the block being processed. */
export class RampedParameters {
  readonly #type: string;
  readonly #ramped: ReadonlyMap<string, Ramped>;
  /** The same entries as a list, for advancing them in order. */
  readonly #list: readonly Ramped[];

  constructor(
    type: string,
    descriptors: readonly NumericParameterDescriptor[],
    parameters: ParameterReader,
    run: { readonly sampleRate: SampleRate; readonly blockFrames: number },
  ) {
    this.#type = type;
    const length = rampFrames(run.sampleRate);
    this.#list = descriptors.map((descriptor) => ({
      descriptor,
      ramp: new ParameterRamp(parameters.number(descriptor.key), length),
      frames: new Float64Array(run.blockFrames),
    }));
    this.#ramped = new Map(this.#list.map((entry) => [entry.descriptor.key, entry]));
  }

  /** The values of parameter `key` over the block, which `advance` fills. */
  frames(key: string): Float64Array {
    const entry = this.#ramped.get(key);
    if (entry === undefined) throw new Error(`A ${this.#type} has no moving parameter "${key}".`);
    return entry.frames;
  }

  /** Fills every parameter's values for the next `frames` frames. */
  advance(frames: number): void {
    for (const entry of this.#list) entry.ramp.fill(entry.frames, frames);
  }

  /** Ramps parameter `name` to `value`, or says why it cannot. */
  set(name: string, value: number): DomainResult<void> {
    const entry = this.#ramped.get(name);
    if (entry === undefined) return unknownParameter(this.#type, name);
    const { descriptor } = entry;
    if (!validateParameterValue(descriptor, value).ok) {
      const range = `a number from ${String(descriptor.minimum)} to ${String(descriptor.maximum)}`;
      return parameterValueInvalid(this.#type, name, value, range);
    }
    entry.ramp.set(value);
    return succeed(undefined);
  }
}

/** The value an instance holds for a numeric parameter, or its default where it holds none. */
export function numberIn(values: ParameterValues, parameter: NumericParameterDescriptor): number {
  const value = values.get(parameter.id);
  return typeof value === 'number' ? value : parameter.defaultValue;
}
