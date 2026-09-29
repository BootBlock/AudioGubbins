/**
 * One graph in the engine processor: the node made for it, the link to it,
 * its runs, and the processor's answer to its `load`.
 *
 * The answer is waited for a bounded time. A message the worklet cannot take
 * can vanish without an error on the main thread, as a compiled WebAssembly
 * module in a message to Chromium's AudioWorklet did, and a load that waits
 * for ever leaves the person with nothing to press. The bound,
 * {@link LOAD_ANSWER_MILLISECONDS}, is far past what a load costs, compiling
 * a graph and about 36 KB of WebAssembly in milliseconds, and short enough
 * that the person is told why rather than left waiting.
 */

import type { DomainFailureResult } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';

import type { AudioContextPort } from '../context/audio-context-port.js';
import type { Schedule } from '../schedule.js';
import { ENGINE_PROCESSOR_NAME } from '../processor/engine-processor-name.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import {
  FromProcessorKind,
  ToProcessorKind,
  type FromProcessor,
} from '../protocol/processor-messages.js';
import { EngineLink } from './engine-link.js';
import type { PreparedPlayback } from './playback-preparation.js';
import { frameOf } from './playback-state.js';
import type { DspStatus } from './playback-status.js';
import { ProcessorRuns } from './processor-runs.js';

/** How long a load waits for the processor's answer. */
const LOAD_ANSWER_MILLISECONDS = 10_000;

/** How often meters report: about thirty times a second, as often as a display redraws them usefully. */
const METER_REPORTS_PER_SECOND = 30;

/** Where the worklet's canonical DSP comes from. */
export const WorkletDspKind = {
  /** The module's bytes, which the processor compiles in the worklet. */
  Bytes: 'bytes',
  /** No module, and why, which the processor reports as its fallback reason. */
  Unavailable: 'unavailable',
} as const;

/**
 * Where the worklet's canonical DSP comes from: the module's bytes, kept by
 * the caller and copied into each load, or why there are none.
 */
export type WorkletDsp =
  | { readonly kind: typeof WorkletDspKind.Bytes; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly kind: typeof WorkletDspKind.Unavailable; readonly reason: string };

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

/** What a loaded processor is made with. */
export interface LoadedProcessorOptions {
  readonly port: AudioContextPort;
  readonly graph: GraphDescriptor;
  readonly prepared: PreparedPlayback;
  readonly dsp: WorkletDsp;
  readonly schedule: Schedule;
  readonly logger: Logger;
  /** Hears a feed whose source failed to read. */
  readonly feedFailed: (node: NodeId, error: unknown) => void;
}

/** A graph in the engine processor. */
export class LoadedProcessor {
  readonly link: EngineLink;
  readonly runs: ProcessorRuns;
  /** The frames the graph adds before its output: its latency, or the part of it known. */
  readonly graphLatencyFrames: number;
  /** Settles once, with how the load ended. */
  readonly outcome: Promise<LoadOutcome>;
  #settle: (outcome: LoadOutcome) => void = () => undefined;
  #replied: (reply: FromProcessor) => void = () => undefined;
  #settled = false;
  readonly #cancelWait: () => void;

  /** Makes the node, connects it, and sends it the graph. */
  constructor(options: LoadedProcessorOptions) {
    const { port, prepared, schedule, logger } = options;
    this.outcome = new Promise<LoadOutcome>((resolve) => {
      this.#settle = resolve;
    });
    const node = port.createWorkletNode(ENGINE_PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [prepared.sinkChannels],
    });
    node.connect(port.destination);
    this.link = new EngineLink(node, logger);
    this.runs = new ProcessorRuns({
      link: this.link,
      feeds: prepared.feeds,
      schedule,
      tickMilliseconds: prepared.feedPlan.tickMilliseconds,
      contextFrame: () => frameOf(port),
      feedFailed: options.feedFailed,
    });
    const latency = prepared.plan.latency;
    this.graphLatencyFrames = latency.kind === 'known' ? latency.frames : latency.knownFrames;
    this.link.subscribe(this.#reply);
    this.#cancelWait = schedule(() => {
      logger.error('The audio processor did not answer the load in time.');
      this.#end({ kind: 'unanswered' });
    }, LOAD_ANSWER_MILLISECONDS);
    this.link.send({
      kind: ToProcessorKind.Load,
      graph: options.graph,
      dspModuleBytes: options.dsp.kind === WorkletDspKind.Bytes ? options.dsp.bytes : undefined,
      dspUnavailable:
        options.dsp.kind === WorkletDspKind.Unavailable ? options.dsp.reason : undefined,
      feeds: prepared.feeds.bindings,
      meterEveryBlocks: Math.max(
        1,
        Math.round(port.sampleRate / RENDER_QUANTUM_FRAMES / METER_REPORTS_PER_SECOND),
      ),
    });
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

  /** Stops the runs and the wait, and lets go of the node. */
  dispose(): void {
    this.runs.abandon();
    this.#cancelWait();
    this.link.dispose();
  }

  readonly #reply = (reply: FromProcessor): void => {
    switch (reply.kind) {
      case FromProcessorKind.Loaded:
        this.#end({
          kind: 'loaded',
          dsp: { implementation: reply.dsp, fallbackReason: reply.dspFallbackReason },
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
