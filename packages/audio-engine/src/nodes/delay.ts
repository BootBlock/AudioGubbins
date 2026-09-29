/**
 * Delay: every channel later by a whole number of frames.
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
 */

import {
  channelCount,
  fail,
  failure,
  FailureKind,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import { NodeRole, type ProcessorLatency } from '@audiogubbins/audio-graph';

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
} from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const FRAMES = 'frames';

/** The setting that makes the delay a lookahead's latency rather than an effect. */
const AS_LATENCY = 'as-latency';

const TAKES: ReadonlySet<string> = new Set([FRAMES, AS_LATENCY]);

interface DelaySettings {
  readonly frames: SampleCount;
  readonly asLatency: boolean;
  readonly channels: number;
}

/** How long the delay is and what it stands for, or every problem with the node. */
function readDelay(shape: NodeShape): NodeReading<DelaySettings> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (input !== undefined && output !== undefined) {
    requireSameLayout(shape, input, output, problems);
  }
  const frames = requiredSetting(shape, FRAMES, FRAME_COUNT, problems);
  const asLatency = optionalSetting(shape, AS_LATENCY, FLAG, problems) ?? false;
  return output === undefined || frames === undefined || problems.length > 0
    ? refused(problems)
    : accepted({ frames, asLatency, channels: channelCount(output.layout) });
}

class DelayKernel implements NodeKernel {
  readonly #line: DelayLine;

  constructor({ frames, channels }: DelaySettings) {
    this.#line = new DelayLine(channels, frames);
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

/** The latency a delay node reports: its frames when it stands for a lookahead, else none. */
function delayLatency(shape: NodeShape): ProcessorLatency {
  const reading = readDelay(shape);
  // A node its checks refused is never analysed for latency, so zero is never reported for it.
  if (!reading.ok || !reading.value.asLatency) return ZERO_LATENCY;
  return { kind: 'known', frames: reading.value.frames };
}

/** Every channel later by the `frames` setting; latency to compensate only with `as-latency`. */
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
          `This machine cannot hold ${String(reading.value.frames)} frames of delay on ${String(reading.value.channels)} channels; choose a shorter delay.`,
        ),
      );
    }
  },
};
