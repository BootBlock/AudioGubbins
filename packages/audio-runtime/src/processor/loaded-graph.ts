/**
 * A `load` message made into a graph the processor can run, or every reason
 * it cannot be.
 *
 * The processor compiles the descriptor itself, since the plan is derived data
 * and the descriptor is what crossed. Then each feed the main thread bound is
 * attached to its graph input, with the layout of the input's port, the one
 * sink is pointed at the processor's output, and each meter at a window its
 * reports are gathered in. Only when all of that holds is the DSP compiled and
 * instantiated and the executor made, so a refused graph costs no module
 * memory. Everything here allocates, which is why it happens on a message and
 * never in a quantum.
 */

import { channelCount, sampleRate as readSampleRate, type SampleRate } from '@audiogubbins/domain';
import { compileGraph, type ExecutionPlan, type NodeId } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  createExecutor,
  type GraphExecutor,
  type KernelContext,
  type NodeImplementations,
} from '@audiogubbins/audio-engine';

import type { ScopeDsp } from '../dsp/dsp-instance.js';
import { PostedFeed } from '../feed/posted-feed.js';
import type { ProcessorFeed } from '../feed/processor-feed.js';
import { RingFeed } from '../feed/ring-feed.js';
import { RingReader } from '../feed/sample-ring.js';
import {
  FeedTransport,
  type FeedBinding,
  type ToProcessor,
  type ToProcessorKind,
} from '../protocol/processor-messages.js';
import { MeterWindow } from './meter-window.js';
import { QuantumOutput } from './quantum-output.js';
import { workletDsp } from './worklet-dsp.js';

/** The frames of one render quantum, which the executor is made to run. */
export const RENDER_QUANTUM_FRAMES = 128;

type LoadMessage = Extract<ToProcessor, { readonly kind: typeof ToProcessorKind.Load }>;

/** A meter node and the window its readings gather in. */
export interface WatchedMeter {
  readonly node: NodeId;
  readonly window: MeterWindow;
}

/** A graph compiled, bound and ready to run a quantum at a time. */
export interface LoadedGraph {
  readonly plan: ExecutionPlan;

  /** What the kernels were made with, kept to make them again at a reset. */
  readonly context: KernelContext;
  readonly dsp: ScopeDsp;

  /** Every feed, in the order of the bindings. */
  readonly feeds: readonly ProcessorFeed[];

  /** The feeds whose blocks arrive as messages, by the graph input they feed. */
  readonly posted: ReadonlyMap<NodeId, PostedFeed>;
  readonly output: QuantumOutput;
  readonly meters: readonly WatchedMeter[];

  /** Blocks between two meter reports; zero for none. */
  readonly meterEveryBlocks: number;

  /** The graph's latency in frames, where every node on the way can say it. */
  readonly latencyFrames: number | undefined;

  /**
   * The frames the graph runs on after its feeds' last frame before that
   * frame is heard: its latency, or the part of it that is known.
   */
  readonly tailFrames: number;
}

/** A graph ready to run with its executor, or every reason it cannot run here. */
export type GraphLoading =
  | { readonly ok: true; readonly graph: LoadedGraph; readonly executor: GraphExecutor }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** The feeds bound to graph inputs, each at the layout of its input's port. */
interface BoundFeeds {
  readonly feeds: ProcessorFeed[];
  readonly byNode: Map<NodeId, ProcessorFeed>;
  readonly posted: Map<NodeId, PostedFeed>;
}

/** The feed for one binding, or why it cannot feed the graph. */
function feedFor(binding: FeedBinding, plan: ExecutionPlan): ProcessorFeed | string {
  const step = plan.steps.find((one) => one.node === binding.node);
  if (step?.type !== BuiltInNodeType.GraphInput) {
    return `A feed is bound to ${binding.node}, which is not a graph input of the graph.`;
  }
  const layout = step.outputs[0]?.layout;
  if (layout === undefined) return `Graph input ${binding.node} has no output port to feed.`;
  if (channelCount(layout) !== binding.channels) {
    return `The feed bound to ${binding.node} has ${String(binding.channels)} channels, and its port ${String(channelCount(layout))}.`;
  }
  if (binding.transport === FeedTransport.Posted) return new PostedFeed(layout);
  const reader = RingReader.open(binding.ring);
  if (!reader.ok) return `The feed bound to ${binding.node}: ${reader.failures[0].summary}`;
  if (reader.value.channelCount !== binding.channels) {
    return `The ring bound to ${binding.node} has ${String(reader.value.channelCount)} channels, not the ${String(binding.channels)} its binding says.`;
  }
  return new RingFeed(reader.value, layout);
}

