/**
 * One take as the capture processor makes it (ADR-0070): the frames from the
 * one Record names to the one Stop names, after whatever the retrospective
 * buffer held, queued in the processor's memory and handed to the take's
 * capture channel a block at a time.
 *
 * The take's frames are the dry input's, copied before anything else in the
 * quantum reads it, and nothing else ever writes them: monitoring, its chain
 * and the meters read the input on their own. A frame the queue could not
 * keep is counted, and the channel reports it as a gap. Stopping takes no
 * more frames from the stop frame on, and the take ends once the queue has
 * handed on the last of what it holds.
 */

import { CaptureEndReason, type CaptureEnd } from '../capture/capture-wire.js';
import type { CaptureQueue } from '../capture/capture-queue.js';
import type { CaptureWriter } from '../capture/capture-writer.js';

/** Why a take ends before it was stopped. */
export type AbandonReason =
  | { readonly reason: typeof CaptureEndReason.Released }
  | { readonly reason: typeof CaptureEndReason.Failed; readonly summary: string };

/** The end of a take ended for `why` before context frame `frame`, as its channel says it. */
export function abandonedEnd(why: AbandonReason, frame: number): CaptureEnd {
  return why.reason === CaptureEndReason.Released
    ? { frame, reason: why.reason }
    : { frame, reason: why.reason, summary: why.summary };
}

/** A take in progress: its queue, its channel, and where it stops. */
export class CaptureTake {
  readonly #queue: CaptureQueue;
  readonly #writer: CaptureWriter;
  /** The context frame of the take's first frame. */
  readonly firstFrame: number;
  /** The context frame the recording itself started at, after the retrospective frames. */
  readonly startFrame: number;
  /** The frame after the last captured or lost, where the next quantum's frames go. */
  #next: number;
  /** The frame the take stops before, once a stop has been asked for. */
  #stopAt: number | undefined;
  /** Frames captured and not kept since the last report. */
  #lost = 0;

  /**
   * A take into `queue`, whose frames before `startFrame`, from `firstFrame`,
   * are the retrospective buffer's, handed on through `writer`.
   */
  constructor(queue: CaptureQueue, writer: CaptureWriter, firstFrame: number, startFrame: number) {
    this.#queue = queue;
    this.#writer = writer;
    this.firstFrame = firstFrame;
    this.startFrame = startFrame;
    this.#next = startFrame;
  }

  /** Whether a stop was asked for and its frame reached, so no more frames are taken. */
  get stopping(): boolean {
    return this.#stopAt !== undefined && this.#next >= this.#stopAt;
  }

  /** Stops before context frame `at`, or at the next frame to capture where that has passed. */
  stop(at: number): void {
    this.#stopAt = Math.max(at, this.#next);
  }

  /**
   * Takes `frames` frames of a quantum that starts at context frame `frame`,
   * from `offset` on, up to the stop.
   */
  capture(input: readonly Float32Array[], offset: number, frames: number, frame: number): void {
    const from = frame + offset;
    const until = Math.min(from + frames, this.#stopAt ?? Infinity);
    if (until <= from) return;
    this.#lost += this.#queue.push(input, offset, until - from, from);
    this.#next = until;
  }

  /**
   * Hands the channel a block where one waits, every frame left once
   * stopping, and answers whether the take has ended: stopped, with nothing
   * left to hand on.
   */
  send(): boolean {
    const stopping = this.stopping;
    this.#writer.send(this.#queue, stopping);
    if (!stopping || this.#queue.queued > 0) return false;
    this.#writer.end({ frame: this.#next, reason: CaptureEndReason.Stopped });
    return true;
  }

  /**
   * Ends the take where it is, for the reason given, and answers the frame
   * after its last: what the queue holds is handed on as far as the channel
   * takes it at once, and the rest is reported lost, since the processor is
   * letting its memory go.
   */
  abandon(why: AbandonReason): number {
    let sent = this.#writer.send(this.#queue, true);
    while (sent > 0) sent = this.#writer.send(this.#queue, true);
    this.#writer.end(abandonedEnd(why, this.#next));
    return this.#next;
  }

  /** The frames lost since the last call, and none from then. */
  takeLost(): number {
    const lost = this.#lost;
    this.#lost = 0;
    return lost;
  }

  /** The frame after the last the take holds. */
  get endFrame(): number {
    return this.#next;
  }
}
