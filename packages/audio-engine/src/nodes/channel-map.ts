/**
 * Channel map: each output channel a copy of one input channel.
 *
 * Remapping, reordering, extracting fewer channels and duplicating one are all
 * the same node: the `map` setting names, for each output channel in order,
 * the input channel it copies. What each channel means is carried by the two
 * port layouts, which the person chose, and nothing here guesses it from a
 * position (REQ-ARCH-157, ADR-0033). A copy changes no sample, so a map is
 * exact.
 */

import { channelCount, succeed, type DomainResult } from '@audiogubbins/domain';
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
  type NodeProblem,
  type NodeReading,
  type NodeShape,
} from './node-shape.js';
import { refuseOtherSettings, requiredSetting, type SettingRule } from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const MAP = 'map';

const TAKES: ReadonlySet<string> = new Set([MAP]);

/** A list of `length` channel indices, each below `inputs`. */
function channelIndices(length: number, inputs: number): SettingRule<readonly number[]> {
  return {
    describes: `a list of ${String(length)} input channel indices, one for each output channel, each a whole number from 0 to ${String(inputs - 1)}`,
    read: (value) =>
      typeof value === 'object' &&
      value.length === length &&
      value.every((index) => Number.isInteger(index) && index >= 0 && index < inputs)
        ? value
        : undefined,
  };
}

/** The input channel each output channel copies, or every problem with the node. */
function readChannelMap(shape: NodeShape): NodeReading<readonly number[]> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (input === undefined || output === undefined) return refused(problems);
  const rule = channelIndices(channelCount(output.layout), channelCount(input.layout));
  const map = requiredSetting(shape, MAP, rule, problems);
  return map === undefined || problems.length > 0 ? refused(problems) : accepted(map);
}

class ChannelMapKernel implements NodeKernel {
  readonly #map: Int32Array;

  constructor(map: readonly number[]) {
    this.#map = Int32Array.from(map);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const map = this.#map;
    for (let channel = 0; channel < map.length; channel += 1) {
      const from = channelAt(input, map[channel] ?? 0);
      const to = channelAt(output, channel);
      for (let frame = 0; frame < frames; frame += 1) to[frame] = from[frame] ?? 0;
    }
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.ChannelMap, name);
  }

  release(): void {
    // Holds only its own array, which is collected with it.
  }
}

/** Each output channel a copy of the input channel its entry in `map` names. */
export const CHANNEL_MAP_NODE: NodeImplementation = {
  type: BuiltInNodeType.ChannelMap,
  role: NodeRole.Processor,
  check: (node) => problemsOf(readChannelMap(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step) => {
    const shape = plannedShape(step);
    const reading = readChannelMap(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    return succeed(new ChannelMapKernel(reading.value));
  },
};
