/**
 * Mix: several inputs of one layout summed into one output, each scaled.
 *
 * Where parallel paths meet: a wet/dry blend, a bus, the return of a send
 * (REQ-ARCH-140). Every input has the output's layout, because a sum of
 * channels that mean different things is a hidden up- or down-mix
 * (REQ-ARCH-157); a matrix or channel map converts one first. Each output
 * sample is summed in f64 from zero, input by input in port order, and stored
 * once as f32 (ADR-0032), so a mix does not lose the small inputs that summing
 * in f32 a step at a time would round away.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { unknownParameter } from './node-parameters.js';
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
import { finiteNumbers, optionalSetting, refuseOtherSettings } from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const GAINS = 'gains';

const TAKES: ReadonlySet<string> = new Set([GAINS]);

/** The factor of each input, in port order, or every problem with the node. */
function readMix(shape: NodeShape): NodeReading<readonly number[]> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (output !== undefined) {
    for (const input of shape.inputs) requireSameLayout(shape, input, output, problems);
  }
  const count = shape.inputs.length;
  const gains =
    optionalSetting(shape, GAINS, finiteNumbers(count, 'input, in port order'), problems) ??
    shape.inputs.map(() => 1);
  return output === undefined || count === 0 || problems.length > 0
    ? refused(problems)
    : accepted(gains);
}

class MixKernel implements NodeKernel {
  readonly #gains: Float64Array;

  /** One channel of each input, gathered per channel so the inner loop indexes arrays only. */
  readonly #sources: Float32Array[];

  constructor(gains: readonly number[]) {
    this.#gains = Float64Array.from(gains);
    this.#sources = gains.map(() => new Float32Array(0));
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const output = portAt(outputs, 0);
    const gains = this.#gains;
    const sources = this.#sources;
    for (let channel = 0; channel < output.channels.length; channel += 1) {
      for (let input = 0; input < sources.length; input += 1) {
        sources[input] = channelAt(portAt(inputs, input), channel);
      }
      const to = channelAt(output, channel);
      for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        for (let input = 0; input < sources.length; input += 1) {
          sum += (sources[input]?.[frame] ?? 0) * (gains[input] ?? 0);
        }
        to[frame] = sum;
      }
    }
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.Mix, name);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }
}

/** Every input summed into one output of the same layout, each scaled by its entry in `gains`. */
export const MIX_NODE: NodeImplementation = {
  type: BuiltInNodeType.Mix,
  role: NodeRole.Processor,
  check: (node) => problemsOf(readMix(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step) => {
    const shape = plannedShape(step);
    const reading = readMix(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    return succeed(new MixKernel(reading.value));
  },
};
