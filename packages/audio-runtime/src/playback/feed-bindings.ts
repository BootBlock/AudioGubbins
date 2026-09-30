/**
 * How each graph input's audio travels from the feeder worker to the
 * processor: the bindings both ends are given.
 *
 * A feed crosses as a ring in memory both threads share where the capabilities
 * say memory can be shared, and as posted blocks everywhere else, which every
 * browser has: shared memory makes playback cheaper, never possible (the
 * packet's "no SharedArrayBuffer hard requirement"). The rings are made here,
 * once, with the graph, and live as long as it: the feeder writes them and the
 * processor reads them, and the main thread never touches their audio.
 */

import { channelCount, mapResult, succeed, type DomainResult } from '@audiogubbins/domain';

import { createSampleRing } from '../feed/sample-ring.js';
import type { FeederBinding } from '../protocol/feeder-messages.js';
import { FeedTransport, type FeedBinding } from '../protocol/processor-messages.js';
import type { FeedPlan } from './feed-plan.js';
import type { BoundSource } from './source-binding.js';

/** What a set of feeds is made with. */
export interface PlaybackFeedsOptions {
  readonly sources: readonly BoundSource[];
  readonly plan: FeedPlan;
  /** Whether memory can be shared between the feeder and the audio thread. */
  readonly sharedMemory: boolean;
}

/** One graph input's binding at each end. */
interface Feed {
  readonly processor: FeedBinding;
  readonly feeder: FeederBinding;
}

function feedOf(bound: BoundSource, options: PlaybackFeedsOptions): DomainResult<Feed> {
  const { node } = bound;
  const channels = channelCount(bound.layout);
  if (!options.sharedMemory) {
    return succeed({
      processor: { node, transport: FeedTransport.Posted, channels },
      feeder: { node, transport: FeedTransport.Posted },
    });
  }
  return mapResult(createSampleRing(channels, options.plan.ringFrames), (ring) => ({
    processor: { node, transport: FeedTransport.SharedRing, channels, ring },
    feeder: { node, transport: FeedTransport.SharedRing, ring },
  }));
}

/** The feeds of one loaded graph, as the processor and the feeder are each told of them. */
export class PlaybackFeeds {
  readonly processor: readonly FeedBinding[];
  readonly feeder: readonly FeederBinding[];

  private constructor(feeds: readonly Feed[]) {
    this.processor = feeds.map((feed) => feed.processor);
    this.feeder = feeds.map((feed) => feed.feeder);
  }

  /** A feed for each bound source, or why a ring could not be made for one. */
  static create(options: PlaybackFeedsOptions): DomainResult<PlaybackFeeds> {
    const feeds: Feed[] = [];
    for (const bound of options.sources) {
      const feed = feedOf(bound, options);
      if (!feed.ok) return feed;
      feeds.push(feed.value);
    }
    return succeed(new PlaybackFeeds(feeds));
  }

  /** Whether the graph has any feed, which a graph that makes its own audio has not. */
  get any(): boolean {
    return this.processor.length > 0;
  }
}
