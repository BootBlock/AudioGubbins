/**
 * The engine's AudioWorklet processor, apart from the worklet: what it does
 * with each message and each render quantum.
 *
 * Kept out of the worklet's module so it runs in a Node test, which the
 * AudioWorkletGlobalScope cannot (`threads/engine-processor.ts` is the thin
 * shell that registers it). It reads every message with the protocol's reader
 * and never throws out of `receive` or `process`: the audio thread has no one
 * to catch it. Messages come on two ports: the main thread's, with the graph
 * and the transport's commands, and the feeder worker's, with the audio.
 *
 * It counts where playback is, since only the audio thread knows
 * (`playback-count.ts`). A quantum runs the graph only when every feed can
 * supply the whole of it, or has ended; one that cannot is an underrun,
 * output as silence with nothing consumed, so the count stops with the audio
 * and goes on with it. It sends the count when it starts, in every report,
 * when it halts and when the last frame is out, and the main thread's
 * transport takes it from there.
 *
 * A halt keeps everything: the graph's history, its delay lines and the feeds'
 * queued audio, so the next start of the same audio goes on with the very next
 * frame, and every frame is played once however often playback pauses. A start
 * of other audio, after a seek or a stop, waits for the feeder's rewind to it
 * on the feeder's channel, since the feeds' old audio is gone only then, and
 * makes the graph again.
 *
 * A quantum allocates nothing while the graph runs steadily. The feeds, the
 * executor, the sink's target and the meters' windows are all made at a load,
 * and a quantum only runs them and reads their counts. A message is posted
 * only at an event: a start, a halt, the end, a fault, a posted block read
 * whole, and a report at the rate the load asked for, which is the steady
 * allocation.
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
  type CountedPosition,
  type FromProcessor,
  type ToProcessor,
} from '../protocol/processor-messages.js';
import {
  ToProcessorFeedKind,
  readToProcessorFeed,
  type FromProcessorFeed,
  type ToProcessorFeed,
} from '../protocol/feed-messages.js';
import { RENDER_QUANTUM_FRAMES, loadGraph, type LoadedGraph } from './loaded-graph.js';
import { PlaybackCount } from './playback-count.js';
import { ProcessorFeeds } from './processor-feeds.js';
import { ReportWindow } from './report-window.js';

/** Where the processor stands between two quanta. */
const Mode = {
  /** Loaded, or nothing loaded, and outputting silence with its state kept. */
  Halted: 'halted',
  /** Told to start, and starting at the next quantum it can. */
  Starting: 'starting',
  Running: 'running',
  /** Stopped by a fault, outputting silence until the next load. */
  Faulted: 'faulted',
} as const;

type Mode = (typeof Mode)[keyof typeof Mode];

/** A graph the processor runs, and the executor it runs it with. */
interface Running {
  readonly graph: LoadedGraph;
  executor: GraphExecutor;
  /** Whether the executor has run since it was made, and so holds history. */
  ran: boolean;
}

/** A start of other audio than the processor holds, waiting for the feeds' rewind to it. */
interface FreshStart {
  readonly epoch: number;
  readonly from: number;
}

export interface EngineProcessorOptions {
  /** The context's rate, as the worklet's global scope gives it. */
  readonly sampleRate: number;
  readonly post: (message: FromProcessor) => void;

  /**
   * Listens to the processor's end of the channel to the feeder, handing what
   * arrives to {@link EngineProcessorCore.receiveFeed}, or stops listening to
   * the last one where given none.
   */
  readonly connectFeeder: (port: MessagePort | undefined) => void;

  /** Posts to the feeder, on the channel last connected. */
  readonly postToFeeder: (message: FromProcessorFeed) => void;

  /**
   * The node types graphs are run with. The built-in ones in production; a
   * test gives others only to make a kernel fail, which no built-in node does
   * on demand.
   */
  readonly implementations?: NodeImplementations;
}

/** The processor's logic, driven by the worklet's messages and quanta. */
export class EngineProcessorCore {
  readonly #options: EngineProcessorOptions;
  readonly #rate: number;
  readonly #implementations: NodeImplementations;
  #mode: Mode = Mode.Halted;
  #loaded: Running | undefined;

  /** The run the main thread named when it last started the processor. */
  #run = 0;
  #fresh: FreshStart | undefined;

  readonly #feeds: ProcessorFeeds;

  /** The run whose audio the graph and the count are of. */
  #playEpoch = 0;
  readonly #count = new PlaybackCount();
  readonly #reports = new ReportWindow();
  #endReported = false;

  /** The context frame of the quantum after the last one rendered. */
  #nextFrame = 0;

