/**
 * A graph input's audio posted to the worklet a block at a time, where memory
 * cannot be shared.
 *
 * The packet forbids a hard requirement on `SharedArrayBuffer`, which a page
 * that is not cross-origin isolated lacks, so this is the path every browser
 * has. Each block arrives from the feeder worker as its own arrays,
 * transferred rather than copied, and is held in a queue of a fixed number of
 * places until the graph input has read it; then the feeder is told the
 * block's frames were consumed, which is how it knows the room it has. The
 * queue is bounded because the feeder keeps a bounded time of audio ahead of
 * the play position; a block past the bound is refused rather than stored,
 * since storing it would grow the audio thread's memory without limit.
 */

import {
  channelCount,
  failure,
  FailureKind,
  fail,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';
import type { AudioFrameBlock } from '@audiogubbins/audio-engine';

import { FillTally, type ProcessorFeed } from './processor-feed.js';

/**
 * The most blocks a posted feed holds. The pump keeps no more than its time
 * ahead queued, in blocks of its chunk, and refuses a time and chunk that
 * would need more than this.
 */
export const POSTED_FEED_BLOCKS = 64;

function pushRefusal(summary: string): DomainResult<never> {
  return fail(failure('feed.block-refused', FailureKind.Rejected, summary));
}

/** A feed of the blocks posted to it, in order. */
export class PostedFeed implements ProcessorFeed {
  readonly layout: ChannelLayout;
  readonly #tally = new FillTally();

  /** The queue's places, a ring of block references; an empty place is `undefined`. */
  readonly #blocks: (readonly Float32Array[] | undefined)[];
  #head = 0;
  #count = 0;

  /** The frames of the block at the head the graph input has already read. */
  #taken = 0;

  /** The frames queued and not yet read. */
  #queuedFrames = 0;

  /** The frames of the blocks read whole since {@link takeConsumed}, for the feeder to hear of. */
  #consumed = 0;
  #ended = false;

  constructor(layout: ChannelLayout) {
    this.layout = layout;
    this.#blocks = new Array<readonly Float32Array[] | undefined>(POSTED_FEED_BLOCKS).fill(
      undefined,
    );
  }

  get suppliedFrames(): number {
    return this.#tally.suppliedFrames;
  }

  get finished(): boolean {
    return this.#tally.finished;
  }

  ready(frames: number): boolean {
    return this.#ended || this.#queuedFrames >= frames;
  }

  /** The frames of the blocks read whole since the last call, and none from then. */
  takeConsumed(): number {
    const consumed = this.#consumed;
    this.#consumed = 0;
    return consumed;
  }

  /** Queues the next block, one array per channel, or says why it cannot be. */
  push(channels: readonly Float32Array[]): DomainResult<void> {
    if (this.#ended) return pushRefusal('A block arrived after its feed had ended.');
    if (channels.length !== channelCount(this.layout)) {
      return pushRefusal(
        `A block of ${String(channels.length)} channels arrived for a feed of ${String(channelCount(this.layout))}.`,
      );
    }
    const frames = channels[0]?.length ?? 0;
    if (channels.some((channel) => channel.length !== frames)) {
      return pushRefusal('A block arrived whose channels hold different numbers of frames.');
    }
    // An empty block adds no audio, so it takes no place in the queue.
    if (frames === 0) return succeed(undefined);
    if (this.#count === this.#blocks.length) {
      return pushRefusal(
        `A block arrived when ${String(POSTED_FEED_BLOCKS)} were already queued, more than the feed holds.`,
      );
    }
    this.#blocks[(this.#head + this.#count) % this.#blocks.length] = channels;
    this.#count += 1;
    this.#queuedFrames += frames;
    return succeed(undefined);
  }

  /** Says the blocks queued so far are all there is. */
  end(): void {
    this.#ended = true;
  }

  fill(into: AudioFrameBlock): number {
    let got = 0;
    while (got < into.frames && this.#count > 0) {
      const block = this.#blocks[this.#head];
      if (block === undefined) break;
      const length = block[0]?.length ?? 0;
      const frames = Math.min(length - this.#taken, into.frames - got);
      for (let channel = 0; channel < into.channels.length; channel += 1) {
        const from = block[channel];
        const to = into.channels[channel];
        if (from === undefined || to === undefined) continue;
        for (let frame = 0; frame < frames; frame += 1) {
          to[got + frame] = from[this.#taken + frame] ?? 0;
        }
      }
      got += frames;
      this.#taken += frames;
      this.#queuedFrames -= frames;
      if (this.#taken === length) {
        this.#consumed += length;
        this.#release();
      }
    }
    this.#tally.record(into.frames, got, this.#ended);
    return got;
  }

  beginQuantum(): void {
    this.#tally.beginQuantum();
  }

  /** Drops every block: the feeder rewound, so it counts none of them as consumed. */
  clear(): void {
    while (this.#count > 0) this.#release();
    this.#queuedFrames = 0;
    this.#consumed = 0;
    this.#ended = false;
    this.#tally.clear();
  }

  /** Lets go of the block at the head, so its memory can be collected. */
  #release(): void {
    this.#blocks[this.#head] = undefined;
    this.#head = (this.#head + 1) % this.#blocks.length;
    this.#count -= 1;
    this.#taken = 0;
  }
}
