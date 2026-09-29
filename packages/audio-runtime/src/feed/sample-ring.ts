/**
 * A ring of planar samples in memory the feeder worker and the audio thread
 * share, so a feed crosses into the AudioWorklet without a message per block.
 *
 * One writer, in the feeder worker, and one reader, on the audio thread. The
 * memory is an `Int32Array` header and then `channels × capacity` floats, one
 * run of `capacity` per channel. Each side owns the position it moves and only
 * reads the other's, through `Atomics`: a side writes its samples, then stores
 * its position, and the other loads the position before it touches the
 * samples, so every sample it reads was written before the position it read.
 *
 * A position runs from zero to twice the capacity and then back to zero.
 * Twice, so a full ring and an empty one differ (the write position is a
 * capacity ahead, or level), and any capacity works, not only a power of two.
 * Because a position never passes `2 × capacity`, and the capacity is at most
 * {@link MAXIMUM_RING_FRAMES}, it always fits a 32-bit integer, however long
 * the session: the counter wraps by the ring's own arithmetic, never by
 * integer overflow.
 *
 * A seek discards what the ring holds without either side waiting for the
 * other. The writer marks its write position as the end of the old audio and
 * writes the new audio after it at once, and the reader, when the processor is
 * told to reset, skips to the mark. Until then it reads no further than the
 * mark, so it never plays audio from the new position through the graph's
 * history of the old one.
 */

import {
  MAXIMUM_CHANNEL_COUNT,
  failure,
  FailureKind,
  fail,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import type { AudioFrameBlock } from '@audiogubbins/audio-engine';

/**
 * The most frames a ring holds: `2 × 2³⁰ − 1`, the largest position, is the
 * largest value a 32-bit integer holds.
 */
export const MAXIMUM_RING_FRAMES = 2 ** 30;

/** The header's fields, each an index into its `Int32Array`. */
const Header = {
  /** Where the writer writes next; the writer's alone to store. */
  Write: 0,
  /** Where the reader reads next; the reader's alone to store. */
  Read: 1,
  /** One once the writer has written the last of its audio. */
  Ended: 2,
  /** The write position when the writer last discarded, for the reader to skip to. */
  Mark: 3,
  /**
   * How many discards the writer has marked, wrapping, compared for equality
   * alone. A count rather than a flag, so neither side clears what the other
   * set: a flag the reader cleared could erase a second mark set meanwhile.
   */
  Discards: 4,
  /** How many channels, fixed when the ring is made. */
  Channels: 5,
  /** How many frames of each channel, fixed when the ring is made. */
  Capacity: 6,
} as const;

const HEADER_INTS = 7;
const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;

/** The shape of a ring, read from its header. */
interface RingShape {
  readonly header: Int32Array;
  readonly channels: readonly Float32Array[];
  readonly capacity: number;
}

function ringRefusal(summary: string): DomainResult<never> {
  return fail(failure('feed.ring-invalid', FailureKind.Rejected, summary));
}

/** Memory for a ring of `channels` channels of `capacityFrames` frames each. */
export function createSampleRing(
  channels: number,
  capacityFrames: number,
): DomainResult<SharedArrayBuffer> {
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > MAXIMUM_CHANNEL_COUNT) {
    return ringRefusal(
      `A ring holds from 1 to ${String(MAXIMUM_CHANNEL_COUNT)} channels, not ${String(channels)}.`,
    );
  }
  if (
    !Number.isSafeInteger(capacityFrames) ||
    capacityFrames < 1 ||
    capacityFrames > MAXIMUM_RING_FRAMES
  ) {
    return ringRefusal(
      `A ring holds from 1 to ${String(MAXIMUM_RING_FRAMES)} frames, not ${String(capacityFrames)}.`,
    );
  }
  const ring = new SharedArrayBuffer(
    HEADER_BYTES + channels * capacityFrames * Float32Array.BYTES_PER_ELEMENT,
  );
  const header = new Int32Array(ring, 0, HEADER_INTS);
  header[Header.Channels] = channels;
  header[Header.Capacity] = capacityFrames;
  return succeed(ring);
}

/**
 * The views of a ring's memory, or why it is not a ring. The memory crossed
 * from another thread in a message, so its header is not trusted to agree
 * with its length.
 */
