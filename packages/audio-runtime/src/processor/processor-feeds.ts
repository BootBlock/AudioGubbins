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
 *
 * That answer is the feeder's measure of the room a posted feed has, so it is
 * sent in the quantum the block was read, not gathered for a later report: a
 * feeder told late keeps less audio ahead than it thinks, and the Low latency
 * profile keeps only 50 ms ahead. It is sent from the audio thread, which
 * allocates nothing as it runs, so each posted feed's answer is one record
 * made when the graph is loaded and written afresh before each post, which
 * clones it; and the posted feeds are walked as an array, not as a map's
 * entries, each of which would be a new pair.
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

/** The answer about a posted feed's blocks, the one record written before each post. */
interface ConsumedAnswer {
  readonly kind: typeof FromProcessorFeedKind.Consumed;
  epoch: number;
  readonly node: NodeId;
  frames: number;
}

/** A posted feed, and the record its answers are sent in. */
interface AnsweredFeed {
  readonly feed: PostedFeed;
  readonly answer: ConsumedAnswer;
}

/** What the feeds are bound from: the loaded graph's, as it holds them. */
export type BoundFeedsOf = Pick<LoadedGraph, 'feeds' | 'posted'>;

const NO_POSTED: ReadonlyMap<NodeId, PostedFeed> = new Map();

/** The feeds of the graph loaded, or of none. */
export class ProcessorFeeds {
  readonly #tell: (message: FromProcessorFeed) => void;
  #feeds: readonly ProcessorFeed[] = [];
  #posted: ReadonlyMap<NodeId, PostedFeed> = NO_POSTED;
  #answered: readonly AnsweredFeed[] = [];

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
  bind(graph: BoundFeedsOf | undefined): void {
    this.#feeds = graph?.feeds ?? [];
    this.#posted = graph?.posted ?? NO_POSTED;
    this.#answered = [...this.#posted].map(([node, feed]) => ({
      feed,
      answer: { kind: FromProcessorFeedKind.Consumed, epoch: 0, node, frames: 0 },
    }));
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
    for (const answered of this.#answered) {
      const frames = answered.feed.takeConsumed();
      if (frames === 0) continue;
      answered.answer.epoch = this.#epoch;
      answered.answer.frames = frames;
      this.#tell(answered.answer);
    }
    return supplied;
  }
}
