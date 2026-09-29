/**
 * The engine's AudioWorklet processor, apart from the worklet: what it does
 * with each message and each render quantum.
 *
 * Kept out of the worklet's module so it runs in a Node test, which the
 * AudioWorkletGlobalScope cannot (`threads/engine-processor.ts` is the thin
 * shell that registers it). It reads every message with the protocol's reader
 * and never throws out of `receive` or `process`: the audio thread has no one
 * to catch it.
 *
 * A quantum allocates nothing while the graph runs steadily. The feeds, the
 * executor, the sink's target and the meters' windows are all made at a load,
 * and a quantum only runs them and reads their counts. A message is posted
 * only at an event: a start, an underrun, the end, a fault, and a meter report
 * at the rate the load asked for, which is the one steady allocation.
 *
 * A fault means processing stopped. The processor outputs silence from then
 * until the next `load`, and says why once. A kernel's throw is one, and so is
 * a message the processor cannot act on, since either leaves the audio it
 * would play in doubt. A refused parameter is not: the node keeps the value it
 * had and the audio stays whole, so the processor says which parameter and
 * why, and plays on.
 *
 * Each run is named by its `start`, and every reply about a run carries the
 * name back, because replies cross while the main thread moves on: a
 * `started` or an end posted just before a halt arrived must not be taken for
 * the run the main thread started after it.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  createExecutor,
  type GraphExecutor,
  type NodeImplementations,
} from '@audiogubbins/audio-engine';

import {
  FromProcessorKind,
  ToProcessorKind,
  readToProcessor,
  type FromProcessor,
  type ToProcessor,
} from '../protocol/processor-messages.js';
import type { PostedFeed } from '../feed/posted-feed.js';
import { RENDER_QUANTUM_FRAMES, loadGraph, type LoadedGraph } from './loaded-graph.js';
import type { MeterReport } from './meter-window.js';

/** Where the processor stands between two quanta. */
const Mode = {
  /** Loaded, or nothing loaded, and outputting silence with its state kept. */
  Halted: 'halted',
  /** Told to start, and starting at the next quantum. */
  Starting: 'starting',
  Running: 'running',
  /** Stopped by a fault, outputting silence until the next load. */
  Faulted: 'faulted',
} as const;

type Mode = (typeof Mode)[keyof typeof Mode];

export interface EngineProcessorOptions {
  /** The context's rate, as the worklet's global scope gives it. */
  readonly sampleRate: number;
  readonly post: (message: FromProcessor) => void;

  /**
   * The node types graphs are run with. The built-in ones in production; a
   * test gives others only to make a kernel fail, which no built-in node does
   * on demand.
   */
  readonly implementations?: NodeImplementations;
}

/** The processor's logic, driven by the worklet's messages and quanta. */
export class EngineProcessorCore {
  readonly #rate: number;
  readonly #post: (message: FromProcessor) => void;
  readonly #implementations: NodeImplementations;
  #mode: Mode = Mode.Halted;
  #graph: LoadedGraph | undefined;
  #executor: GraphExecutor | undefined;

  /** The context frame after the last frame any feed supplied. */
  #audioEnd = 0;

  /** The context frame of the quantum after the last one rendered. */
  #nextFrame = 0;
  #endReported = false;

  /** The run the main thread named when it last started the processor. */
  #run = 0;
  #blocksSinceReport = 0;

  constructor(options: EngineProcessorOptions) {
    this.#rate = options.sampleRate;
    this.#post = options.post;
    this.#implementations = options.implementations ?? BUILT_IN_NODES;
  }

  /** Acts on a message from the main thread, whatever arrived. */
  receive(data: unknown): void {
    const read = readToProcessor(data);
    if (!read.ok) {
      this.#fault(`A message could not be read: ${read.failures[0].summary}`);
      return;
    }
    this.#act(read.value);
  }

