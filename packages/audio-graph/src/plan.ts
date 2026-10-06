/**
 * The execution plan: what the engine runs, as plain data.
 *
 * A plan is the graph decided: its nodes in running order, the buffer slot each
 * port reads or writes, and the delay each input needs to stay aligned. The
 * executor runs it without deciding anything, so every decision is made once,
 * here, where it can be tested without audio. It holds only numbers, strings,
 * arrays and typed arrays, because it is posted to an AudioWorklet, and a plan
 * made twice from the same graph is the same value, settings in the same order
 * included, so that the same graph renders the same bits (REQ-ARCH-049).
 */

import type { ChannelLayout, SampleCount, SampleRate } from '@audiogubbins/domain';

import type { SettingValue } from './descriptor.js';
import type { LatencyAnalysis } from './latency.js';
import { NodeRole } from './node-contract.js';
import type { NodeId } from './node-id.js';
import type { PathLatency } from './path-latency.js';
import { allocateSlots } from './slot-allocation.js';

/** One input of one step: the slot it reads and the delay to apply to it. */
export interface PlanInput {
  readonly port: string;
  readonly layout: ChannelLayout;
  readonly slot: number;

  /** Frames of delay that align this input with the step's latest input. */
  readonly delay: SampleCount;
}

/** One output of one step: the slot it writes. */
export interface PlanOutput {
  readonly port: string;
  readonly layout: ChannelLayout;
  readonly slot: number;
}

/** One node, as the executor runs it. */
export interface PlanStep {
  readonly node: NodeId;
  readonly type: string;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly inputs: readonly PlanInput[];
  readonly outputs: readonly PlanOutput[];
}

/** A buffer slot, sized once for the plan's life. */
export interface PlanSlot {
  readonly channels: number;
}

/** A sink: where the graph's audio is delivered, and how late it arrives. */
export interface PlanSink {
  readonly node: NodeId;

  /** The slots the sink reads, in its input port order. */
  readonly slots: readonly number[];
  readonly latency: PathLatency;
}

/** A graph, decided and ready to run. */
export interface ExecutionPlan {
  readonly sampleRate: SampleRate;

  /** Every buffer slot, by slot number. */
  readonly slots: readonly PlanSlot[];

  /** Every node, in running order. */
  readonly steps: readonly PlanStep[];
  readonly sinks: readonly PlanSink[];

  /** The latest of the sinks: the graph's latency. */
  readonly latency: PathLatency;
}

/** Two setting names in code-unit order, which is the same on every machine. */
function inCodeOrder(
  [one]: readonly [string, unknown],
  [other]: readonly [string, unknown],
): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

/**
 * The element of one of the parallel lists this package builds for a graph,
 * each of which has an element for every step and every port.
 */
function at<TValue>(list: readonly TValue[] | undefined, index: number): TValue {
  const value = list?.[index];
  if (value === undefined) throw new Error('A list built for every step or port lacks one.');
  return value;
}

/** Plans the running of an analysed graph. */
export function planGraph(analysis: LatencyAnalysis): ExecutionPlan {
  const nodes = analysis.graph.nodes;
  const slots = allocateSlots(nodes);
  const steps = nodes.map((node, step): PlanStep => {
    const { descriptor } = node;
    const reads = at(slots.inputs, step);
    const writes = at(slots.outputs, step);
    const delays = at(analysis.nodes, step).compensation;
    return {
      node: descriptor.id,
      type: descriptor.type,
      settings: Object.fromEntries(Object.entries(descriptor.settings).toSorted(inCodeOrder)),
      inputs: descriptor.inputs.map((port, index) => ({
        port: port.name,
        layout: port.layout,
        slot: at(reads, index),
        delay: at(delays, index),
      })),
      outputs: descriptor.outputs.map((port, index) => ({
        port: port.name,
        layout: port.layout,
        slot: at(writes, index),
      })),
    };
  });
  const sinks = nodes.flatMap((node, step): PlanSink[] =>
    node.contract.role === NodeRole.Sink
      ? [
          {
            node: node.descriptor.id,
            slots: at(slots.inputs, step),
            latency: at(analysis.nodes, step).arrival,
          },
        ]
      : [],
  );
  return {
    sampleRate: analysis.sampleRate,
    slots: slots.channels.map((channels) => ({ channels })),
    steps,
    sinks,
    latency: analysis.overall,
  };
}
