/**
 * What the feeder worker does with the messages it is sent: it makes each
 * playback request's sources and keeps a loaded processor's feeds topped up
 * from them.
 *
 * Real-time playback reads its sources here rather than on the page's main
 * thread, so the audio thread depends on nothing the interface does
 * (REQ-ARCH-036, and the packet's "real-time/audio threads never depend on
 * React"): a long task on the main thread, a render of the interface or a
 * collection of its garbage, delays no read and no block. The main thread only
 * says where to feed from and when to stop.
 *
 * The worker's module (`threads/feeder-worker.ts`) only connects this to its
 * global scope and the channel to the processor, so the whole of the feeder's
 * behaviour runs in a Node test with both ends played by the test. It never
 * throws out of a handler: a message it cannot act on is reported as a fault,
 * which ends playback with the reason, since what it would feed is in doubt.
 *
 * Given a port to the preview worker, it reads from there the renders of the
 * chains an edited sound cannot run as it plays (ADR-0061), and a parameter
 * changed while a request plays goes to that request's sources, whose answer
 * it sends back.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import {
  PreviewClient,
  previewPort,
  type ChainProcessing,
  type PcmSource,
  type ToPreview,
} from '@audiogubbins/audio-engine';
import { sampleCount, type DomainFailure, type FailureSummary } from '@audiogubbins/domain';

import type { PostToProcessor } from '../feed/feed-pump.js';
import {
  FromFeederKind,
  ToFeederKind,
  readToFeeder,
  type FromFeeder,
  type ToFeeder,
} from '../protocol/feeder-messages.js';
import { readFromProcessorFeed } from '../protocol/feed-messages.js';
import type { Schedule } from '../schedule.js';
import type { DspChooser } from '../dsp/dsp-instance.js';
import { BoundFeeds } from './feeder-binding.js';
import { sourcesFor, type RequestSources } from './feeder-sources.js';

/** The worker's global scope and its channel to the processor, as the core uses them. */
export interface FeederHost {
  readonly post: (message: FromFeeder) => void;
  /**
   * Listens to the feeder's end of the channel to the processor, handing what
   * arrives to {@link FeederCore.receiveFromProcessor}, or stops listening to
   * the last one where given none.
   */
  readonly connectProcessor: (port: MessagePort | undefined) => void;
  /** Posts to the processor on the channel last connected. */
  readonly postToProcessor: PostToProcessor;
  /** Calls a callback after a delay: the worker's own timers, which the page's work never holds up. */
  readonly schedule: Schedule;
  readonly chooseDsp: DspChooser;
  /** How the chains an edited source's plan names are run: the effect rack's. */
  readonly processing: ChainProcessing;
  /**
   * Reads a source through what a test puts in front of it, a read that
   * stalls or fails as a disk may; production reads each as it was made.
   */
  readonly readThrough?: (node: NodeId, source: PcmSource) => PcmSource;
}

type Message<TKind extends ToFeeder['kind']> = Extract<ToFeeder, { readonly kind: TKind }>;

/** A binding and the request whose sources it feeds. */
interface Bound {
  readonly request: number;
  readonly feeds: BoundFeeds;
}

/** The feeder's behaviour, given its host. */
export class FeederCore {
  readonly #host: FeederHost;
  readonly #requests = new Map<number, RequestSources>();
  #bound: Bound | undefined;
  /** The preview worker's renders, once the feeder has its port. */
  #previews: PreviewClient | undefined;

  constructor(host: FeederHost) {
    this.#host = host;
  }

  /** Acts on a message from the main thread, whatever arrived. */
  receive(data: unknown): void {
    const read = readToFeeder(data);
    if (!read.ok) {
      this.#fault(`A message to the feeder could not be read: ${read.failures[0].summary}`);
      return;
    }
    this.#act(read.value);
  }

  /** Hears that a message from the main thread could not be received, so what it said is lost. */
  messageFailed(): void {
    this.#fault('A message to the feeder could not be received, so what it feeds is in doubt.');
  }

