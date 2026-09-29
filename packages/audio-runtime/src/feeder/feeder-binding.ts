/**
 * One request's sources joined to one loaded processor, and the runs that
 * feed it from a timeline frame.
 *
 * A run is a pump per graph input from one frame. Each starts by rewinding
 * the feeds: every ring is marked, so the processor skips what it held, and a
 * rewind is sent on the channel before any of the new audio, so the processor
 * drops a posted feed's old blocks and knows which audio the run plays. The
 * rewind names the run, and a posted block's answer names the run it was
 * sent in, so an answer about audio a rewind discarded counts for nothing.
 *
 * A pause does not come here: the processor halts and keeps what the feeds
 * hold, and the pumps, finding no room, wait. Only a stop, a seek or a new
 * start ends a run.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  Cancelled,
  createCancellationSource,
  type CancellationSource,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import {
  PostedDestination,
  RingDestination,
  startFeedPump,
  type FeedDestination,
  type FeedPump,
  type PostToProcessor,
} from '../feed/feed-pump.js';
import { RingWriter } from '../feed/sample-ring.js';
import { ToProcessorFeedKind } from '../protocol/feed-messages.js';
import type { FeederBinding } from '../protocol/feeder-messages.js';
import { FeedTransport } from '../protocol/processor-messages.js';
import type { Schedule } from '../schedule.js';
import { PrimingDestination } from './priming-destination.js';

/** One graph input's feed: its source, and the ring it writes where memory is shared. */
interface Feed {
  readonly node: NodeId;
  readonly source: PcmSource;
  readonly ring: RingDestination | undefined;
}

/** A graph input's pump in one run, and where it delivers. */
interface Pumping {
  readonly pump: FeedPump;
  readonly destination: FeedDestination;
}

interface Run {
  readonly id: number;
  readonly cancellation: CancellationSource;
  readonly pumps: ReadonlyMap<NodeId, Pumping>;
}

/** How a binding feeds. */
export interface FeedingOptions {
  readonly sources: ReadonlyMap<NodeId, PcmSource>;
  readonly feeds: readonly FeederBinding[];
  readonly feedAheadMilliseconds: number;
  readonly chunkFrames: number;
  readonly wakeMilliseconds: number;
  readonly postToProcessor: PostToProcessor;
  readonly schedule: Schedule;
  /** Hears that every feed of run `run` has audio queued, or has ended. */
  readonly primed: (run: number) => void;
  /** Hears that `node`'s source failed while feeding run `run`, not by being stopped. */
  readonly failed: (run: number, node: NodeId, error: unknown) => void;
}

function bindingRefusal(summary: string): DomainResult<never> {
  return fail(failure('feeder.binding-invalid', FailureKind.Rejected, summary));
}

/** Settles when `pump` stops, however it stops; its failure is heard where it is handled. */
function stopped(pump: FeedPump): Promise<void> {
  return pump.done.then(
    () => undefined,
    () => undefined,
  );
}

/** The feeds of one loaded processor. */
export class BoundFeeds {
  readonly #options: FeedingOptions;
  readonly #feeds: readonly Feed[];
  #run: Run | undefined;

  private constructor(options: FeedingOptions, feeds: readonly Feed[]) {
    this.#options = options;
    this.#feeds = feeds;
  }

  /** The feeds a binding names, each over its request's source, or why one cannot be made. */
  static create(options: FeedingOptions): DomainResult<BoundFeeds> {
    const feeds: Feed[] = [];
    for (const binding of options.feeds) {
      const source = options.sources.get(binding.node);
      if (source === undefined) {
        return bindingRefusal(`A feed is bound to ${binding.node}, which has no source.`);
      }
      if (binding.transport === FeedTransport.Posted) {
        feeds.push({ node: binding.node, source, ring: undefined });
        continue;
      }
      const writer = RingWriter.open(binding.ring);
      if (!writer.ok) return writer;
      feeds.push({
        node: binding.node,
        source,
        ring: new RingDestination(writer.value, source.layout, source.sampleRate),
      });
    }
    return succeed(new BoundFeeds(options, feeds));
  }

  /**
   * Rewinds every feed to run `run` and pumps from timeline frame `from`, or
   * says why a pump could not start, having started none.
   */
  start(run: number, from: SampleCount): DomainResult<void> {
    this.stop();
    const { postToProcessor } = this.#options;
    for (const feed of this.#feeds) feed.ring?.rewind();
    // After the marks, so the processor that hears it finds them, and before
    // any new audio, so a posted feed drops only the old.
    postToProcessor({ kind: ToProcessorFeedKind.Rewind, epoch: run }, []);
    const cancellation = createCancellationSource();
    const pumps = new Map<NodeId, Pumping>();
    const primed: Promise<void>[] = [];
    for (const feed of this.#feeds) {
      const destination =
        feed.ring ??
        new PostedDestination(
          feed.node,
          feed.source.layout,
          feed.source.sampleRate,
          postToProcessor,
        );
      const priming = new PrimingDestination(destination);
      const pump = this.#pump(feed, from, priming, cancellation);
      if (!pump.ok) {
        cancellation.cancel();
        return pump;
      }
      pumps.set(feed.node, { pump: pump.value, destination });
      primed.push(Promise.race([priming.primed, stopped(pump.value)]));
    }
    const current: Run = { id: run, cancellation, pumps };
    this.#run = current;
    for (const [node, { pump }] of pumps) {
      void pump.done.catch((error: unknown) => {
        // A pump stopped by a stop or a new run ends with its signal's reason,
        // which is nobody's problem.
        if (cancellation.signal.aborted && error instanceof Cancelled) return;
        this.#options.failed(run, node, error);
      });
    }
    void Promise.all(primed).then(() => {
      if (this.#run === current) this.#options.primed(run);
    });
    return succeed(undefined);
  }

  /** Stops the current run's pumps, leaving what the feeds hold. */
  stop(): void {
    this.#run?.cancellation.cancel();
    this.#run = undefined;
  }

  /** Hears that the processor read `frames` frames of `node`'s posted blocks of run `epoch`. */
  consumed(epoch: number, node: NodeId, frames: number): void {
    const run = this.#run;
    if (run?.id !== epoch) return;
    const pumping = run.pumps.get(node);
    if (pumping === undefined) return;
    pumping.destination.consumed(frames);
    pumping.pump.wake();
  }

  #pump(
    feed: Feed,
    from: SampleCount,
    destination: FeedDestination,
    cancellation: CancellationSource,
  ): DomainResult<FeedPump> {
    const { feedAheadMilliseconds, chunkFrames, wakeMilliseconds, schedule } = this.#options;
    return startFeedPump({
      source: feed.source,
      start: from,
      destination,
      feedAheadMilliseconds,
      chunkFrames,
      wakeMilliseconds,
      schedule,
      signal: cancellation.signal,
    });
  }
}
