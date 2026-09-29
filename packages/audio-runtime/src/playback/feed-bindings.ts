/**
 * The feeds that carry each graph input's source to the processor, and the
 * pumps that run them from a timeline frame.
 *
 * A feed crosses as a ring in memory both threads share where the capabilities
 * say memory can be shared, and as posted blocks everywhere else, which every
 * browser has: shared memory makes playback cheaper, never possible (the
 * packet's "no SharedArrayBuffer hard requirement"). The rings are made once,
 * with the graph, and live as long as it; a run is a set of pumps from one
 * frame, and each run starts fresh.
 *
 * A ring's old audio is marked as discarded before the processor is told to
 * reset, since the reset skips only to a mark it can already see; a posted
 * feed's blocks are cleared by the reset itself, and every run posts to a
 * destination of its own, whose count of what the processor has consumed
 * starts again with the run.
 */

import {
  channelCount,
  flatMapResult,
  mapResult,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { CancellationSignal } from '@audiogubbins/audio-engine';

import {
  PostedDestination,
  RingDestination,
  startFeedPump,
  type FeedDestination,
  type FeedPump,
  type PostToProcessor,
} from '../feed/feed-pump.js';
import type { Schedule } from '../schedule.js';
import { RingWriter, createSampleRing } from '../feed/sample-ring.js';
import { FeedTransport, type FeedBinding } from '../protocol/processor-messages.js';
import type { FeedPlan } from './feed-plan.js';
import { PrimingDestination } from './priming-destination.js';
import type { BoundSource } from './source-binding.js';

/** One graph input's feed: its source, and the ring it writes where memory is shared. */
interface Feed {
  readonly bound: BoundSource;
  readonly binding: FeedBinding;
  readonly ring: { readonly writer: RingWriter; readonly destination: RingDestination } | undefined;
}

/** A graph input's pump in one run. */
export interface RunningPump {
  readonly node: NodeId;
  readonly pump: FeedPump;
}

/** The pumps of one run from a timeline frame. */
export interface FeedRun {
  readonly pumps: readonly RunningPump[];
  /**
   * Settles when every feed has its first audio queued or has ended, or its
   * pump has stopped, so the processor is started with something to play.
   */
  readonly primed: Promise<void>;
}

/** What a set of feeds is made with. */
export interface PlaybackFeedsOptions {
  readonly sources: readonly BoundSource[];
  readonly rate: SampleRate;
  readonly plan: FeedPlan;
  /** Whether memory can be shared with the audio thread. */
  readonly sharedMemory: boolean;
}

function feedOf(bound: BoundSource, options: PlaybackFeedsOptions): DomainResult<Feed> {
  const channels = channelCount(bound.layout);
  if (!options.sharedMemory) {
    return succeed({
      bound,
      binding: { node: bound.node, transport: FeedTransport.Posted, channels },
      ring: undefined,
    });
  }
  return flatMapResult(createSampleRing(channels, options.plan.ringFrames), (ring) =>
    mapResult(RingWriter.open(ring), (writer) => ({
      bound,
      binding: { node: bound.node, transport: FeedTransport.SharedRing, channels, ring },
      ring: { writer, destination: new RingDestination(writer, bound.layout, options.rate) },
    })),
  );
}

/** Settles when `pump` stops, however it stops; its failure is heard where it is handled. */
function stopped(pump: FeedPump): Promise<void> {
  return pump.done.then(
    () => undefined,
    () => undefined,
  );
}

/** The feeds of one loaded graph. */
export class PlaybackFeeds {
  readonly bindings: readonly FeedBinding[];
  readonly #feeds: readonly Feed[];
  readonly #options: PlaybackFeedsOptions;

  private constructor(feeds: readonly Feed[], options: PlaybackFeedsOptions) {
    this.#feeds = feeds;
    this.#options = options;
    this.bindings = feeds.map((feed) => feed.binding);
  }

  /** A feed for each bound source, or why a ring could not be made for one. */
  static create(options: PlaybackFeedsOptions): DomainResult<PlaybackFeeds> {
    const feeds: Feed[] = [];
    for (const bound of options.sources) {
      const feed = feedOf(bound, options);
      if (!feed.ok) return feed;
      feeds.push(feed.value);
    }
    return succeed(new PlaybackFeeds(feeds, options));
  }

  /**
   * Marks everything the rings hold as the old run's, for the processor's
   * next reset to skip. Called before the reset is sent, never after.
   */
  discard(): void {
    for (const feed of this.#feeds) feed.ring?.writer.discard();
  }

  /**
   * Starts a pump per feed from timeline frame `from`, posting through `post`
   * where a feed is posted, until `signal` is cancelled; or says why a pump
   * could not start.
   */
  start(
    from: SampleCount,
    post: PostToProcessor,
    schedule: Schedule,
    signal: CancellationSignal,
  ): DomainResult<FeedRun> {
    const { plan, rate } = this.#options;
    const pumps: RunningPump[] = [];
    const primed: Promise<void>[] = [];
    for (const feed of this.#feeds) {
      const destination = new PrimingDestination(this.#destinationOf(feed, rate, post));
      const pump = startFeedPump({
        source: feed.bound.source,
        start: from,
        destination,
        feedAheadMilliseconds: plan.feedAheadMilliseconds,
        chunkFrames: plan.chunkFrames,
        schedule,
        signal,
      });
      if (!pump.ok) return pump;
      pumps.push({ node: feed.bound.node, pump: pump.value });
      primed.push(Promise.race([destination.primed, stopped(pump.value)]));
    }
    return succeed({ pumps, primed: Promise.all(primed).then(() => undefined) });
  }

  #destinationOf(feed: Feed, rate: SampleRate, post: PostToProcessor): FeedDestination {
    return (
      feed.ring?.destination ??
      new PostedDestination(feed.bound.node, feed.bound.layout, rate, post)
    );
  }
}
