/**
 * What the capture processor keeps of its input (ADR-0070): the retrospective
 * buffer while armed, and each take from the frame Record names to the one Stop
 * names.
 *
 * Nothing is kept unless the input is armed with a retrospective buffer, or
 * recording. The buffer's memory, and the queue of a take begun without one,
 * are made on a message, never in a quantum, and are overwritten with zeros
 * when disarmed, when the buffer is rearmed or turned off, and when the input
 * is let go, as on a change of device (REQ-REC-090). A take begun while the
 * buffer holds frames starts with them, and the processor says, in its
 * `recording` reply, exactly which context frame is the take's first.
 *
 * It answers each command with a reply, or a refusal that changes nothing,
 * through the processor's port; when a command applies is the recording
 * session's to decide on the page, and this only refuses what it cannot do.
 */

import { CaptureQueue } from '../capture/capture-queue.js';
import { CaptureEndReason } from '../capture/capture-wire.js';
import { CaptureWriter } from '../capture/capture-writer.js';
import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';
import {
  FromCaptureKind,
  ToCaptureKind,
  retrospectiveRefusal,
  type FromCapture,
  type ToCapture,
} from '../protocol/capture-messages.js';
import type { CaptureInput } from './capture-input.js';
import { CaptureTake, abandonedEnd, type AbandonReason } from './capture-take.js';

/**
 * Seconds a take's queue holds beyond its retrospective frames, for a capture
 * channel whose reader falls behind for a moment.
 */
const CAPTURE_QUEUE_SECONDS = 2;

/** An armed input: the frames it keeps before a take, and where, none where the buffer is off. */
interface Armed {
  readonly keep: number;
  readonly queue: CaptureQueue | undefined;
}

type RecordCommand = Extract<ToCapture, { readonly kind: typeof ToCaptureKind.Record }>;

/** A record waiting for the quantum its frame falls in, and a stop asked for before it began. */
interface PendingTake {
  readonly record: RecordCommand;
  readonly stopAt: number | undefined;
}

/** The retrospective buffer and the takes of one input. */
export class CaptureRecorder {
  readonly #input: CaptureInput;
  readonly #post: (message: FromCapture) => void;
  #armed: Armed | undefined;
  #pending: PendingTake | undefined;
  #take: CaptureTake | undefined;
  /** The queue of a take begun unarmed, or armed without a buffer, let go when it ends. */
  #ownQueue: CaptureQueue | undefined;
  /** Frames of ended takes lost since the last report. */
  #lost = 0;

  constructor(input: CaptureInput, post: (message: FromCapture) => void) {
    this.#input = input;
    this.#post = post;
  }

  /** The retrospective buffer, for a test to read what it holds. */
  get retrospective(): CaptureQueue | undefined {
    return this.#armed?.queue;
  }

  /** Frames the retrospective buffer holds now, none while a take has them. */
  get bufferedFrames(): number {
    return this.#take === undefined ? (this.#armed?.queue?.queued ?? 0) : 0;
  }

  /** Frames captured and not kept since the last call, and none from then. */
  takeLost(): number {
    const lost = this.#lost + (this.#take?.takeLost() ?? 0);
    this.#lost = 0;
    return lost;
  }

