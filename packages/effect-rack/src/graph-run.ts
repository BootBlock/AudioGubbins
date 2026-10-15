/**
 * A chain's graph compiled and run over audio given to it a block at a time
 * (ADR-0060): what a run and every measuring pass of the effect rack are made
 * of. The graph's executor runs its nodes; this binds its input and output to
 * the arrays a call gives, and, where the chain is automated, ends each block
 * where its lanes' next values are due and gives them first
 * (`chain-automation.ts`).
 */

import {
  fail,
  failure,
  FailureKind,
  mapResult,
  succeed,
  type DomainResult,
  type ProcessorId,
} from '@audiogubbins/domain';
import { compileGraph, type NodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  createExecutor,
  type AudioFrameBlock,
  type ChainRequest,
  type GraphExecutor,
  type NodeImplementations,
} from '@audiogubbins/audio-engine';
import type { ProcessorType } from '@audiogubbins/processors';

import { AutomationDriver, startingValues, type AutomationLane } from './chain-automation.js';
import type { ChainGraph, ChainGraphRun } from './chain-graph.js';

/** Where a block in flight is read from and written to, rebound for each call. */
class Endpoints {
  input: readonly Float32Array[] = [];
  output: readonly Float32Array[] = [];
  offset = 0;

  fill(into: AudioFrameBlock): number {
    into.channels.forEach((channel, index) => {
      const from = this.input[index];
      if (from !== undefined) channel.set(from.subarray(this.offset, this.offset + into.frames));
    });
    return into.frames;
  }

  receive(block: AudioFrameBlock): void {
    block.channels.forEach((channel, index) => {
      this.output[index]?.set(channel.subarray(0, block.frames), this.offset);
    });
  }
}

/** Where a measuring pass sends the chain's own output, which it does not need. */
const DISCARDED = { receive: (): void => undefined };

/**
 * Runs `frames` frames of `running` from `input` into `output`, a block at a
 * time, each block ending where its automation's next values are due.
 */
export function processBlocks(
  running: Running,
  input: readonly Float32Array[],
  output: readonly Float32Array[],
  frames: number,
): void {
  const { endpoints, executor, automation } = running;
  endpoints.input = input;
  endpoints.output = output;
  for (let offset = 0; offset < frames;) {
    const most = Math.min(executor.blockFrames, frames - offset);
    const count = automation === undefined ? most : automation.span(most);
    automation?.give(executor);
    endpoints.offset = offset;
    executor.process(count);
    automation?.advance(count);
    offset += count;
  }
}

/** A refusal of the effect rack's, `code` within its namespace. */
export function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`effect-rack.${code}`, FailureKind.Rejected, summary));
}

/** A chain's graph compiled and ready to run, with where its audio enters and leaves. */
export interface Running {
  readonly executor: GraphExecutor;
  readonly endpoints: Endpoints;
  readonly latency: number;
  readonly built: ChainGraph;
  /** Frames each node's input is late against the chain's input. */
  readonly arrivals: ReadonlyMap<NodeId, number>;
  readonly automation?: AutomationDriver;
}

/** Every node type a chain's graph may name: the engine's and every processor's. */
export function implementationsOf(types: ReadonlyMap<string, ProcessorType>): NodeImplementations {
  const all = new Map(BUILT_IN_NODES);
  for (const type of types.values()) all.set(type.type, type);
  return all;
}

/** What a run is compiled and bound with, a bounded stream's or a live input's. */
export type RunRequest = Pick<ChainRequest, 'input' | 'sampleRate' | 'blockFrames' | 'dsp'>;