function shapeOf(ring: SharedArrayBuffer): DomainResult<RingShape> {
  if (ring.byteLength < HEADER_BYTES) return ringRefusal('The memory is too short for a ring.');
  const header = new Int32Array(ring, 0, HEADER_INTS);
  const channels = header[Header.Channels] ?? 0;
  const capacity = header[Header.Capacity] ?? 0;
  const expected = HEADER_BYTES + channels * capacity * Float32Array.BYTES_PER_ELEMENT;
  if (
    channels < 1 ||
    channels > MAXIMUM_CHANNEL_COUNT ||
    capacity < 1 ||
    capacity > MAXIMUM_RING_FRAMES ||
    ring.byteLength !== expected
  ) {
    return ringRefusal("The memory's header does not describe a ring of its length.");
  }
  const views = Array.from(
    { length: channels },
    (_, channel) =>
      new Float32Array(
        ring,
        HEADER_BYTES + channel * capacity * Float32Array.BYTES_PER_ELEMENT,
        capacity,
      ),
  );
  return succeed({ header, channels: views, capacity });
}

/** A position `frames` after `position`, in a ring of `capacity`. */
export function advancePosition(position: number, frames: number, capacity: number): number {
  const next = position + frames;
  return next >= 2 * capacity ? next - 2 * capacity : next;
}

/** The frames from position `from` up to position `to`, in a ring of `capacity`. */
export function framesBetween(from: number, to: number, capacity: number): number {
  const frames = to - from;
  return frames < 0 ? frames + 2 * capacity : frames;
}

/** The index in a channel's samples that a position stands for. */
function indexOf(position: number, capacity: number): number {
  return position >= capacity ? position - capacity : position;
}

/**
 * Copies `frames` frames between a ring's channels, from `position`, and the
 * start of a block's, in the direction `toRing` says. Sample by sample rather
 * than by `set` over `subarray` views, because a view is an object, and the
 * audio thread reads a block without making one.
 */
function copyFrames(
  ring: readonly Float32Array[],
  block: readonly Float32Array[],
  position: number,
  frames: number,
  toRing: boolean,
): void {
  for (let channel = 0; channel < ring.length; channel += 1) {
    const stored = ring[channel];
    const outside = block[channel];
    if (stored === undefined || outside === undefined) continue;
    let index = indexOf(position, stored.length);
    for (let frame = 0; frame < frames; frame += 1) {
      if (toRing) stored[index] = outside[frame] ?? 0;
      else outside[frame] = stored[index] ?? 0;
      index = index + 1 === stored.length ? 0 : index + 1;
    }
  }
}

/** Refuses a block of another number of channels, which would drop or invent one. */
function assertChannels(block: AudioFrameBlock, channels: number): void {
  if (block.channels.length !== channels) {
    throw new Error(
      `A ring of ${String(channels)} channels was given a block of ${String(block.channels.length)}.`,
    );
  }
}

/** The feeder's side of a ring: it writes the audio. */
export class RingWriter {
  readonly #header: Int32Array;
  readonly #channels: readonly Float32Array[];
  readonly #capacity: number;

  private constructor(shape: RingShape) {
    this.#header = shape.header;
    this.#channels = shape.channels;
    this.#capacity = shape.capacity;
  }

  /** The writer of a ring's memory, or why it is not a ring. */
  static open(ring: SharedArrayBuffer): DomainResult<RingWriter> {
    const shape = shapeOf(ring);
    return shape.ok ? succeed(new RingWriter(shape.value)) : shape;
  }

  get capacityFrames(): number {
    return this.#capacity;
  }

  /** The frames the ring has room for now; the reader only ever makes more. */
  get available(): number {
    return this.#capacity - this.#queued();
  }

  /** The frames written and not yet read, those behind a discard mark included. */
  get queued(): number {
    return this.#queued();
  }

