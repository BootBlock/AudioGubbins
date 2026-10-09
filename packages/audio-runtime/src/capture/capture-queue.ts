/**
 * The capture processor's own memory of the input (ADR-0070): the
 * retrospective buffer while an input is armed, and the queue of a take's
 * frames until the capture channel has taken them.
 *
 * One ring of planar samples does both, so the seconds kept before Record
 * become the take's first frames without a copy: while armed it rolls,
 * keeping only the last frames it is allowed and letting the oldest go, and
 * from the frame Record names it queues, every frame kept until the channel
 * takes it. The channel takes a bounded block a quantum, more than a quantum
 * holds, so a queue that starts full of retrospective audio empties while the
 * input goes on arriving behind it.
 *
 * A queue that fills, because the reader at the channel's far end has fallen
 * behind, keeps no more until it has emptied, and the frame its next audio
 * starts at says how many were lost: the channel reports that as a gap,
 * never as audio that was not captured. Waiting for it to empty, rather than
 * taking frames again as soon as there is room, keeps the queue one run of
 * consecutive frames, so no frame in it needs to be labelled.
 *
 * Its memory is made when an input is armed or a take starts, on a message
 * and never in a quantum, and is overwritten with zeros before it is let go
 * (REQ-REC-090). A quantum copies samples and moves counts, allocating
 * nothing.
 */

/** Frames of `input` from `offset`, a missing channel as silence. */
function copyIn(
  stored: readonly Float32Array[],
  input: readonly Float32Array[],
  offset: number,
  frames: number,
  at: number,
): void {
  for (let channel = 0; channel < stored.length; channel += 1) {
    const into = stored[channel];
    if (into === undefined) continue;
    const from = input[channel];
    let index = at;
    for (let frame = 0; frame < frames; frame += 1) {
      into[index] = from === undefined ? 0 : (from[offset + frame] ?? 0);
      index = index + 1 === into.length ? 0 : index + 1;
    }
  }
}

/** A ring of the input's channels, rolling while armed and queueing while recording. */
export class CaptureQueue {
  readonly #channels: readonly Float32Array[];
  readonly #capacity: number;
  /** Where the oldest frame kept is. */
  #head = 0;
  #queued = 0;
  /** The context frame of the oldest frame kept. */
  #headFrame = 0;
  /** Whether the queue filled and keeps nothing until it has emptied. */
  #overflowing = false;

  constructor(channels: number, capacity: number) {
    this.#capacity = capacity;
    this.#channels = Array.from({ length: channels }, () => new Float32Array(capacity));
  }

  get capacity(): number {
    return this.#capacity;
  }

  /** The frames kept and not yet taken. */
  get queued(): number {
    return this.#queued;
  }

  /** The context frame of the oldest frame kept, which the next frame taken is. */
  get headFrame(): number {
    return this.#headFrame;
  }

  /**
   * Keeps `frames` frames of `input` from `offset`, captured from context
   * frame `frame` on, letting the oldest go past the last `keep`: the
   * retrospective buffer. `keep` is at most the capacity.
   */
  roll(
    input: readonly Float32Array[],
    offset: number,
    frames: number,
    frame: number,
    keep: number,
  ): void {
    const kept = Math.min(frames, keep);
    const skipped = frames - kept;
    const excess = Math.max(0, this.#queued + kept - keep);
    this.#drop(excess);
    if (this.#queued === 0) this.#headFrame = frame + skipped;
    copyIn(this.#channels, input, offset + skipped, kept, this.#tail());
    this.#queued += kept;
  }

  /**
   * Queues `frames` frames of `input` from `offset`, captured from context
   * frame `frame` on, and answers how many it could not keep: all of them
   * where the queue is full, or has filled and not yet emptied.
   */
  push(input: readonly Float32Array[], offset: number, frames: number, frame: number): number {
    if (this.#overflowing && this.#queued > 0) return frames;
    this.#overflowing = false;
    if (this.#queued + frames > this.#capacity) {
      this.#overflowing = true;
      return frames;
    }
    if (this.#queued === 0) this.#headFrame = frame;
    copyIn(this.#channels, input, offset, frames, this.#tail());
    this.#queued += frames;
    return 0;
  }

  /** Copies the oldest `frames` frames kept into the start of `into`, one array per channel. */
  peek(into: readonly Float32Array[], frames: number): void {
    for (let channel = 0; channel < this.#channels.length; channel += 1) {
      const from = this.#channels[channel];
      const to = into[channel];
      if (from === undefined || to === undefined) continue;
      let index = this.#head;
      for (let frame = 0; frame < frames; frame += 1) {
        to[frame] = from[index] ?? 0;
        index = index + 1 === from.length ? 0 : index + 1;
      }
    }
  }

  /** Lets the oldest `frames` frames go, once they are taken. */
  advance(frames: number): void {
    this.#drop(frames);
  }

  /** Forgets every frame kept, as a take's end or a rearming does, leaving the memory. */
  clear(): void {
    this.#drop(this.#queued);
    this.#overflowing = false;
  }

  /** Overwrites every sample with zeros, so nothing captured outlives the queue (REQ-REC-090). */
  erase(): void {
    this.clear();
    for (const channel of this.#channels) channel.fill(0);
  }

  #drop(frames: number): void {
    const dropped = Math.min(frames, this.#queued);
    this.#head = (this.#head + dropped) % this.#capacity;
    this.#queued -= dropped;
    this.#headFrame += dropped;
  }

  #tail(): number {
    return (this.#head + this.#queued) % this.#capacity;
  }
}
