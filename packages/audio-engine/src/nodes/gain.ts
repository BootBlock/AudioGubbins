/**
 * Gain: every channel scaled by one linear factor, smoothed as it changes.
 *
 * The factor is linear, not in decibels, because a conversion from decibels
 * needs a power, which ADR-0032 keeps out of the canonical path; the person's
 * decibels are converted where they are edited. A change while running ramps
 * over {@link rampFrames} frames, so it is not heard as a click, and each
 * sample is one product in f64, stored once as f32, so a gain gives the same
 * bits however the stream is cut into blocks.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import { ParameterRamp, rampFrames } from '../execution/parameter-ramp.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { parameterValueInvalid, unknownParameter } from './node-parameters.js';
import type { NodeImplementation, NodeKernel } from './node-implementation.js';
import {
  accepted,
  kernelRefusal,
  onlyPort,
  plannedShape,
  problemsOf,
  refused,
  requireSameLayout,
  type NodeProblem,
  type NodeReading,
  type NodeShape,
} from './node-shape.js';
import { FINITE_NUMBER, optionalSetting, refuseOtherSettings } from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

/** The setting, and the parameter, that holds the factor. */
const GAIN = 'gain';

const TAKES: ReadonlySet<string> = new Set([GAIN]);

/** The factor of a node without a `gain` setting: unity, which changes nothing. */
const UNITY = 1;

/** The factor a gain node starts at, or every problem with the node. */
function readGain(shape: NodeShape): NodeReading<number> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (input !== undefined && output !== undefined) {
    requireSameLayout(shape, input, output, problems);
  }
  const gain = optionalSetting(shape, GAIN, FINITE_NUMBER, problems) ?? UNITY;
  return input === undefined || output === undefined || problems.length > 0
    ? refused(problems)
    : accepted(gain);
}

class GainKernel implements NodeKernel {
  readonly #ramp: ParameterRamp;

  /** The factor of each frame of a ramping block, so the ramp advances once per frame, not per channel. */
  readonly #factors: Float64Array;

  constructor(gain: number, rampLength: number, blockFrames: number) {
    this.#ramp = new ParameterRamp(gain, rampLength);
    this.#factors = new Float64Array(blockFrames);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    if (this.#ramp.steady) {
      const factor = this.#ramp.value;
      for (let channel = 0; channel < output.channels.length; channel += 1) {
        const from = channelAt(input, channel);
        const to = channelAt(output, channel);
        for (let frame = 0; frame < frames; frame += 1) to[frame] = (from[frame] ?? 0) * factor;
      }
      return;
    }
    const factors = this.#factors;
    for (let frame = 0; frame < frames; frame += 1) factors[frame] = this.#ramp.next();
    for (let channel = 0; channel < output.channels.length; channel += 1) {
      const from = channelAt(input, channel);
      const to = channelAt(output, channel);
      for (let frame = 0; frame < frames; frame += 1) {
        to[frame] = (from[frame] ?? 0) * (factors[frame] ?? 0);
      }
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    if (name !== GAIN) return unknownParameter(BuiltInNodeType.Gain, name);
    if (!Number.isFinite(value)) {
      return parameterValueInvalid(BuiltInNodeType.Gain, name, value, FINITE_NUMBER.describes);
    }
    this.#ramp.set(value);
    return succeed(undefined);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }
}

/** Every channel scaled by the `gain` setting, a linear factor that may change while running. */
export const GAIN_NODE: NodeImplementation = {
  type: BuiltInNodeType.Gain,
  role: NodeRole.Processor,
  check: (node) => problemsOf(readGain(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readGain(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    return succeed(
      new GainKernel(reading.value, rampFrames(context.sampleRate), context.blockFrames),
    );
  },
};
