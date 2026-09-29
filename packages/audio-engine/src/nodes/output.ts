/**
 * The output: where the graph's audio is delivered, to the target the host
 * binds.
 *
 * The sink every graph ends at (ADR-0030), and so the point its latency is
 * measured to. Like the graph input it names no device or file: the offline
 * renderer binds a target that collects the render, and the worklet one that
 * hands each block to the audio context, so one graph runs in both.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { portAt } from './kernel-ports.js';
import { unknownParameter } from './node-parameters.js';
import type { NodeImplementation, NodeKernel, SinkTarget } from './node-implementation.js';
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

/** The port an output reads, or every problem with the node. */
function readOutput(shape: NodeShape): NodeReading<PortShape> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  return input === undefined || problems.length > 0 ? refused(problems) : accepted(input);
}

class OutputKernel implements NodeKernel {
  readonly #target: SinkTarget;

  constructor(target: SinkTarget) {
    this.#target = target;
  }

  process(inputs: readonly AudioFrameBlock[]): void {
    this.#target.receive(portAt(inputs, 0));
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.Output, name);
  }

  release(): void {
    // The target is the host's, and outlives the kernel it was bound to.
  }
}

/** The graph's audio, delivered to the target the host binds to the node. */
export const OUTPUT_NODE: NodeImplementation = {
  type: BuiltInNodeType.Output,
  role: NodeRole.Sink,
  check: (node) => problemsOf(readOutput(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readOutput(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    const target = context.sinkFor(step.node);
    if (target === undefined) {
      return fail(
        failure(
          'node.sink-unbound',
          FailureKind.Rejected,
          `Output ${step.node} has no target bound to it. Bind where its audio goes before running the graph.`,
          { details: { node: step.node } },
        ),
      );
    }
    return succeed(new OutputKernel(target));
  },
};
