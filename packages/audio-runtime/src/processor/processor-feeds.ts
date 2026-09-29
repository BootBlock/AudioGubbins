/**
 * The loaded graph's feeds as the processor drives them: the audio the feeder
 * sends them, which run's audio they hold, whether they can supply a quantum,
 * whether they have ended, and the word to the feeder that a posted block was
 * read whole.
 *
 * The feeds' audio belongs to a run: the one whose rewind the feeder sent
 * last, before any of the audio after it on the same channel. A rewind drops
 * what every feed held, and the answer about a posted block names the run it
 * was read in, so the feeder counts nothing a rewind discarded.
 */

import type { NodeId } from '@audiogubbins/audio-graph';

import type { PostedFeed } from '../feed/posted-feed.js';
import type { ProcessorFeed } from '../feed/processor-feed.js';
import {
  FromProcessorFeedKind,
  ToProcessorFeedKind,
  type FromProcessorFeed,
  type ToProcessorFeed,
} from '../protocol/feed-messages.js';
import type { LoadedGraph } from './loaded-graph.js';

/** A feed's audio or its end, which the feeder sends after a rewind. */
type FeedAudio = Exclude<ToProcessorFeed, { readonly kind: typeof ToProcessorFeedKind.Rewind }>;

const NO_POSTED: ReadonlyMap<NodeId, PostedFeed> = new Map();

/** The feeds of the graph loaded, or of none. */
export class ProcessorFeeds {
  readonly #tell: (message: FromProcessorFeed) => void;
  #feeds: readonly ProcessorFeed[] = [];
  #posted: ReadonlyMap<NodeId, PostedFeed> = NO_POSTED;

  /** The run whose audio the feeds hold: the last rewind's. None before the first. */
  #epoch = 0;

  /** Tells the feeder with `tell`. */
  constructor(tell: (message: FromProcessorFeed) => void) {
    this.#tell = tell;
  }

  /** The run whose audio the feeds hold, or zero before any rewind. */
  get epoch(): number {
    return this.#epoch;
  }

  /** Whether the graph has any feed, which a graph that makes its own audio has not. */
  get any(): boolean {
    return this.#feeds.length > 0;
  }

  /** Whether every feed has ended and been supplied whole. A graph without one never ends. */
  get finished(): boolean {
    if (this.#feeds.length === 0) return false;
    for (const feed of this.#feeds) if (!feed.finished) return false;
    return true;
  }

  /** Takes the feeds of a graph just loaded, holding no run's audio yet, or of none. */
  bind(graph: LoadedGraph | undefined): void {
    this.#feeds = graph?.feeds ?? [];
    this.#posted = graph?.posted ?? NO_POSTED;
    this.#epoch = 0;
  }

  /** Drops what every feed holds: the audio after this is run `epoch`'s. */
  rewind(epoch: number): void {
    for (const feed of this.#feeds) feed.clear();
    this.#epoch = epoch;
  }

  /** Queues a posted feed's block or its end, or answers why the feed cannot take it. */
  take(message: FeedAudio): string | undefined {
    const feed = this.#posted.get(message.node);
    if (feed === undefined) return `No posted feed is bound to ${message.node} to take its audio.`;
    if (message.kind === ToProcessorFeedKind.End) {
      feed.end();
      return undefined;
    }
    const pushed = feed.push(message.channels);
    return pushed.ok ? undefined : `${message.node}: ${pushed.failures[0].summary}`;
  }

  /** Whether every feed can supply `frames` frames whole, or has ended. */
  ready(frames: number): boolean {
    for (const feed of this.#feeds) if (!feed.ready(frames)) return false;
    return true;
  }

  /** Starts every feed's counts of a quantum again. */
  beginQuantum(): void {
    for (const feed of this.#feeds) feed.beginQuantum();
  }

  /**
   * The most frames any feed supplied in the quantum just run, having told the
   * feeder of each posted block it read whole.
   */
  supplied(): number {
    let supplied = 0;
    for (const feed of this.#feeds) supplied = Math.max(supplied, feed.suppliedFrames);
    for (const [node, feed] of this.#posted) {
      const frames = feed.takeConsumed();
      if (frames > 0) {
        this.#tell({ kind: FromProcessorFeedKind.Consumed, epoch: this.#epoch, node, frames });
      }
    }
    return supplied;
  }
}