  constructor(options: EngineProcessorOptions) {
    this.#options = options;
    this.#rate = options.sampleRate;
    this.#implementations = options.implementations ?? BUILT_IN_NODES;
    this.#feeds = new ProcessorFeeds(options.postToFeeder);
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

  /** Acts on a message from the feeder, whatever arrived. */
  receiveFeed(data: unknown): void {
    const read = readToProcessorFeed(data);
    if (!read.ok) {
      this.#fault(`A message from the feeder could not be read: ${read.failures[0].summary}`);
      return;
    }
    this.#fromFeeder(read.value);
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

  /** Hears that a message from the feeder could not be received: audio is lost. */
  feedMessageFailed(): void {
    this.#fault(
      'Audio from the feeder could not be received by the audio processor, so what it plays is in doubt.',
    );
  }

  /**
   * Renders one quantum into `output`, one array per channel, the quantum
   * starting at context frame `currentFrame`. Writes every sample.
   */
  process(output: readonly Float32Array[], currentFrame: number): void {
    this.#nextFrame = currentFrame;
    const loaded = this.#loaded;
    if (loaded === undefined || !this.#begin(loaded)) {
      this.#nextFrame = currentFrame + RENDER_QUANTUM_FRAMES;
      silence(output);
      return;
    }
    const ran = this.#render(loaded, output);
    this.#nextFrame = currentFrame + RENDER_QUANTUM_FRAMES;
    if (!ran) return;
    this.#observeEnd(loaded.graph);
    this.#report(loaded.graph);
  }

  /** Whether the processor runs this quantum, starting a run that was waiting for it. */
  #begin(loaded: Running): boolean {
    if (this.#mode === Mode.Running) return true;
    if (this.#mode !== Mode.Starting) return false;
    const { graph } = loaded;
    const fresh = this.#fresh;
    if (fresh !== undefined) {
      // Other audio waits for the feeds' rewind to it, which the feeder sends
      // on its own channel and may land after the start.
      if (this.#feeds.any && this.#feeds.epoch !== fresh.epoch) return false;
      this.#fresh = undefined;
      if (!this.#startAfresh(loaded, fresh)) return false;
    }
    this.#mode = Mode.Running;
    this.#post({ kind: FromProcessorKind.Started, run: this.#run, ...this.#counted(graph) });
    return true;
  }

  /** Makes the graph again, if it has run, and counts from where the new audio begins. */
  #startAfresh(loaded: Running, fresh: FreshStart): boolean {
    const { graph } = loaded;
    if (loaded.ran) {
      // Allocates on the audio thread: the graph's delay lines and kernels hold
      // the old audio, and making them anew is the one way to be sure none of
      // it is heard. Acceptable at a seek or a stop, which the person asked
      // for, and never in a quantum of steady playing.
      loaded.executor.release();
      const executor = createExecutor(graph.plan, this.#implementations, graph.context);
      if (!executor.ok) {
        this.#loaded = undefined;
        this.#fault(`The graph could not be made again: ${executor.failures[0].summary}`);
        return false;
      }
      loaded.executor = executor.value;
      loaded.ran = false;
    }
    this.#reports.clear(graph.meters);
    this.#playEpoch = fresh.epoch;
    this.#count.restart(fresh.from);
    this.#endReported = false;
    return true;
  }

  /**
   * Runs the graph into `output` where every feed can supply the quantum, or
   * outputs silence and counts an underrun where one cannot. Answers whether
   * the processor is still running, which a fault ends.
   */
  #render(loaded: Running, output: readonly Float32Array[]): boolean {
    const { graph } = loaded;
    const frames = output[0]?.length ?? RENDER_QUANTUM_FRAMES;
    if (frames !== RENDER_QUANTUM_FRAMES) {
      this.#fault(
        `The render quantum is ${String(frames)} frames; the processor runs ${String(RENDER_QUANTUM_FRAMES)}.`,
      );
      silence(output);
      return false;
    }
    if (!this.#feeds.ready(RENDER_QUANTUM_FRAMES)) {
      this.#reports.underran(RENDER_QUANTUM_FRAMES);
      silence(output);
      return true;
    }
    this.#feeds.beginQuantum();
    graph.output.renderInto(output);
    try {
      loaded.executor.process(RENDER_QUANTUM_FRAMES);
    } catch (error) {
      // Processing reports a fault in no other way: a kernel that cannot go on
      // throws, and nothing above the audio thread would catch it.
      this.#fault(`Processing stopped: ${error instanceof Error ? error.message : String(error)}`);
      silence(output);
      return false;
    }
    loaded.ran = true;
    this.#count.ran(RENDER_QUANTUM_FRAMES, this.#feeds.supplied());
    return true;
  }

  /** Says once that every feed has ended, when its last frame has left the graph. */
  #observeEnd(graph: LoadedGraph): void {
    if (this.#endReported || !this.#feeds.finished) return;
    if (!this.#count.heardEnd(graph.tailFrames)) return;
    this.#endReported = true;
    this.#post({ kind: FromProcessorKind.FeedsEnded, run: this.#run, ...this.#counted(graph) });
  }

  /** Where playback is, as of the next quantum (`playback-count.ts`). */
  #counted(graph: LoadedGraph): CountedPosition {
    return this.#count.at(this.#nextFrame, graph.tailFrames, this.#feeds.finished);
  }

  /** Every so many quanta, the count, the underruns since the last, and every meter, in one message. */
  #report(graph: LoadedGraph): void {
    if (!this.#reports.due(graph.reportEveryBlocks)) return;
    this.#post({
      kind: FromProcessorKind.Report,
      run: this.#run,
      ...this.#counted(graph),
      ...this.#reports.take(graph.meters),
    });
  }

