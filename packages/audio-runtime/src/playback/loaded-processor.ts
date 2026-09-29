/**
 * One graph in the engine processor: the node made for it, the link to it,
 * the channel between it and the feeder, its runs, and the processor's answer
 * to its `load`.
 *
 * The answer is waited for a bounded time. A message the worklet cannot take
 * can vanish without an error on the main thread, as a compiled WebAssembly
 * module in a message to Chromium's AudioWorklet did, and a load that waits
 * for ever leaves the person with nothing to press. The bound,
 * {@link LOAD_ANSWER_MILLISECONDS}, is far past what a load costs, compiling
 * a graph and about 36 KB of WebAssembly in milliseconds, and short enough
 * that the person is told why rather than left waiting.
 */

import { channelCount, type DomainFailureResult } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { GraphDescriptor } from '@audiogubbins/audio-graph';

import type { AudioContextPort } from '../context/audio-context-port.js';
import { sendToDevice } from '../context/device-channels.js';
import type { Schedule } from '../schedule.js';
import { ENGINE_PROCESSOR_NAME } from '../processor/engine-processor-name.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import { ToFeederKind } from '../protocol/feeder-messages.js';
import {
  FromProcessorKind,
  ToProcessorKind,
  type FromProcessor,
} from '../protocol/processor-messages.js';
import { EngineLink } from './engine-link.js';
import type { FeederLink } from './feeder-link.js';
import { PlaybackDspKind, type PlaybackDsp } from './playback-dsp.js';
import type { PreparedPlayback } from './playback-preparation.js';
import type { DspStatus } from './playback-status.js';
import { ProcessorRuns } from './processor-runs.js';

/** How long a load waits for the processor's answer. */
const LOAD_ANSWER_MILLISECONDS = 10_000;

/**
 * How often the processor reports: about thirty times a second, as often as
 * a display redraws a meter usefully and often enough to anchor the playhead.
 */
const REPORTS_PER_SECOND = 30;

/** The two ends of a message channel, as `MessageChannel` makes them. */
export interface ChannelEnds {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}

/** How a load ended. */
export type LoadOutcome =
  | {
      readonly kind: 'loaded';
      readonly dsp: DspStatus;
      readonly latencyFrames: number | undefined;
    }
  | { readonly kind: 'refused'; readonly reasons: readonly string[] }
  | { readonly kind: 'unanswered' }
  /** Ended from outside, by a later load, a lost context or a fault, for the reason given. */
  | { readonly kind: 'abandoned'; readonly failure: DomainFailureResult };

/** The feeder of a graph's inputs, and the request whose sources it feeds them from. */
export interface GraphFeeder {
  readonly link: FeederLink;
  readonly request: number;
  /** Makes the channel between the feeder and the processor. */
  readonly createChannel: () => ChannelEnds;
}

/** What a loaded processor is made with. */
export interface LoadedProcessorOptions {
  readonly port: AudioContextPort;
  readonly graph: GraphDescriptor;
  readonly prepared: PreparedPlayback;
  readonly dsp: PlaybackDsp;
  /** The feeder, where the graph has graph inputs to feed. */
  readonly feeder: GraphFeeder | undefined;
  readonly schedule: Schedule;
  readonly logger: Logger;
}

/**
 * Binds the feeder to a graph's feeds, handing it one end of a new channel,
 * and answers the other end, for the processor.
 */
function bindFeeder(feeder: GraphFeeder, prepared: PreparedPlayback): MessagePort {
  const channel = feeder.createChannel();
  feeder.link.send(
    {
      kind: ToFeederKind.Bind,
      request: feeder.request,
      feeds: prepared.feeds.feeder,
      feedAheadMilliseconds: prepared.feedPlan.feedAheadMilliseconds,
      chunkFrames: prepared.feedPlan.chunkFrames,
      wakeMilliseconds: prepared.feedPlan.wakeMilliseconds,
      processor: channel.port1,
    },
    [channel.port1],
  );
  return channel.port2;
}

/** A graph in the engine processor. */
export class LoadedProcessor {
  readonly link: EngineLink;
  readonly runs: ProcessorRuns;
  readonly prepared: PreparedPlayback;
  /** Settles once, with how the load ended. */
  readonly outcome: Promise<LoadOutcome>;
  readonly #feeder: FeederLink | undefined;
  #settle: (outcome: LoadOutcome) => void = () => undefined;
  #replied: (reply: FromProcessor) => void = () => undefined;
  #settled = false;
  readonly #cancelWait: () => void;

  /** Makes the node, connects it, binds the feeder to it, and sends it the graph. */
  constructor(options: LoadedProcessorOptions) {
    const { port, prepared, schedule, logger, feeder } = options;
    this.prepared = prepared;
    this.outcome = new Promise<LoadOutcome>((resolve) => {
      this.#settle = resolve;
    });
    const node = port.createWorkletNode(ENGINE_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount(prepared.sinkLayout)],
    });
    sendToDevice(port.destination, prepared.device);
    node.connect(port.destination, prepared.device.outputChannelOf);
    this.link = new EngineLink(node, logger);
    const feeding = prepared.feeds.any ? feeder : undefined;
    this.#feeder = feeding?.link;
    this.runs = new ProcessorRuns({ link: this.link, feeder: this.#feeder });
    this.link.subscribe(this.#reply);
    this.#cancelWait = schedule(() => {
      logger.error('The audio processor did not answer the load in time.');
      this.#end({ kind: 'unanswered' });
    }, LOAD_ANSWER_MILLISECONDS);
    const feederPort = feeding === undefined ? undefined : bindFeeder(feeding, prepared);
    this.link.send(
      {
        kind: ToProcessorKind.Load,
        graph: options.graph,
        dspModuleBytes:
          options.dsp.kind === PlaybackDspKind.Compiled ? options.dsp.bytes : undefined,
        dspUnavailable:
          options.dsp.kind === PlaybackDspKind.Unavailable ? options.dsp.reason : undefined,
        feeds: prepared.feeds.processor,
        reportEveryBlocks: Math.max(
          1,
          Math.round(port.sampleRate / RENDER_QUANTUM_FRAMES / REPORTS_PER_SECOND),
        ),
        feeder: feederPort,
      },
      feederPort === undefined ? [] : [feederPort],
    );
  }

  /**
   * Hears every reply but the answer to the load. A port delivers a reply as
   * a task of its own, never inside the call that made the node, so a
   * listener set just after construction hears every one.
   */
  onReply(listener: (reply: FromProcessor) => void): void {
    this.#replied = listener;
  }

  /** Ends a load still waiting, for `failure`; a load already answered is left as it was. */
  abandon(failure: DomainFailureResult): void {
    this.#end({ kind: 'abandoned', failure });
  }

  /** Stops the runs and the wait, unbinds the feeder, and lets go of the node. */
  dispose(): void {
    this.runs.abandon();
    this.#cancelWait();
    this.#feeder?.send({ kind: ToFeederKind.Unbind });
    this.link.dispose();
  }

  readonly #reply = (reply: FromProcessor): void => {
    switch (reply.kind) {
      case FromProcessorKind.Loaded:
        this.#end({
          kind: 'loaded',
          dsp: {
            implementation: reply.dsp,
            fallbackReason: reply.dspFallbackReason,
            inUse: reply.dspInUse,
          },
          latencyFrames: reply.latencyFrames,
        });
        return;
      case FromProcessorKind.Refused:
        this.#end({ kind: 'refused', reasons: reply.reasons });
        return;
      default:
        this.#replied(reply);
    }
  };

  #end(outcome: LoadOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#cancelWait();
    this.#settle(outcome);
  }
}
