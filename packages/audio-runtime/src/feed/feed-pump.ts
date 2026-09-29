/**
 * The feeder worker's side of a feed: it keeps a graph input's audio a
 * bounded time ahead of the play position.
 *
 * A source reads asynchronously, from storage or a decoder, and the audio
 * thread may not wait, so the pump reads the source a chunk at a time, one
 * read in flight at most, and hands each chunk to the feed's destination: the
 * ring the processor reads, or a `feed-block` message on the channel to it. It
 * keeps at most the performance profile's feed-ahead time queued, so a long
 * file is never held whole (REQ-PROD-009). It runs in a worker of its own, so
 * nothing the page's main thread does, a long render of the interface or a
 * collection of its garbage, keeps it from topping the queue up.
 *
 * A ring says how much of it is queued, and the pump looks again on a timer
 * the host injects, so a test drives it without waiting. A posted feed cannot
 * say, and the pump counts it instead: what it sent, less what the processor
 * says it has read whole, block by block, which also wakes the pump at once.
 * The count is never less than what is truly queued, so the pump never sends
 * past its bound.
 */

import {
  addSamples,
  failure,
  FailureKind,
  fail,
  flatMapResult,
  sampleCount,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  Cancelled,
  allocateBlock,
  blockView,
  type AudioFrameBlock,
  type CancellationSignal,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import { ToProcessorFeedKind, type ToProcessorFeed } from '../protocol/feed-messages.js';
import { POSTED_FEED_BLOCKS } from './posted-feed.js';
import type { Schedule } from '../schedule.js';
import type { RingWriter } from './sample-ring.js';

/** Where a pump delivers the audio it reads. */
export interface FeedDestination {
  /** The frames delivered and not yet consumed, as well as the destination knows. */
  readonly queued: number;

  /** The frames the destination has room for now, whatever the time ahead. */
  readonly room: number;

  /** The most blocks it holds, where it counts blocks rather than frames. */
  readonly blockLimit: number | undefined;

  /** A block of `frames` frames for the pump to read the next chunk into. */
  blockFor(frames: number): AudioFrameBlock;

  /** Delivers a block from {@link blockFor}, cut to the frames read, and answers how many it took. */
  deliver(block: AudioFrameBlock): number;

  /** Says the audio delivered so far is all there is. */
  end(): void;

  /** Takes `frames` more frames the processor has read. */
  consumed(frames: number): void;
}

/**
 * A destination that writes a ring the processor reads.
 *
 * What it counts as queued is the audio of the current position alone. After a
 * rewind the old audio may still wait behind its mark until the processor skips
 * it, and counting it would hold the new position's first chunks back for a
 * wake of the pump; the ring has a chunk of room beyond the time ahead for them
 * (`playback/feed-plan.ts`). The processor reads nothing written after the mark
 * before it skips to the mark, so the new audio still queued is the lesser of
 * what the ring holds and what was written since the rewind.
 */
export class RingDestination implements FeedDestination {
  readonly blockLimit = undefined;
  readonly #writer: RingWriter;
  readonly #layout: ChannelLayout;
  readonly #rate: SampleRate;
  #writtenSinceRewind = 0;

  /** The block every chunk is read into, made at the first chunk's size and reused. */
  #staging: AudioFrameBlock | undefined;

  constructor(writer: RingWriter, layout: ChannelLayout, rate: SampleRate) {
    this.#writer = writer;
    this.#layout = layout;
    this.#rate = rate;
  }

  get queued(): number {
    return Math.min(this.#writer.queued, this.#writtenSinceRewind);
  }

  /** Marks the audio written so far as the old position's, for the processor to skip. */
  rewind(): void {
    this.#writer.discard();
    this.#writtenSinceRewind = 0;
  }

  get room(): number {
    return this.#writer.available;
  }

  blockFor(frames: number): AudioFrameBlock {
    if (this.#staging === undefined || this.#staging.frames < frames) {
      this.#staging = allocateBlock(this.#layout, this.#rate, frames);
    }
    return blockView(this.#staging, 0, frames);
  }

  deliver(block: AudioFrameBlock): number {
    const written = this.#writer.write(block);
    this.#writtenSinceRewind += written;
    return written;
  }

  end(): void {
    this.#writer.end();
  }

  consumed(): void {
    // The ring's positions say what was consumed, exactly.
  }
}

/** Posts a message to the processor on the feeder's channel, transferring the memory named. */
export type PostToProcessor = (message: ToProcessorFeed, transfer: ArrayBuffer[]) => void;

/** A destination that posts each chunk to the processor as a `feed-block`. */
export class PostedDestination implements FeedDestination {
  readonly blockLimit = POSTED_FEED_BLOCKS;
  readonly room = Number.POSITIVE_INFINITY;
  readonly #node: NodeId;
  readonly #layout: ChannelLayout;
  readonly #rate: SampleRate;
  readonly #post: PostToProcessor;
  #queued = 0;

  /** The memory of the block last made, to transfer when it is delivered. */
  #buffers: ArrayBuffer[] = [];

  constructor(node: NodeId, layout: ChannelLayout, rate: SampleRate, post: PostToProcessor) {
    this.#node = node;
    this.#layout = layout;
    this.#rate = rate;
    this.#post = post;
  }

  get queued(): number {
    return this.#queued;
  }

  /** A block of its own, whose memory is transferred with the message rather than copied. */
  blockFor(frames: number): AudioFrameBlock {
    const channels = this.#layout.roles.map(() => new Float32Array(frames));
    this.#buffers = channels.map((channel) => channel.buffer);
    return { layout: this.#layout, sampleRate: this.#rate, frames, channels };
  }

  deliver(block: AudioFrameBlock): number {
    this.#post(
      { kind: ToProcessorFeedKind.Block, node: this.#node, channels: block.channels },
      this.#buffers,
    );
    this.#buffers = [];
    this.#queued += block.frames;
    return block.frames;
  }

  end(): void {
    this.#post({ kind: ToProcessorFeedKind.End, node: this.#node }, []);
  }

  /** The processor read `frames` frames of blocks this destination sent, and they are gone. */
  consumed(frames: number): void {
    this.#queued -= frames;
  }
}

export interface FeedPumpOptions {
  /** The audio, at the context's rate; the caller's, which the pump never releases. */
  readonly source: PcmSource;

  /** The frame of the source the feed starts at. */
  readonly start: SampleCount;
  readonly destination: FeedDestination;

  /** The time of audio to keep queued ahead of the play position, at most. */
  readonly feedAheadMilliseconds: number;

  /** The frames of one read, at most. */
  readonly chunkFrames: number;

  /** How long it waits, when the queue has no room for a chunk, before it looks again. */
  readonly wakeMilliseconds: number;
  readonly schedule: Schedule;
  readonly signal: CancellationSignal;
}

/** A running pump. */
export interface FeedPump {
  /** Tops the queue up now, as room has opened. */
  wake(): void;

  /**
   * Settles when the source's last frame has been delivered and the end said,
   * and rejects with a read's error or the signal's reason.
   */
  readonly done: Promise<void>;
}

function pumpRefusal(summary: string): DomainResult<never> {
  return fail(failure('feed.pump-invalid', FailureKind.Rejected, summary));
}

class RunningPump implements FeedPump {
  readonly done: Promise<void>;
  readonly #options: FeedPumpOptions;
  readonly #aheadFrames: number;
  readonly #chunkFrames: number;
  #position: SampleCount;
  #reading = false;
  #settled = false;
  #cancelSleep: (() => void) | undefined;
  #resolve: () => void = () => undefined;
  #reject: (reason: unknown) => void = () => undefined;

  constructor(options: FeedPumpOptions, aheadFrames: number, chunkFrames: number) {
    this.#options = options;
    this.#aheadFrames = aheadFrames;
    this.#chunkFrames = chunkFrames;
    this.#position = options.start;
    this.done = new Promise<void>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    options.signal.addEventListener('abort', this.#abandon, { once: true });
  }

  wake(): void {
    this.step();
  }

  /** Reads the next chunk where the queue has room for it, or sleeps until it may. */
  step(): void {
    if (this.#settled || this.#reading) return;
    this.#wake();
    if (this.#options.signal.aborted) {
      this.#abandon();
      return;
    }
    const { destination } = this.#options;
    const room = Math.min(destination.room, this.#aheadFrames - destination.queued);
    if (room < this.#chunkFrames) {
      this.#cancelSleep = this.#options.schedule(() => {
        this.#cancelSleep = undefined;
        this.step();
      }, this.#options.wakeMilliseconds);
      return;
    }
    this.#reading = true;
    const block = destination.blockFor(this.#chunkFrames);
    this.#options.source.read(this.#position, block, this.#options.signal).then(
      (got) => {
        this.#reading = false;
        this.#delivered(block, got);
      },
      (error: unknown) => {
        this.#reading = false;
        this.#settle(error);
      },
    );
  }

  #delivered(block: AudioFrameBlock, got: number): void {
    if (this.#settled) return;
    const { destination } = this.#options;
    if (got > 0) {
      const taken = destination.deliver(blockView(block, 0, got));
      if (taken !== got) {
        // The pump reads no more than the room it measured, and only the
        // processor changes the room, by making more of it.
        this.#settle(new Error('A feed took fewer frames than it had room for.'));
        return;
      }
      const next = flatMapResult(sampleCount(got), (frames) => addSamples(this.#position, frames));
      if (!next.ok) {
        this.#settle(new Error(next.failures[0].summary));
        return;
      }
      this.#position = next.value;
    }
    // A source reads fewer frames than asked only at its end.
    if (got < block.frames) {
      destination.end();
      this.#settle(undefined);
      return;
    }
    this.step();
  }

  #wake(): void {
    this.#cancelSleep?.();
    this.#cancelSleep = undefined;
  }

  readonly #abandon = (): void => {
    const { reason } = this.#options.signal;
    this.#settle(reason instanceof Error ? reason : new Cancelled());
  };

  /** Stops for good: resolved at the end, rejected with `error` otherwise. */
  #settle(error: unknown): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#wake();
    this.#options.signal.removeEventListener('abort', this.#abandon);
    if (error === undefined) this.#resolve();
    else this.#reject(error);
  }
}

/**
 * A pump that starts at once, or why its options cannot run: a time ahead
 * shorter than a frame, or a posted feed that would need more blocks queued
 * than the processor holds.
 */
export function startFeedPump(options: FeedPumpOptions): DomainResult<FeedPump> {
  if (!Number.isSafeInteger(options.chunkFrames) || options.chunkFrames < 1) {
    return pumpRefusal('A pump reads chunks of at least one whole frame.');
  }
  const aheadFrames = Math.floor(
    (options.feedAheadMilliseconds * options.source.sampleRate) / 1000,
  );
  if (!Number.isFinite(aheadFrames) || aheadFrames < 1) {
    return pumpRefusal('A pump keeps at least one frame ahead of the play position.');
  }
  // A chunk longer than the time ahead could never be read without passing it.
  const chunkFrames = Math.min(options.chunkFrames, aheadFrames);
  const limit = options.destination.blockLimit;
  // Every block queued but the head is a whole chunk, so this many cover the time ahead.
  if (limit !== undefined && Math.ceil(aheadFrames / chunkFrames) > limit) {
    return pumpRefusal(
      `Keeping ${String(options.feedAheadMilliseconds)} ms ahead in chunks of ${String(chunkFrames)} frames needs more than the ${String(limit)} blocks a posted feed holds; read larger chunks.`,
    );
  }
  const pump = new RunningPump(options, aheadFrames, chunkFrames);
  pump.step();
  return succeed(pump);
}