  /**
   * Hears that a message sent to it could not be received, which the port
   * reports as `messageerror` rather than a message: whatever it said is lost,
   * so what the processor plays is in doubt, as with a message it cannot read.
   */
  messageFailed(): void {
    this.#fault(
      'A message from the main thread could not be received by the audio processor, so what it plays is in doubt.',
    );
  }

  /**
   * Renders one quantum into `output`, one array per channel, the quantum
   * starting at context frame `currentFrame`. Writes every sample.
   */
  process(output: readonly Float32Array[], currentFrame: number): void {
    this.#nextFrame = currentFrame + RENDER_QUANTUM_FRAMES;
    const graph = this.#graph;
    const executor = this.#executor;
    if (
      graph === undefined ||
      executor === undefined ||
      (this.#mode !== Mode.Starting && this.#mode !== Mode.Running)
    ) {
      silence(output);
      return;
    }
    if (this.#mode === Mode.Starting) {
      this.#mode = Mode.Running;
      this.#audioEnd = Math.max(this.#audioEnd, currentFrame);
      this.#post({ kind: FromProcessorKind.Started, run: this.#run, contextFrame: currentFrame });
    }
    if (!this.#render(graph, executor, output)) return;
    this.#observeFeeds(graph, currentFrame);
    this.#reportMeters(graph);
  }

  /** Runs the graph into `output`, or faults and silences it; answers whether it ran. */
  #render(graph: LoadedGraph, executor: GraphExecutor, output: readonly Float32Array[]): boolean {
    for (const feed of graph.feeds) feed.beginQuantum();
    const frames = output[0]?.length ?? RENDER_QUANTUM_FRAMES;
    if (frames !== RENDER_QUANTUM_FRAMES) {
      this.#fault(
        `The render quantum is ${String(frames)} frames; the processor runs ${String(RENDER_QUANTUM_FRAMES)}.`,
      );
      silence(output);
      return false;
    }
    graph.output.renderInto(output);
    try {
      executor.process(RENDER_QUANTUM_FRAMES);
      return true;
    } catch (error) {
      // Processing reports a fault in no other way: a kernel that cannot go on
      // throws, and nothing above the audio thread would catch it.
      this.#fault(`Processing stopped: ${error instanceof Error ? error.message : String(error)}`);
      silence(output);
      return false;
    }
  }

  /** Reports an underrun in the quantum just rendered, and the end of every feed once it is heard. */
  #observeFeeds(graph: LoadedGraph, currentFrame: number): void {
    let shortFrames = 0;
    let allFinished = graph.feeds.length > 0;
    for (const feed of graph.feeds) {
      // The frames of the quantum that went short, whichever feed it was.
      shortFrames = Math.max(shortFrames, feed.shortFrames);
      if (feed.suppliedFrames > 0) {
        this.#audioEnd = Math.max(this.#audioEnd, currentFrame + feed.suppliedFrames);
      }
      if (!feed.finished) allFinished = false;
    }
    if (shortFrames > 0) {
      this.#post({
        kind: FromProcessorKind.Underrun,
        run: this.#run,
        contextFrame: currentFrame,
        frames: shortFrames,
      });
    }
    // A graph with no feed, such as a tone, never ends by itself.
    const heard = this.#audioEnd + graph.tailFrames;
    if (allFinished && !this.#endReported && heard <= this.#nextFrame) {
      this.#endReported = true;
      this.#post({ kind: FromProcessorKind.FeedsEnded, run: this.#run, contextFrame: heard });
    }
  }

  #reportMeters(graph: LoadedGraph): void {
    if (graph.meters.length === 0) return;
    this.#blocksSinceReport += 1;
    if (this.#blocksSinceReport < graph.meterEveryBlocks) return;
    this.#blocksSinceReport = 0;
    for (const meter of graph.meters) this.#postMeter(meter.node, meter.window.take());
  }

  #postMeter(node: NodeId, report: MeterReport | undefined): void {
    if (report === undefined) return;
    this.#post({ kind: FromProcessorKind.Meter, node, peak: report.peak, rms: report.rms });
  }

  #act(message: ToProcessor): void {
    switch (message.kind) {
      case ToProcessorKind.Load:
        this.#load(message);
        return;
      case ToProcessorKind.FeedBlock: {
        const feed = this.#postedFeed(message.node);
        if (feed === undefined) return;
        const pushed = feed.push(message.channels);
        if (!pushed.ok) this.#fault(`${message.node}: ${pushed.failures[0].summary}`);
        return;
      }
      case ToProcessorKind.FeedEnd:
        this.#postedFeed(message.node)?.end();
        return;
      case ToProcessorKind.Start:
        this.#start(message.run);
        return;
      case ToProcessorKind.Halt:
        if (this.#mode === Mode.Starting || this.#mode === Mode.Running) this.#mode = Mode.Halted;
        return;
      case ToProcessorKind.Reset:
        this.#reset();
        return;
      case ToProcessorKind.SetParameter:
        this.#setParameter(message.node, message.name, message.value);
        return;
    }
  }

  /** The posted feed of a graph input, or a fault where there is none to take its audio. */
  #postedFeed(node: NodeId): PostedFeed | undefined {
    if (this.#mode === Mode.Faulted) return undefined;
    const feed = this.#graph?.posted.get(node);
    if (feed === undefined) this.#fault(`No posted feed is bound to ${node} to take its audio.`);
    return feed;
  }

  #load(message: Extract<ToProcessor, { readonly kind: typeof ToProcessorKind.Load }>): void {
    this.#executor?.release();
    this.#executor = undefined;
    this.#graph = undefined;
    this.#mode = Mode.Halted;
    this.#restart();
    const loading = loadGraph(message, this.#rate, this.#implementations);
    if (!loading.ok) {
      this.#post({ kind: FromProcessorKind.Refused, reasons: loading.reasons });
      return;
    }
    this.#graph = loading.graph;
    this.#executor = loading.executor;
    this.#post({
      kind: FromProcessorKind.Loaded,
      dsp: loading.graph.dsp.dsp.implementation,
      dspFallbackReason: loading.graph.dsp.fallbackReason,
      latencyFrames: loading.graph.latencyFrames,
    });
  }

  /**
   * Sets a node's parameter, or says why the node refused it. A refusal
   * leaves the parameter as it was and playing goes on; see the module's
   * comment. With nothing loaded there is no node to refuse it.
   */
  #setParameter(node: NodeId, name: string, value: number): void {
    const set = this.#executor?.setParameter(node, name, value);
    if (set === undefined || set.ok) return;
    this.#post({
      kind: FromProcessorKind.ParameterRefused,
      node,
      name,
      // The code and summary alone: a failure's details and cause may hold what
      // a structured clone cannot carry, and the main thread shows the summary.
      failures: [
        { code: set.failures[0].code, summary: set.failures[0].summary },
        ...set.failures.slice(1).map(({ code, summary }) => ({ code, summary })),
      ],
    });
  }

  #start(run: number): void {
    if (this.#mode !== Mode.Halted) return;
    this.#run = run;
    if (this.#graph === undefined) {
      this.#fault('Nothing is loaded to start.');
      return;
    }
    this.#mode = Mode.Starting;
  }

  /**
   * Discards every feed's queued audio and the graph's history. The executor
   * is made again, which allocates on the audio thread: its delay lines and
   * kernels hold the old position's audio, and making them anew is the one
   * way to be sure none of it is heard. That is acceptable at a seek, which
   * the person asked for and which is silent while it happens, and never in a
   * quantum.
   */
  #reset(): void {
    const graph = this.#graph;
    if (graph === undefined || this.#mode === Mode.Faulted) return;
    for (const feed of graph.feeds) feed.clear();
    for (const meter of graph.meters) meter.window.clear();
    this.#executor?.release();
    const executor = createExecutor(graph.plan, this.#implementations, graph.context);
    this.#restart();
    if (!executor.ok) {
      this.#executor = undefined;
      this.#fault(`The graph could not be made again: ${executor.failures[0].summary}`);
      return;
    }
    this.#executor = executor.value;
  }

  /** Forgets where the feeds' audio ended and the meters' count, for a new stream of audio. */
  #restart(): void {
    this.#audioEnd = this.#nextFrame;
    this.#endReported = false;
    this.#blocksSinceReport = 0;
  }

  /** Stops processing and says why, once: what follows a fault is its consequence. */
  #fault(message: string): void {
    if (this.#mode === Mode.Faulted) return;
    this.#mode = Mode.Faulted;
    this.#post({ kind: FromProcessorKind.Fault, message });
  }
}

function silence(output: readonly Float32Array[]): void {
  for (const channel of output) channel.fill(0);
}
