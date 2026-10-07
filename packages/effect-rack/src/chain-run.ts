/**
 * Running a chain over a stream (ADR-0060): the effect rack's answer to the
 * engine's `ChainProcessing` port.
 *
 * The chain's graph (`chain-graph.ts`) is compiled by the graph's own
 * analysis and run by the engine's executor, its input fed and its output
 * taken a block at a time, so a chain runs on whichever thread runs the
 * engine. A processor that measures its whole input is measured first, one
 * pass over the stream each, in signal order, each pass running the chain
 * with the measurements already made, so each measures what really reaches
 * it. A measurement that fails refuses the chain with its reason: the
 * processor unmeasured would pass its input on, and that would pass for
 * success. A chain whose latency cannot be known is refused, since its output
 * could not be put back where its input was (REQ-ARCH-144).
 *
 * A pass always hears the stream from its first frame, so every measurement
 * covers the whole stream; the run is then built for the frame its request
 * starts at, which reaches every processor's node, so one that plays back
 * its measurement plays it from there however the run was started.
 *
 * A chain that runs a processor measuring its whole input, or one that
 * cannot keep to the audio thread's schedule, is heard from a render rather
 * than run as it plays (ADR-0061): the rack says so, naming them, and the
 * engine reads its render. A parameter changed while a chain runs reaches
 * its processor's kernel, which smooths it in, where the processor can take
 * it running.
 */

import {
  fail,
  failure,
  FailureKind,
  processorsOf,
  succeed,
  throwIfCancelled,
  unheardLive,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type ParameterId,
  type ProcessorDescriptor,
  type ProcessorId,
} from '@audiogubbins/domain';
import { compileGraph, type NodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  allocateBlock,
  blockView,
  createExecutor,
  type AudioFrameBlock,
  type ChainProcessing,
  type ChainRequest,
  type ChainRun,
  type GraphExecutor,
  type NodeImplementations,
  type StreamReader,
} from '@audiogubbins/audio-engine';
import type { Measurement, ProcessorType } from '@audiogubbins/processors';

import { chainGraph, type ChainGraph } from './chain-graph.js';
import { descriptorsByKey, descriptorsOf, listening } from './chain-listening.js';

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

/** Runs `frames` frames of `running` from `input` into `output`, a block at a time. */
function processBlocks(
  running: Running,
  input: readonly Float32Array[],
  output: readonly Float32Array[],
  frames: number,
): void {
  const { endpoints, executor } = running;
  endpoints.input = input;
  endpoints.output = output;
  for (let offset = 0; offset < frames; offset += executor.blockFrames) {
    endpoints.offset = offset;
    executor.process(Math.min(executor.blockFrames, frames - offset));
  }
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`effect-rack.${code}`, FailureKind.Rejected, summary));
}

/** A chain's graph compiled and ready to run, with where its audio enters and leaves. */
interface Running {
  readonly executor: GraphExecutor;
  readonly endpoints: Endpoints;
  readonly latency: number;
  readonly built: ChainGraph;
}

/** Every node type a chain's graph may name: the engine's and every processor's. */
function implementationsOf(types: ReadonlyMap<string, ProcessorType>): NodeImplementations {
  const all = new Map(BUILT_IN_NODES);
  for (const type of types.values()) all.set(type.type, type);
  return all;
}

/** Compiles and binds `built`, its output taken at `sink`. */
function run(
  built: ChainGraph,
  sink: NodeId,
  implementations: NodeImplementations,
  request: ChainRequest,
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
  return succeed({ executor: executor.value, endpoints, latency: latency.frames, built });
}

/** Why a run cannot start at its request's start, or nothing where it can. */
function startRefusal(request: ChainRequest): DomainResult<never> | undefined {
  const { start, length } = request;
  if (Number.isSafeInteger(start) && start >= 0 && start <= length) return undefined;
  return refused(
    'start-invalid',
    `A run starts at a whole frame of its stream, from 0 to ${String(length)}, not at ${String(start)}.`,
  );
}

/** The chain's applied processors that measure their whole input, in signal order. */
function measuredProcessors(
  built: ChainGraph,
  request: ChainRequest,
  types: ReadonlyMap<string, ProcessorType>,
) {
  return [...processorsOf(request.chain.slots)].filter(
    (processor) =>
      built.processors.has(processor.id) &&
      types.get(processor.typeKey)?.descriptor.wholePass === true,
  );
}

/** The chain running over a stream, once every measurement is made. */
class RunningChain implements ChainRun {
  readonly latency: number;
  readonly layout: ChannelLayout;
  readonly #running: Running;
  /** The descriptor of each processor the chain runs, by instance. */
  readonly #descriptors: ReadonlyMap<ProcessorId, ProcessorDescriptor>;