function bindFeeds(message: LoadMessage, plan: ExecutionPlan, reasons: string[]): BoundFeeds {
  const bound: BoundFeeds = { feeds: [], byNode: new Map(), posted: new Map() };
  for (const binding of message.feeds) {
    if (bound.byNode.has(binding.node)) {
      reasons.push(`Two feeds are bound to ${binding.node}; a graph input reads one.`);
      continue;
    }
    const feed = feedFor(binding, plan);
    if (typeof feed === 'string') {
      reasons.push(feed);
      continue;
    }
    bound.feeds.push(feed);
    bound.byNode.set(binding.node, feed);
    if (feed instanceof PostedFeed) bound.posted.set(binding.node, feed);
  }
  // An input whose binding was refused has its reason already, so only an
  // input no binding named is reported as unbound.
  const named = new Set(message.feeds.map((binding) => binding.node));
  for (const step of plan.steps) {
    if (step.type === BuiltInNodeType.GraphInput && !named.has(step.node)) {
      reasons.push(`Graph input ${step.node} has no feed bound to it.`);
    }
  }
  return bound;
}

/** A window for each meter node, where reports are asked for. */
function watchMeters(plan: ExecutionPlan, meterEveryBlocks: number): readonly WatchedMeter[] {
  if (meterEveryBlocks === 0) return [];
  return plan.steps
    .filter((step) => step.type === BuiltInNodeType.Meter)
    .map((step) => {
      const layout = step.inputs[0]?.layout;
      return {
        node: step.node,
        window: new MeterWindow(layout === undefined ? 0 : channelCount(layout)),
      };
    });
}

/**
 * The graph of a `load` message at the context's `rate`, run by the node
 * types of `implementations`, or every reason it cannot run.
 */
export function loadGraph(
  message: LoadMessage,
  rate: number,
  implementations: NodeImplementations,
): GraphLoading {
  const contextRate = readSampleRate(rate);
  if (!contextRate.ok) return { ok: false, reasons: [contextRate.failures[0].summary] };
  const compiled = compileGraph(message.graph, implementations, contextRate.value);
  if (!compiled.ok) {
    return { ok: false, reasons: compiled.diagnostics.map((diagnostic) => diagnostic.message) };
  }
  const { plan } = compiled;
  const reasons: string[] = [];
  if (plan.sinks.length !== 1) {
    reasons.push(
      `The graph has ${String(plan.sinks.length)} outputs; the processor plays exactly one.`,
    );
  }
  const bound = bindFeeds(message, plan, reasons);
  if (reasons.length > 0) return { ok: false, reasons };
  return makeExecutor(message, plan, contextRate.value, bound, implementations);
}

function makeExecutor(
  message: LoadMessage,
  plan: ExecutionPlan,
  rate: SampleRate,
  bound: BoundFeeds,
  implementations: NodeImplementations,
): GraphLoading {
  const dsp = workletDsp(message.dspModuleBytes, message.dspUnavailable);
  const output = new QuantumOutput();
  const meters = watchMeters(plan, message.meterEveryBlocks);
  const windows = new Map(meters.map((meter) => [meter.node, meter.window]));
  const sink = plan.sinks[0]?.node;
  const context: KernelContext = {
    sampleRate: rate,
    blockFrames: RENDER_QUANTUM_FRAMES,
    dsp: dsp.dsp,
    feedFor: (node) => bound.byNode.get(node),
    sinkFor: (node) => (node === sink ? output : undefined),
    meterFor: (node) => windows.get(node),
  };
  const executor = createExecutor(plan, implementations, context);
  if (!executor.ok) {
    return { ok: false, reasons: executor.failures.map((one) => one.summary) };
  }
  const latency = plan.latency;
  return {
    ok: true,
    executor: executor.value,
    graph: {
      plan,
      context,
      dsp,
      feeds: bound.feeds,
      posted: bound.posted,
      output,
      meters,
      meterEveryBlocks: message.meterEveryBlocks,
      latencyFrames: latency.kind === 'known' ? latency.frames : undefined,
      tailFrames: latency.kind === 'known' ? latency.frames : latency.knownFrames,
    },
  };
}
