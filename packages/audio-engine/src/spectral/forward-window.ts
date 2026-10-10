/**
 * A span of a stream held while it is read forwards: what a spectral edit's
 * frames, and the chain a `process` edit runs, read their input from.
 *
 * A plan's readers are read in order, and a read behind the last starts a
 * processed stream again from its start (`processed-content.ts`), so frames
 * that overlap must not each read their samples afresh. The window reads its
 * source only forwards, keeps what it has read until it is let go, and gives
 * the same samples to every frame and to a chain that reads the same input,
 * so the source is read once however many read from the window. A request
 * behind what it holds starts it again from there, which is the stream read
 * again in order. Samples outside the stream are silence, never read.
 */

import type { CancellationSignal } from '@audiogubbins/domain';

/** What a window reads: content of `channels` channels, read in order. */
export interface WindowSource {
  read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void>;
}

/** The smallest number of frames a window holds room for. */
const SMALLEST_ROOM = 4_096;

/** A stream's samples from `start` to `end`, read forwards from its source. */
export class ForwardWindow {
  readonly #source: WindowSource;
  readonly #length: number;
  #held: Float32Array[];
  /** The position of the first sample held. */
  #start = 0;
  /** The position after the last sample held. */
  #end = 0;

  constructor(source: WindowSource, channels: number, length: number) {
    this.#source = source;
    this.#length = length;
    this.#held = Array.from({ length: channels }, () => new Float32Array(SMALLEST_ROOM));
  }

  /** The position the first sample held stands for. */
  get start(): number {
    return this.#start;
  }

  /**
   * Holds every sample from `start` to `end`, reading only what it does not
   * already hold, and only forwards.
   */
  async hold(start: number, end: number, signal?: CancellationSignal): Promise<void> {
    if (start < this.#start || start > this.#end) {
      this.#start = start;
      this.#end = start;
    }
    if (end <= this.#end) return;
    this.#room(end - this.#start);
    const from = this.#end;
    const readFrom = Math.max(from, 0);
    const readTo = Math.min(end, this.#length);
    const offset = from - this.#start;
    // Silence before and after the stream, which is never read.
    for (const channel of this.#held) {
      channel.fill(0, offset, end - this.#start);
    }
    if (readTo > readFrom) {
      const at = readFrom - this.#start;
      const into = this.#held.map((channel) => channel.subarray(at, at + readTo - readFrom));
      await this.#source.read(readFrom, readTo - readFrom, into, signal);
    }
    this.#end = end;
  }

  /** Copies `frames` held samples from `start` into `into`, from `offset` of each. */
  copy(start: number, frames: number, into: readonly Float32Array[], offset = 0): void {
    const at = start - this.#start;
    for (let channel = 0; channel < into.length; channel += 1) {
      const held = this.#held[channel];
      const target = into[channel];
      if (held === undefined || target === undefined) continue;
      target.set(held.subarray(at, at + frames), offset);
    }
  }

  /** Channel `channel`'s samples held, the first at {@link start}. */
  samples(channel: number): Float32Array {
    const held = this.#held[channel];
    if (held === undefined) throw new Error('A window holds every channel of its stream.');
    return held;
  }

  /** Lets go of every sample before `position`, which is not read again unless asked for. */
  release(position: number): void {
    const drop = Math.min(position, this.#end) - this.#start;
    if (drop <= 0) return;
    for (const channel of this.#held) channel.copyWithin(0, drop, this.#end - this.#start);
    this.#start += drop;
  }

  /** Makes room for `frames` samples from the first held. */
  #room(frames: number): void {
    const current = this.#held[0]?.length ?? 0;
    if (frames <= current) return;
    let size = current;
    while (size < frames) size *= 2;
    const used = this.#end - this.#start;
    this.#held = this.#held.map((channel) => {
      const larger = new Float32Array(size);
      larger.set(channel.subarray(0, used));
      return larger;
    });
  }
}