  /** Acts on a message from the processor, whatever arrived. */
  receiveFromProcessor(data: unknown): void {
    const read = readFromProcessorFeed(data);
    if (!read.ok) {
      this.#fault(
        `A message from the audio processor could not be read: ${read.failures[0].summary}`,
      );
      return;
    }
    const { epoch, node, frames } = read.value;
    this.#bound?.feeds.consumed(epoch, node, frames);
  }

  /** Hears that the processor's answer could not be received: the feeder's count of what it holds is lost. */
  processorMessageFailed(): void {
    this.#fault(
      'A message from the audio processor could not be received by the feeder, so how much audio it holds is in doubt.',
    );
  }

  #act(message: ToFeeder): void {
    switch (message.kind) {
      case ToFeederKind.Sources:
        this.#sources(message);
        return;
      case ToFeederKind.Bind:
        this.#bind(message);
        return;
      case ToFeederKind.Start:
        this.#start(message.run, message.from);
        return;
      case ToFeederKind.Stop:
        this.#bound?.feeds.stop();
        return;
      case ToFeederKind.Unbind:
        this.#unbind();
        return;
      case ToFeederKind.Release:
        this.#release(message.request);
        return;
      case ToFeederKind.Previews:
        this.#previews = new PreviewClient(previewPort<ToPreview>(message.port));
        return;
      case ToFeederKind.Parameters:
        this.#parameters(message);
        return;
    }
  }

  #parameters(message: Message<typeof ToFeederKind.Parameters>): void {
    const request = this.#requests.get(message.request);
    const refusals: DomainFailure[] = [];
    if (request === undefined) {
      this.#fault(
        `The feeder was given parameters for request ${String(message.request)}, whose sources it does not have.`,
      );
      return;
    }
    for (const change of message.changes) {
      const taken = request.parameters.apply(change);
      if (!taken.ok) refusals.push(...taken.failures);
    }
    this.#host.post({
      kind: FromFeederKind.ParametersTaken,
      change: message.change,
      refusals: refusals.map(({ code, summary }) => ({ code, summary })),
    });
  }

  #sources(message: Message<typeof ToFeederKind.Sources>): void {
    this.#release(message.request);
    const made = sourcesFor(message, this.#host.chooseDsp, this.#host.processing, this.#previews);
    if (!made.ok) {
      // The code and summary alone: a failure's details and cause may hold what
      // a structured clone cannot carry, and the main thread shows the summary.
      const summarised = ({ code, summary }: FailureSummary): FailureSummary => ({ code, summary });
      const [first, ...rest] = made.failures;
      this.#host.post({
        kind: FromFeederKind.SourcesRefused,
        request: message.request,
        failures: [summarised(first), ...rest.map(summarised)],
      });
      return;
    }
    const readThrough = this.#host.readThrough;
    const sources =
      readThrough === undefined
        ? made.value.sources
        : new Map(
            [...made.value.sources].map(([node, source]) => [node, readThrough(node, source)]),
          );
    this.#requests.set(message.request, { ...made.value, sources });
    this.#host.post({
      kind: FromFeederKind.SourcesMade,
      request: message.request,
      dsp: made.value.dsp.dsp.implementation,
      dspFallbackReason: made.value.dsp.fallbackReason,
      dspInUse: made.value.dspInUse,
    });
  }

  #bind(message: Message<typeof ToFeederKind.Bind>): void {
    this.#unbind();
    const request = this.#requests.get(message.request);
    if (request === undefined) {
      this.#fault(
        `The feeder was bound to request ${String(message.request)}, whose sources it does not have.`,
      );
      return;
    }
    const host = this.#host;
    const feeds = BoundFeeds.create({
      sources: request.sources,
      feeds: message.feeds,
      feedAheadMilliseconds: message.feedAheadMilliseconds,
      chunkFrames: message.chunkFrames,
      wakeMilliseconds: message.wakeMilliseconds,
      postToProcessor: host.postToProcessor,
      schedule: host.schedule,
      primed: (run) => {
        host.post({ kind: FromFeederKind.Primed, run });
      },
      failed: (run, node, error) => {
        host.post({
          kind: FromFeederKind.FeedFailed,
          run,
          node,
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    });
    if (!feeds.ok) {
      this.#fault(feeds.failures[0].summary);
      return;
    }
    host.connectProcessor(message.processor);
    this.#bound = { request: message.request, feeds: feeds.value };
  }

  #start(run: number, from: number): void {
    const bound = this.#bound;
    if (bound === undefined) {
      this.#fault('The feeder was told to feed with nothing bound to feed.');
      return;
    }
    const start = sampleCount(from);
    const started = start.ok ? bound.feeds.start(run, start.value) : start;
    if (!started.ok) this.#fault(`Feeding could not start: ${started.failures[0].summary}`);
  }

  #unbind(): void {
    if (this.#bound === undefined) return;
    this.#bound.feeds.stop();
    this.#bound = undefined;
    this.#host.connectProcessor(undefined);
  }

  #release(request: number): void {
    const sources = this.#requests.get(request);
    if (sources === undefined) return;
    if (this.#bound?.request === request) this.#unbind();
    this.#requests.delete(request);
    for (const source of sources.sources.values()) source.release();
  }

  #fault(message: string): void {
    this.#host.post({ kind: FromFeederKind.Fault, message });
  }
}