  /** Writes as many of the block's frames as fit, and answers how many. */
  write(block: AudioFrameBlock): number {
    assertChannels(block, this.#channels.length);
    const write = Atomics.load(this.#header, Header.Write);
    const frames = Math.min(block.frames, this.#capacity - this.#queued());
    if (frames === 0) return 0;
    copyFrames(this.#channels, block.channels, write, frames, true);
    // Stored after the samples, so the reader that loads it finds them written.
    Atomics.store(this.#header, Header.Write, advancePosition(write, frames, this.#capacity));
    return frames;
  }

  /** Says the audio written so far is all there is. */
  end(): void {
    Atomics.store(this.#header, Header.Ended, 1);
  }

  /**
   * Marks everything written so far as the old position's, for the reader to
   * skip when it is reset, and takes back an {@link end}. Audio written after
   * this is the new position's, and may be written at once.
   */
  discard(): void {
    Atomics.store(this.#header, Header.Ended, 0);
    Atomics.store(this.#header, Header.Mark, Atomics.load(this.#header, Header.Write));
    // Counted after the mark, and before any new audio, so a reader that sees
    // the new audio also sees the mark it must stop at.
    Atomics.store(
      this.#header,
      Header.Discards,
      (Atomics.load(this.#header, Header.Discards) + 1) | 0,
    );
  }

  #queued(): number {
    return framesBetween(
      Atomics.load(this.#header, Header.Read),
      Atomics.load(this.#header, Header.Write),
      this.#capacity,
    );
  }
}

/**
 * The audio thread's side of a ring: it reads the audio, allocating nothing.
 */
export class RingReader {
  readonly #header: Int32Array;
  readonly #channels: readonly Float32Array[];
  readonly #capacity: number;
  #ended = false;

  /** The writer's count of discards when the reader last skipped to a mark. */
  #skipped: number;

  private constructor(shape: RingShape) {
    this.#header = shape.header;
    this.#channels = shape.channels;
    this.#capacity = shape.capacity;
    // A discard marked before the reader existed is not one it was reset for.
    this.#skipped = Atomics.load(shape.header, Header.Discards);
  }

  /** The reader of a ring's memory, or why it is not a ring. */
  static open(ring: SharedArrayBuffer): DomainResult<RingReader> {
    const shape = shapeOf(ring);
    return shape.ok ? succeed(new RingReader(shape.value)) : shape;
  }

  get channelCount(): number {
    return this.#channels.length;
  }

  /**
   * Whether the writer had ended before the last {@link read} looked for
   * audio. Taken then, not now, so a read that came short while this is true
   * found the true end: the writer stores its last audio before it ends, and
   * the read loaded the ended flag before the write position.
   */
  get ended(): boolean {
    return this.#ended;
  }

  /**
   * Whether a read of `frames` frames would find them all, or the writer has
   * ended, so a shorter read finds the true end. The ended flag is loaded
   * first, for the reason {@link ended} gives.
   */
  ready(frames: number): boolean {
    if (Atomics.load(this.#header, Header.Ended) === 1) return true;
    return this.#readable(Atomics.load(this.#header, Header.Read)) >= frames;
  }

  /** Reads up to `into.frames` frames into the start of `into`, and answers how many. */
  read(into: AudioFrameBlock): number {
    assertChannels(into, this.#channels.length);
    this.#ended = Atomics.load(this.#header, Header.Ended) === 1;
    const read = Atomics.load(this.#header, Header.Read);
    const frames = Math.min(into.frames, this.#readable(read));
    if (frames === 0) return 0;
    copyFrames(this.#channels, into.channels, read, frames, false);
    Atomics.store(this.#header, Header.Read, advancePosition(read, frames, this.#capacity));
    return frames;
  }

  /** The frames from the read position `read` the reader may read now. */
  #readable(read: number): number {
    const write = Atomics.load(this.#header, Header.Write);
    // Loaded after the write position: audio past a mark was written after
    // the mark was counted, so a read that found it finds the mark too.
    const until =
      Atomics.load(this.#header, Header.Discards) === this.#skipped
        ? write
        : Atomics.load(this.#header, Header.Mark);
    return framesBetween(read, until, this.#capacity);
  }

  /**
   * Skips the audio the writer marked with {@link RingWriter.discard}, as a
   * rewind for a seek needs. The reader's to call: it moves only the read
   * position, which is the reader's alone, and only forward, to a mark the
   * reader has not read past. Without a new mark it discards nothing, since
   * only the writer knows which of the audio belongs to the old position.
   */
  clear(): void {
    this.#ended = false;
    const discards = Atomics.load(this.#header, Header.Discards);
    if (discards === this.#skipped) return;
    // A mark stored after the count was loaded is a later discard's, still
    // ahead of the read position, so skipping to it is safe: the count kept
    // is the earlier one, and reads stop at the mark until the next reset.
    Atomics.store(this.#header, Header.Read, Atomics.load(this.#header, Header.Mark));
    this.#skipped = discards;
  }
}