  #act(message: ToProcessor): void {
    switch (message.kind) {
      case ToProcessorKind.Load:
        this.#load(message);
        return;
      case ToProcessorKind.Start:
        this.#start(message.run, { epoch: message.epoch, from: message.from });
        return;
      case ToProcessorKind.Halt:
        this.#halt();
        return;
      case ToProcessorKind.SetParameter:
        this.#setParameter(message.node, message.name, message.value);
        return;
    }
  }

  #fromFeeder(message: ToProcessorFeed): void {
    if (this.#mode === Mode.Faulted) return;
    if (message.kind === ToProcessorFeedKind.Rewind) {
      this.#rewind(message.epoch);
      return;
    }
    const refused = this.#feeds.take(message);
    if (refused !== undefined) this.#fault(refused);
  }

  /**
   * The feeds' audio from here on is run `epoch`'s. What they held is dropped,
   * and a run playing it halts: the main thread has already told it to, on its
   * own port, which may land later.
   */
  #rewind(epoch: number): void {
    this.#feeds.rewind(epoch);
    if (
      this.#mode === Mode.Running ||
      (this.#mode === Mode.Starting && this.#fresh === undefined)
    ) {
      this.#mode = Mode.Halted;
    }
  }

  #load(message: Extract<ToProcessor, { readonly kind: typeof ToProcessorKind.Load }>): void {
    this.#loaded?.executor.release();
    this.#loaded = undefined;
    this.#mode = Mode.Halted;
    this.#fresh = undefined;
    this.#playEpoch = 0;
    this.#options.connectFeeder(message.feeder);
    const loading = loadGraph(message, this.#rate, this.#implementations);
    this.#feeds.bind(loading.ok ? loading.graph : undefined);
    if (!loading.ok) {
      this.#post({ kind: FromProcessorKind.Refused, reasons: loading.reasons });
      return;
    }
    this.#loaded = { graph: loading.graph, executor: loading.executor, ran: false };
    this.#post({
      kind: FromProcessorKind.Loaded,
      dsp: loading.graph.dsp.dsp.implementation,
      dspFallbackReason: loading.graph.dsp.fallbackReason,
      dspInUse: loading.graph.dspUsed(),
      latencyFrames: loading.graph.latencyFrames,
    });
  }

  /**
   * Sets a node's parameter, or says why the node refused it. A refusal
   * leaves the parameter as it was and playing goes on; see the module's
   * comment. With nothing loaded there is no node to refuse it.
   */
  #setParameter(node: NodeId, name: string, value: number): void {
    const set = this.#loaded?.executor.setParameter(node, name, value);
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

  /** Starts run `run`: going on with the audio it holds where that is `start`'s, afresh otherwise. */
  #start(run: number, start: FreshStart): void {
    if (this.#mode !== Mode.Halted) return;
    this.#run = run;
    if (this.#loaded === undefined) {
      this.#fault('Nothing is loaded to start.');
      return;
    }
    this.#fresh = start.epoch === this.#playEpoch && this.#playEpoch !== 0 ? undefined : start;
    this.#mode = Mode.Starting;
  }

  /** Halts where it is, keeping everything, and says where that is. */
  #halt(): void {
    const loaded = this.#loaded;
    if (loaded === undefined || this.#mode === Mode.Faulted) return;
    if (this.#mode === Mode.Starting || this.#mode === Mode.Running) this.#mode = Mode.Halted;
    this.#fresh = undefined;
    this.#post({
      kind: FromProcessorKind.Halted,
      run: this.#run,
      ...this.#counted(loaded.graph),
    });
  }

  #post(message: FromProcessor): void {
    this.#options.post(message);
  }

  /** Stops processing and says why, once: what follows a fault is its consequence. */
  #fault(message: string): void {
    if (this.#mode === Mode.Faulted) return;
    this.#mode = Mode.Faulted;
    this.#fresh = undefined;
    this.#post({ kind: FromProcessorKind.Fault, message });
  }
}

function silence(output: readonly Float32Array[]): void {
  for (const channel of output) channel.fill(0);
}
