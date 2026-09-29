/**
 * Delay: every channel later by a whole number of frames, and each by its own
 * as well.
 *
 * The `frames` setting delays every channel alike, and `channel-delays`, one
 * whole number of frames for each channel in layout order, adds to it for that
 * channel alone, to time-align speakers or microphones (REQ-ARCH-157).
 *
 * Two different things are a delay, and the `as-latency` setting says which.
 * Usually the delay is the effect the person asked for, an echo's dry offset
 * or a slip against another track, so it reports no latency: the graph must
 * not compensate it away on parallel paths, or it would do nothing. A delay
 * that stands for a processor's lookahead is latency, so with `as-latency`
 * set it reports its frames (REQ-ARCH-144), and the graph delays parallel
 * paths to meet it and a render trims it from the start. The delay itself is
 * a {@link DelayLine}, which gives the same bits however the stream is cut
 * into blocks.
 *
 * A latency is one number for a whole port, which the graph delays parallel
 * paths to meet. So a delay stands for a lookahead only when every channel is
 * equally late, and reports that; with channels late by different amounts,
 * `as-latency` is refused, because no single number would compensate them.
 */

import {
  channelCount,
  fail,
  sampleCount,
  failure,
  FailureKind,
  succeed,
  type DomainResult,
  type ProcessorLatency,
  type SampleCount,
} from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import { DelayLine } from '../pcm/delay-line.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { portAt } from './kernel-ports.js';
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
import {
  FLAG,
  FRAME_COUNT,
  optionalSetting,
  refuseOtherSettings,
  requiredSetting,
  type SettingRule,
} from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const FRAMES = 'frames';

/** The setting that makes the delay a lookahead's latency rather than an effect. */
const AS_LATENCY = 'as-latency';

/** The setting that adds a delay of its own to each channel. */
const CHANNEL_DELAYS = 'channel-delays';

const TAKES: ReadonlySet<string> = new Set([FRAMES, CHANNEL_DELAYS, AS_LATENCY]);

/** A list of `length` whole numbers of frames, one for each channel. */
function frameCounts(length: number): SettingRule<readonly SampleCount[]> {
  return {
    describes: `a list of ${String(length)} whole numbers of frames, zero or more, one for each channel in layout order`,
    read: (value) => {
      if (typeof value !== 'object' || value.length !== length) return undefined;
      const counts: SampleCount[] = [];
      for (const one of value) {
        const count = FRAME_COUNT.read(one);
        if (count === undefined) return undefined;
        counts.push(count);
      }
      return counts;
    },
  };
}

interface DelaySettings {
  /** Each channel's whole delay: the shared frames and its own. */
  readonly lengths: readonly SampleCount[];
  readonly asLatency: boolean;
}

/** How long each channel's delay is and what it stands for, or every problem with the node. */
function readDelay(shape: NodeShape): NodeReading<DelaySettings> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (input === undefined || output === undefined) return refused(problems);
  requireSameLayout(shape, input, output, problems);
  const channels = channelCount(output.layout);
  const frames = requiredSetting(shape, FRAMES, FRAME_COUNT, problems);
  const own =
    optionalSetting(shape, CHANNEL_DELAYS, frameCounts(channels), problems) ??
    new Array<number>(channels).fill(0);
  const asLatency = optionalSetting(shape, AS_LATENCY, FLAG, problems) ?? false;
  if (frames === undefined || problems.length > 0) return refused(problems);
  const lengths: SampleCount[] = [];
  for (const extra of own) {
    const length = sampleCount(frames + extra);
    if (!length.ok) {
      problems.push({
        code: 'node-settings-invalid',
        message: `Node ${shape.id} delays a channel by more frames than can be counted exactly. Shorten its "${FRAMES}" or "${CHANNEL_DELAYS}".`,
        node: shape.id,
      });
      return refused(problems);
    }
    lengths.push(length.value);
  }
  if (asLatency && lengths.some((length) => length !== lengths[0])) {
    problems.push({
      code: 'node-settings-invalid',
      message: `Node ${shape.id} has "${AS_LATENCY}" set, but its channels are late by different amounts, and a latency is one number for the whole port, so the graph could align only one of them. Give every channel the same delay, or clear "${AS_LATENCY}" to make the delay an effect.`,
      node: shape.id,
    });
    return refused(problems);
  }
  return accepted({ lengths, asLatency });
}

class DelayKernel implements NodeKernel {
  readonly #line: DelayLine;

  constructor({ lengths }: DelaySettings) {
    this.#line = new DelayLine(lengths);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    this.#line.process(portAt(inputs, 0), portAt(outputs, 0), frames);
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.Delay, name);
  }

  release(): void {
    // Holds only its line's history, which is collected with it.
  }
}

/** The latency a delay node reports: the delay its channels share when it stands for a lookahead, else none. */
function delayLatency(shape: NodeShape): ProcessorLatency {
  const reading = readDelay(shape);
  // A node its checks refused is never analysed for latency, so zero is never reported for it.
  const [shared] = reading.ok ? reading.value.lengths : [];
  if (!reading.ok || !reading.value.asLatency || shared === undefined) return ZERO_LATENCY;
  return { kind: 'known', frames: shared };
}

/** The longest of a delay's channels, which a refusal to allocate it names. */
function longest(lengths: readonly SampleCount[]): number {
  return lengths.reduce((most, length) => Math.max(most, length), 0);
}

/**
 * Every channel later by the `frames` setting and its entry in
 * `channel-delays`; latency to compensate only with `as-latency`.
 */
export const DELAY_NODE: NodeImplementation = {
  type: BuiltInNodeType.Delay,
  role: NodeRole.Processor,
  check: (node) => problemsOf(readDelay(node)),
  latency: delayLatency,
  createKernel: (step) => {
    const shape = plannedShape(step);
    const reading = readDelay(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    try {
      return succeed(new DelayKernel(reading.value));
    } catch (error) {
      // No length is refused in advance (REQ-ARCH-087); a history the machine
      // cannot hold is found when it is allocated, and said so.
      if (!(error instanceof RangeError)) throw error;
      return fail(
        failure(
          'node.delay-unallocated',
          FailureKind.Rejected,
          `This machine cannot hold ${String(longest(reading.value.lengths))} frames of delay on ${String(reading.value.lengths.length)} channels; choose a shorter delay.`,
        ),
      );
    }
  },
};