/** Compiles and binds `built`, its output taken at `sink`. */
export function compiledRun(
  built: ChainGraph,
  sink: NodeId,
  implementations: NodeImplementations,
  request: RunRequest,
): DomainResult<Running> {
  const compiled = compileGraph(built.graph, implementations, request.sampleRate);
  if (!compiled.ok) {
    return refused('chain-unrunnable', compiled.diagnostics.map((one) => one.message).join(' '));
  }
  const latency = compiled.plan.sinks.find((one) => one.node === sink)?.latency;
  if (latency?.kind !== 'known') {
    return refused(
      'latency-unknown',
      'A processor of the chain cannot say how late its output is, so its output cannot be put back in time with its input.',
    );
  }
  const endpoints = new Endpoints();
  const executor = createExecutor(compiled.plan, implementations, {
    sampleRate: request.sampleRate,
    blockFrames: request.blockFrames,
    dsp: request.dsp,
    feedFor: (node) =>
      node === built.input
        ? { layout: request.input, fill: (into) => endpoints.fill(into) }
        : undefined,
    sinkFor: (node) =>
      node === sink
        ? {
            receive: (block) => {
              endpoints.receive(block);
            },
          }
        : node === built.output
          ? DISCARDED
          : undefined,
    meterFor: () => undefined,
  });
  if (!executor.ok) return executor;
  const arrivals = new Map<NodeId, number>();
  for (const step of compiled.plan.steps) {
    if (step.inputArrival.kind === 'known') arrivals.set(step.node, step.inputArrival.frames);
  }
  return succeed({ executor: executor.value, endpoints, latency: latency.frames, built, arrivals });
}

/**
 * {@link compiledRun} of the graph `build` makes, its automated processors started at
 * their lanes' values and driven by them from frame `start` of the stream.
 * How late a processor hears the stream is known only once its graph is
 * compiled, so the graph is first built as if every automated processor
 * heard the stream on time, and built again, once, with their starting
 * values read that much earlier where one does not.
 */
export function automatedRun(
  lanes: readonly AutomationLane[],
  start: number,
  build: (starting: ChainGraphRun['starting']) => DomainResult<ChainGraph>,
  sinkOf: (built: ChainGraph) => NodeId,
  implementations: NodeImplementations,
  request: RunRequest,
): DomainResult<Running> {
  if (lanes.length === 0) {
    const built = build(undefined);
    return built.ok
      ? compiledRun(built.value, sinkOf(built.value), implementations, request)
      : built;
  }
  const onTime = (): number => 0;
  const first = drivenRun(lanes, start, onTime, build, sinkOf, implementations, request);
  if (!first.ok || first.value.late === undefined) return mapResult(first, (one) => one.running);
  first.value.running.executor.release();
  const late = first.value.late;
  const again = drivenRun(lanes, start, late, build, sinkOf, implementations, request);
  if (!again.ok || again.value.late === undefined) return mapResult(again, (one) => one.running);
  // Only a latency that moves with an automated value's start can differ again.
  again.value.running.executor.release();
  return refused(
    'automation-latency-moved',
    'An automated parameter changes how late its chain is, so its automation cannot be kept in time.',
  );
}

/**
 * A run of `build`'s graph with its automated processors started as if each
 * heard the stream `assumed` frames late, driven by their lanes; and, where one
 * hears it otherwise, how late each does, for a run built again.
 */
function drivenRun(
  lanes: readonly AutomationLane[],
  start: number,
  assumed: (processor: ProcessorId) => number,
  build: (starting: ChainGraphRun['starting']) => DomainResult<ChainGraph>,
  sinkOf: (built: ChainGraph) => NodeId,
  implementations: NodeImplementations,
  request: RunRequest,
): DomainResult<{
  readonly running: Running;
  readonly late?: (processor: ProcessorId) => number;
}> {
  const built = build(startingValues(lanes, start, assumed));
  if (!built.ok) return built;
  const running = compiledRun(built.value, sinkOf(built.value), implementations, request);
  if (!running.ok) return running;
  const { processors } = built.value;
  const { arrivals, executor } = running.value;
  const heard = (processor: ProcessorId): number => {
    const node = processors.get(processor);
    return node === undefined ? 0 : (arrivals.get(node) ?? 0);
  };
  if (lanes.some(({ processor }) => heard(processor) !== assumed(processor))) {
    return succeed({ running: running.value, late: heard });
  }
  const automation = new AutomationDriver(lanes, start, processors, heard);
  const checked = automation.check(executor);
  if (!checked.ok) {
    executor.release();
    return checked;
  }
  return succeed({ running: { ...running.value, automation } });
}
