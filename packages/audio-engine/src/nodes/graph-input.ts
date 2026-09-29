/**
 * The graph input: audio from outside the graph, from the feed the host binds.
 *
 * The one way audio enters a graph that is not generated inside it, whether it
 * is a clip's decoded PCM in a render or the audio crossing into the worklet in
 * playback (ADR-0030). The node says only what layout arrives; which feed
 * supplies it is the host's to bind, so one graph runs in both places. A feed
 * that runs short is silenced past its end, never repeated, because a repeated
 * block would be heard as audio the person never recorded.
 */

import {
  failure,
  FailureKind,
  fail,
  layoutsMatch,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { unknownParameter } from './node-parameters.js';
import type { InputFeed, NodeImplementation, NodeKernel } from './node-implementation.js';
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
  type PortShape,
} from './node-shape.js';
import { refuseOtherSettings } from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const TAKES: ReadonlySet<string> = new Set();

/** The port a graph input writes, or every problem with the node. */
function readGraphInput(shape: NodeShape): NodeReading<PortShape> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const output = onlyPort(shape, 'outputs', problems);
  return output === undefined || problems.length > 0 ? refused(problems) : accepted(output);
}

class GraphInputKernel implements NodeKernel {
  readonly #inputFeed: InputFeed;

  constructor(feed: InputFeed) {
    this.#inputFeed = feed;
  }

  process(
    _inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const output = portAt(outputs, 0);
    const got = this.#inputFeed.fill(output);
    // Indexed, because an iterator over the channels is an allocation each quantum.
    for (let channel = 0; channel < output.channels.length; channel += 1) {
      channelAt(output, channel).fill(0, got, frames);
    }
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.GraphInput, name);
  }

  release(): void {
    // The feed is the host's, and outlives the kernel it was bound to.
  }
}

/** Audio from outside the graph, read from the feed the host binds to the node. */
export const GRAPH_INPUT_NODE: NodeImplementation = {
  type: BuiltInNodeType.GraphInput,
  role: NodeRole.Source,
  check: (node) => problemsOf(readGraphInput(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readGraphInput(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    const feed = context.feedFor(step.node);
    if (feed === undefined) {
      return fail(
        failure(
          'node.feed-unbound',
          FailureKind.Rejected,
          `Graph input ${step.node} has no feed bound to it. Bind the audio it reads before running the graph.`,
          { details: { node: step.node } },
        ),
      );
    }
    if (!layoutsMatch(feed.layout, reading.value.layout)) {
      // Adapting here would be a hidden up- or down-mix (REQ-ARCH-157): the
      // conversion belongs in the graph, where it is seen and can be chosen.
      return fail(
        failure(
          'node.feed-layout-mismatch',
          FailureKind.Rejected,
          `The feed bound to graph input ${step.node} has a different channel layout from the input's port. Convert the audio to the port's layout explicitly first, or give the port the feed's layout.`,
          { details: { node: step.node } },
        ),
      );
    }
    return succeed(new GraphInputKernel(feed));
  },
};