  /** Arms with `seconds` of retrospective buffer, none at zero, replacing any buffer kept. */
  arm(seconds: number): void {
    if (this.#recording()) {
      this.#refuse(ToCaptureKind.Arm, 'The input is recording; stop first.');
      return;
    }
    const refusal = retrospectiveRefusal(seconds);
    if (refusal !== undefined) {
      this.#refuse(ToCaptureKind.Arm, refusal);
      return;
    }
    this.#armed?.queue?.erase();
    const keep = Math.round(seconds * this.#input.sampleRate);
    const queue = keep === 0 ? undefined : this.#queueBeyond(keep);
    this.#armed = { keep, queue };
    this.#post({ kind: FromCaptureKind.Armed, retrospectiveFrames: keep });
  }

  disarm(): void {
    if (this.#recording()) {
      this.#refuse(ToCaptureKind.Disarm, 'The input is recording; stop first.');
      return;
    }
    this.#armed?.queue?.erase();
    this.#armed = undefined;
    this.#post({ kind: FromCaptureKind.Disarmed });
  }

  record(message: RecordCommand): void {
    if (this.#recording()) {
      this.#refuse(message.kind, 'The input is already recording.');
      return;
    }
    this.#pending = { record: message, stopAt: undefined };
  }

  stop(at: number): void {
    if (this.#take !== undefined) {
      this.#take.stop(at);
      return;
    }
    if (this.#pending !== undefined) {
      // A take that has not begun yet still begins, so its channel is told
      // where it ends rather than its reader being left waiting.
      this.#pending = { ...this.#pending, stopAt: at };
      return;
    }
    this.#refuse(ToCaptureKind.Stop, 'The input is not recording.');
  }

  /**
   * Keeps the quantum at context frame `frame`, which must run before
   * anything else reads `dry`: a take begun, continued or ended, or the
   * retrospective buffer rolled.
   */
  capture(dry: readonly Float32Array[], frame: number): void {
    const pending = this.#pending;
    if (pending !== undefined && pending.record.at < frame + RENDER_QUANTUM_FRAMES) {
      this.#pending = undefined;
      this.#begin(pending, dry, frame);
    } else if (this.#take !== undefined) {
      this.#take.capture(dry, 0, RENDER_QUANTUM_FRAMES, frame);
    } else {
      this.#roll(dry, 0, RENDER_QUANTUM_FRAMES, frame);
    }
    const take = this.#take;
    if (take?.send() === true) this.#ended(take, CaptureEndReason.Stopped);
  }

  /**
   * Ends a take, or one waiting to begin, for `why`, and overwrites every
   * buffer with zeros: the input is being let go.
   */
  letGo(why: AbandonReason): void {
    const take = this.#take;
    if (take !== undefined) {
      take.abandon(why);
      if (why.reason === CaptureEndReason.Released) this.#ended(take, why.reason);
      this.#take = undefined;
    }
    if (this.#pending !== undefined) this.#endUnbegun(this.#pending.record, why);
    this.#pending = undefined;
    this.#armed?.queue?.erase();
    this.#armed = undefined;
    this.#dropOwnQueue();
  }

  #recording(): boolean {
    return this.#take !== undefined || this.#pending !== undefined;
  }

  /** Keeps frames in the retrospective buffer, where the input is armed with one. */
  #roll(dry: readonly Float32Array[], offset: number, frames: number, frame: number): void {
    const armed = this.#armed;
    armed?.queue?.roll(dry, offset, frames, frame + offset, armed.keep);
  }

  /**
   * Begins the take `pending` asked for in the quantum at `frame`: the frames
   * before its start go to the retrospective buffer, which then becomes the
   * take's first frames, and the rest are the take's.
   */
  #begin(pending: PendingTake, dry: readonly Float32Array[], frame: number): void {
    const { record, stopAt } = pending;
    const start = Math.max(record.at, frame);
    const offset = start - frame;
    this.#roll(dry, 0, offset, frame);
    const queue = this.#armed?.queue ?? this.#makeOwnQueue();
    const firstFrame = queue.queued > 0 ? queue.headFrame : start;
    const writer = CaptureWriter.open(record.channel, {
      frame: firstFrame,
      sampleRate: this.#input.sampleRate,
      channels: this.#input.channels,
      ring: record.ring,
    });
    if (!writer.ok) {
      this.#dropOwnQueue();
      this.#refuse(ToCaptureKind.Record, writer.failures[0].summary);
      return;
    }
    const take = new CaptureTake(queue, writer.value, firstFrame, start);
    this.#take = take;
    if (stopAt !== undefined) take.stop(stopAt);
    take.capture(dry, offset, RENDER_QUANTUM_FRAMES - offset, frame);
    this.#post({
      kind: FromCaptureKind.Recording,
      firstFrame,
      startFrame: start,
      retrospectiveFrames: start - firstFrame,
    });
  }

  /** A take has ended and said so on its channel: its queue goes back to rolling, or is let go. */
  #ended(
    take: CaptureTake,
    reason: typeof CaptureEndReason.Stopped | typeof CaptureEndReason.Released,
  ): void {
    this.#lost += take.takeLost();
    this.#take = undefined;
    this.#armed?.queue?.clear();
    this.#dropOwnQueue();
    this.#post({ kind: FromCaptureKind.Stopped, endFrame: take.endFrame, reason });
  }

  /**
   * Opens and ends at once the channel of a take that never began, so its
   * reader hears why rather than waiting for a beginning that will not come.
   */
  #endUnbegun(record: RecordCommand, why: AbandonReason): void {
    const writer = CaptureWriter.open(record.channel, {
      frame: record.at,
      sampleRate: this.#input.sampleRate,
      channels: this.#input.channels,
      ring: record.ring,
    });
    if (writer.ok) writer.value.end(abandonedEnd(why, record.at));
  }

  /** A queue that keeps `keep` frames and the seconds a take's reader may fall behind by. */
  #queueBeyond(keep: number): CaptureQueue {
    const headroom = Math.round(CAPTURE_QUEUE_SECONDS * this.#input.sampleRate);
    return new CaptureQueue(this.#input.channels, keep + headroom);
  }

  #makeOwnQueue(): CaptureQueue {
    const queue = this.#queueBeyond(0);
    this.#ownQueue = queue;
    return queue;
  }

  #dropOwnQueue(): void {
    this.#ownQueue?.erase();
    this.#ownQueue = undefined;
  }

  #refuse(command: ToCapture['kind'], reason: string): void {
    this.#post({ kind: FromCaptureKind.Refused, command, reason });
  }
}
