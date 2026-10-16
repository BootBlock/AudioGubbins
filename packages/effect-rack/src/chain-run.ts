/**
 * Running a chain over a stream (ADR-0060): the effect rack's answer to the
 * engine's `ChainProcessing` port.
 *
 * The chain's graph (`chain-graph.ts`) is compiled by the graph's own analysis
 * and run by the engine's executor, its input fed and its output taken a block
 * at a time, so a chain runs on whichever thread runs the engine. A processor
 * that measures its whole input is measured first, one pass over the stream
 * each, in signal order, each pass running the chain with the measurements
 * already made, so each measures what really reaches it. A measurement that
 * fails refuses the chain with its reason: the processor unmeasured would pass
 * its input on, and that would pass for success. A chain whose latency cannot
 * be known is refused, since its output could not be put back where its input
 * was (REQ-ARCH-144).
 *
 * A pass always hears the stream from its first frame, so every measurement
 * covers the whole stream; the run is then built for the frame its request
 * starts at, which reaches every processor's node, so one that plays back its
 * measurement plays it from there however the run was started.
 *
 * A chain that runs a processor measuring its whole input, or one that cannot
 * keep to the audio thread's schedule, is heard from a render rather than run
 * as it plays (ADR-0061): the rack says so, naming them, and the engine reads
 * its render. A parameter changed while a chain runs reaches its processor's
 * kernel, which smooths it in, where the processor can take it running.
 *
 * A run may be given automation of its chain's parameters
 * (`chain-automation.ts`): each automated processor starts at its lane's value
 * and is given the lane's next value every `DESIGN_INTERVAL` frames of the run,
 * in a run and in every pass alike, so what a pass measures is what the run
 * plays; a run kept into a continued plan takes the new plan's lanes.
 *
 * The rack's live form runs a chain over an input with no end, as monitoring
 * hears a microphone through one (ADR-0070): made at once, with no pass, and
 * only for a chain heard live, so the audio thread can make and run it.
 */

import {
  chainOutputLayout,
  mapResult,
  succeed,
  throwIfCancelled,
  unheardLive,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type ParameterAutomation,
  type ParameterId,
  type ProcessorDescriptor,
  type ProcessorId,
} from '@audiogubbins/domain';
import {
  allocateBlock,
  blockView,
  type ChainProcessing,
  type ChainRequest,
  type ChainRun,
  type ListeningRequest,
  type LiveChainRequest,
  type NodeImplementations,
  type StreamReader,
} from '@audiogubbins/audio-engine';
import type { Measurement, ProcessorType } from '@audiogubbins/processors';

import { checkedAutomation, type AutomationLane } from './chain-automation.js';
import { chainGraph, type ChainGraph, type ChainGraphRun } from './chain-graph.js';
import {
  automatedRun,
  compiledRun,
  implementationsOf,
  processBlocks,
  refused,
  type Running,
} from './graph-run.js';
import { descriptorsByKey, descriptorsOf, listening } from './chain-listening.js';
import { measuredProcessors, measurementBytesOf } from './whole-passes.js';