  constructor(running: Running, descriptors: ReadonlyMap<ProcessorId, ProcessorDescriptor>) {
    this.#running = running;
    this.#descriptors = descriptors;
    this.latency = running.latency;
    this.layout = running.built.layout;
  }

  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void {
    processBlocks(this.#running, input, output, frames);
  }

  setParameter(processor: ProcessorId, parameter: ParameterId, value: number): DomainResult<void> {
    const node = this.#running.built.processors.get(processor);
    const descriptor = this.#descriptors.get(processor);
    if (node === undefined || descriptor === undefined) {
      return refused(
        'processor-not-running',
        'That processor is bypassed or not in the chain, so it has nothing running to change.',
      );
    }
    const unheard = unheardLive(descriptor);
    if (unheard !== undefined) return refused('parameter-not-live', unheard);
    const key = descriptor.parameters.find(
      (one) => one.id === parameter && one.kind === 'numeric',
    )?.key;
    return key === undefined
      ? refused(
          'parameter-not-numeric',
          `${descriptor.label} has no numeric parameter of that name.`,
        )
      : this.#running.executor.setParameter(node, key, value);
  }

  release(): void {
    this.#running.executor.release();
  }
}

/** The effect rack's chain processing, for the processor types `types`. */
export function chainProcessing(types: ReadonlyMap<string, ProcessorType>): ChainProcessing {
  const implementations = implementationsOf(types);
  const descriptors = descriptorsByKey(types);
  return {
    listening: (request) => {
      const built = chainGraph(request.chain, types, request.input, request.quality, {
        start: 0,
        measured: new Map(),
      });
      // Built first, so a chain this build cannot run is refused with its
      // reason rather than said to be heard.
      return built.ok ? succeed(listening(request, descriptors)) : built;
    },
    prepare: async (request, read, signal) => {
      const invalid = startRefusal(request);
      if (invalid !== undefined) return invalid;
      const measured = new Map<ProcessorId, Measurement>();
      const first = chainGraph(request.chain, types, request.input, request.quality, {
        start: request.start,
        measured,
      });
      if (!first.ok) return first;
      for (const processor of measuredProcessors(first.value, request, types)) {
        const made = await measure(
          request,
          read,
          types,
          implementations,
          measured,
          processor.id,
          signal,
        );
        if (!made.ok) return made;
        measured.set(processor.id, made.value);
      }
      const built = chainGraph(request.chain, types, request.input, request.quality, {
        start: request.start,
        measured,
      });
      if (!built.ok) return built;
      const running = run(built.value, built.value.output, implementations, request);
      if (!running.ok) return running;
      return succeed(new RunningChain(running.value, descriptorsOf(request, types)));
    },
  };
}

/** Frames read from the stream at a time during a measuring pass. */
const PASS_CHUNK = 16_384;

/**
 * What a pass over the stream measures at the input of `processor`, the
 * processors before it running with the measurements already made, or why the
 * measurer could not measure it. The stream is followed by silence for as long
 * as the path to the processor is late, so the measurer hears every frame of
 * it, and the late start is cut. Each chunk is read only once the measurer has
 * heard the one before, so a measurer slow per chunk holds the reading back
 * rather than the stream queuing in memory.
 */
async function measure(
  request: ChainRequest,
  read: StreamReader,
  types: ReadonlyMap<string, ProcessorType>,
  implementations: NodeImplementations,
  measured: ReadonlyMap<ProcessorId, Measurement>,
  processor: ProcessorId,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<Measurement>> {
  // A pass reads the stream from its first frame, whatever frame the run it
  // is made for starts at.
  const built = chainGraph(request.chain, types, request.input, request.quality, {
    start: 0,
    measured,
    at: processor,
  });
  if (!built.ok) return built;
  const tap = built.value.measure;
  if (tap === undefined) throw new Error('A graph built to measure a processor has its tap.');
  const type = [...types.values()].find((one) => one.type === tap.type);
  const measurer = type?.measurer?.(tap.settings, tap.layout, request);
  if (measurer === undefined) throw new Error('A processor measured in a pass has a measurer.');
  if (!measurer.ok) return measurer;
  const running = run(built.value, tap.sink, implementations, request);
  if (!running.ok) {
    measurer.value.release();
    return running;
  }
  const input = allocateBlock(request.input, request.sampleRate, PASS_CHUNK);
  const output = allocateBlock(tap.layout, request.sampleRate, PASS_CHUNK);
  const { latency } = running.value;
  const total = request.length + latency;
  try {
    for (let position = 0; position < total; position += PASS_CHUNK) {
      throwIfCancelled(signal);
      const frames = Math.min(PASS_CHUNK, total - position);
      const real = Math.max(0, Math.min(frames, request.length - position));
      for (const channel of input.channels) channel.fill(0);
      if (real > 0) await read(position, real, blockView(input, 0, real).channels, signal);
      processBlocks(running.value, input.channels, output.channels, frames);
      const skip = Math.max(0, latency - position);
      if (skip < frames) {
        await measurer.value.add(
          output.channels.map((channel) => channel.subarray(skip, frames)),
          frames - skip,
          signal,
        );
      }
    }
    return await measurer.value.result(signal);
  } finally {
    measurer.value.release();
    running.value.executor.release();
  }
}