/** Why a run cannot start at its request's start, or nothing where it can. */
function startRefusal(request: ChainRequest): DomainResult<never> | undefined {
  const { start, length } = request;
  if (Number.isSafeInteger(start) && start >= 0 && start <= length) return undefined;
  return refused(
    'start-invalid',
    `A run starts at a whole frame of its stream, from 0 to ${String(length)}, not at ${String(start)}.`,
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
    if (this.#running.automation?.moves(processor, parameter) === true) {
      return refused(
        'parameter-automated',
        'That parameter follows its automation, so it cannot also be moved by hand.',
      );
    }
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

  automate(automation: readonly ParameterAutomation[]): DomainResult<void> {
    const lanes = checkedAutomation(automation, this.#running.built.processors, this.#descriptors);
    if (!lanes.ok) return lanes;
    const driver = this.#running.automation;
    if (driver !== undefined) return driver.replace(lanes.value);
    return lanes.value.length === 0
      ? succeed(undefined)
      : refused(
          'automation-lanes-changed',
          'A running chain takes new points for the parameters it moves, not lanes for others; a run made afresh takes those.',
        );
  }

  release(): void {
    this.#running.executor.release();
  }
}

/** The graph of `request`'s chain before any pass, or why this build cannot run it. */
function graphBeforePasses(
  request: ListeningRequest,
  types: ReadonlyMap<string, ProcessorType>,
): DomainResult<ChainGraph> {
  return chainGraph(request.chain, types, request.input, request.quality, {
    start: 0,
    measured: new Map(),
  });
}

/** The effect rack's chain processing, for the processor types `types`. */
export function chainProcessing(types: ReadonlyMap<string, ProcessorType>): ChainProcessing {
  const implementations = implementationsOf(types);
  const descriptors = descriptorsByKey(types);
  return {
    // Built first, so a chain this build cannot run is refused with its
    // reason rather than said to be heard.
    listening: (request) =>
      mapResult(graphBeforePasses(request, types), () => listening(request, descriptors)),
    measurementBytes: (request) =>
      mapResult(graphBeforePasses(request, types), (built) =>
        measurementBytesOf(built, request, types, request.length),
      ),
    prepare: (request, read, signal) => prepare(request, read, signal, types, implementations),
    prepareLive: (request) => prepareLive(request, types, implementations, descriptors),
  };
}

/**
 * The run of `request`'s chain over the stream `read` reads, once a pass has
 * measured every processor that measures its whole input, in signal order, or
 * why it cannot run.
 */
async function prepare(
  request: ChainRequest,
  read: StreamReader,
  signal: CancellationSignal | undefined,
  types: ReadonlyMap<string, ProcessorType>,
  implementations: NodeImplementations,
): Promise<DomainResult<ChainRun>> {
  const invalid = startRefusal(request);
  if (invalid !== undefined) return invalid;
  const measured = new Map<ProcessorId, Measurement>();
  const build = (starting?: ChainGraphRun['starting']) =>
    chainGraph(request.chain, types, request.input, request.quality, {
      start: request.start,
      measured,
      ...(starting === undefined ? {} : { starting }),
    });
  const first = build();
  if (!first.ok) return first;
  const descriptors = descriptorsOf(request, types);
  const lanes = checkedAutomation(request.automation ?? [], first.value.processors, descriptors);
  if (!lanes.ok) return lanes;
  const pass: PassSettings = { request, read, types, implementations, lanes: lanes.value, signal };
  for (const processor of measuredProcessors(first.value, request, types)) {
    const made = await measure(pass, measured, processor.id);
    if (!made.ok) return made;
    measured.set(processor.id, made.value);
  }
  const running = automatedRun(
    lanes.value,
    request.start,
    build,
    (built) => built.output,
    implementations,
    request,
  );
  return mapResult(running, (value) => new RunningChain(value, descriptors));
}

/**
 * A run of `request`'s chain over a live input, or why it cannot be one
 * (ADR-0070). Only a chain heard live runs: it has no processor that measures
 * its whole input, so no pass is needed, and none whose kernel cannot keep to
 * the audio thread's schedule, which monitoring runs on. A live input was not
 * the stream the chain was planned over, so the chain is checked against it
 * as planning checks one, every state a processor needs included, rather than
 * a processor lacking its state running as if it were not there. The graph is
 * built as for a run from a stream's first frame, which is the input's first.
 */
function prepareLive(
  request: LiveChainRequest,
  types: ReadonlyMap<string, ProcessorType>,
  implementations: NodeImplementations,
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
): DomainResult<ChainRun> {
  const built = graphBeforePasses(request, types);
  if (!built.ok) return built;
  const heard = listening(request, descriptors);
  if (heard.kind !== 'live') return refused('chain-not-live', heard.reason);
  const checked = chainOutputLayout(request.chain, descriptors, request.input, request.sampleRate);
  if (!checked.ok) return checked;
  const running = compiledRun(built.value, built.value.output, implementations, request);
  if (!running.ok) return running;
  return succeed(new RunningChain(running.value, descriptorsOf(request, types)));
}

/** What every pass of one preparation is made with. */
interface PassSettings {
  readonly request: ChainRequest;
  readonly read: StreamReader;
  readonly types: ReadonlyMap<string, ProcessorType>;
  readonly implementations: NodeImplementations;
  /** The chain's automation, which a pass runs as the run will. */
  readonly lanes: readonly AutomationLane[];
  readonly signal: CancellationSignal | undefined;
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
  pass: PassSettings,
  measured: ReadonlyMap<ProcessorId, Measurement>,
  processor: ProcessorId,
): Promise<DomainResult<Measurement>> {
  const { request, read, types, implementations, lanes, signal } = pass;
  // A pass reads the stream from its first frame, whatever frame the run it
  // is made for starts at.
  const build = (starting: ChainGraphRun['starting']) =>
    chainGraph(request.chain, types, request.input, request.quality, {
      start: 0,
      measured,
      at: processor,
      ...(starting === undefined ? {} : { starting }),
    });
  const built = build(undefined);
  if (!built.ok) return built;
  const tap = built.value.measure;
  if (tap === undefined) throw new Error('A graph built to measure a processor has its tap.');
  const type = [...types.values()].find((one) => one.type === tap.type);
  const measurer = type?.measurer?.(tap.settings, tap.layout, request);
  if (measurer === undefined) throw new Error('A processor measured in a pass has a measurer.');
  if (!measurer.ok) return measurer;
  const running = automatedRun(lanes, 0, build, () => tap.sink, implementations, request);
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
