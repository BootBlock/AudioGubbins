/**
 * The storage worker's end of a take's capture channel (ADR-0070, ADR-0071):
 * the take's frames in order, each block named by the context frame it was
 * captured at, every run of frames lost said as a gap of that many, and the
 * end with its reason.
 *
 * It reads posted blocks and a ring of shared memory alike, so the worker that
 * commits the take knows neither. A ring is read only as far as the capture
 * processor has said it is written, and only when the worker asks for the next
 * block, so a worker that falls behind leaves the ring full and the processor's
 * queue filling, which the processor reports as a gap rather than overwriting
 * what the worker has not read. Posted blocks cannot wait in the audio thread,
 * so they wait here, up to a bound in seconds; a block past it is let go and
 * reported as a gap, rather than the worker's memory growing with a take that
 * may last an hour (REQ-PROD-009).
 *
 * Nothing it is sent is trusted: a message that does not read, one out of
 * order, or one lost in crossing ends the take as failed, with the reason,
 * after every frame that came before it. It uses only a `MessagePort` and
 * shared memory, so it runs in a dedicated worker.
 */

import type { SampleRate } from '@audiogubbins/domain';

import { RingReader } from '../feed/sample-ring.js';
import { CAPTURE_BLOCK_FRAMES } from './capture-writer.js';
import {
  CaptureEndReason,
  CaptureTransport,
  CaptureWireKind,
  readCaptureWire,
  type CaptureEnd,
  type CaptureWire,
} from './capture-wire.js';

/** What a take's channel brings, in order. */
export type CaptureEvent =
  | {
      /** The take begins: its first frame, its rate and channels, and how they crossed. */
      readonly kind: 'begin';
      readonly frame: number;
      readonly sampleRate: SampleRate;
      readonly channels: number;
      readonly transport: CaptureTransport;
    }
  | {
      /** The take's frames from context frame `frame` on, one array per channel, the reader's to keep. */
      readonly kind: 'block';
      readonly frame: number;
      readonly channels: readonly Float32Array[];
    }
  | {
      /** `frames` frames from context frame `frame` were captured and lost. */
      readonly kind: 'gap';
      readonly frame: number;
      readonly frames: number;
    }
  | ({ readonly kind: 'end' } & CaptureEnd);

/** How long posted blocks may wait for a worker that has fallen behind, by default. */
const CAPTURE_HELD_SECONDS = 30;

/** What a reader is made with. */
export interface CaptureReaderOptions {
  /** Seconds of posted blocks held for a slow worker before more are let go as a gap. */
  readonly heldSeconds?: number;
}

type Begin = Extract<CaptureWire, { readonly kind: typeof CaptureWireKind.Begin }>;

/** A take read from a ring: how far it is written, and the gaps in it not yet reached. */
interface RingTake {
  readonly reader: RingReader;
  readonly channels: number;
  /** The frame the ring holds the take up to. */
  written: number;
  readonly gaps: { readonly frame: number; readonly frames: number }[];
  end: CaptureEnd | undefined;
}

/** A take's capture channel, read. */
export class CaptureReader implements AsyncIterable<CaptureEvent> {
  readonly #port: MessagePort;
  readonly #heldSeconds: number;
  /** What waits to be read, in order: the begin, posted blocks, gaps and the end. */
  readonly #events: CaptureEvent[] = [];
  #begin: Begin | undefined;
  #ring: RingTake | undefined;
  /** The frame after the last that arrived or was lost, which the next must start at. */
  #arrived = 0;
  /** The frame the next block read starts at. */
  #cursor = 0;
  #heldFrames = 0;
  /** Whether the end is in hand: no message after it counts. */
  #ended = false;
  /** Whether the end has been read, after which nothing more is. */
  #done = false;
  #waiting: (() => void) | undefined;

  constructor(port: MessagePort, options: CaptureReaderOptions = {}) {
    this.#port = port;
    this.#heldSeconds = options.heldSeconds ?? CAPTURE_HELD_SECONDS;
    port.onmessage = (event: MessageEvent<unknown>) => {
      this.#receive(event.data);
    };
    // Audio that could not be received is audio lost, of a length nobody
    // knows, so the take cannot go on as if it were whole.
    port.onmessageerror = () => {
      this.#fail('Part of the recording could not be received from the audio thread.');
    };
  }

  /** The next event of the take, waiting for it, or nothing once the end has been read or the reader closed. */
  async next(): Promise<CaptureEvent | undefined> {
    for (;;) {
      if (this.#done) return undefined;
      const event = this.#take();
      if (event !== undefined) {
        if (event.kind === 'end') this.#finish();
        return event;
      }
      await new Promise<void>((resolve) => {
        this.#waiting = resolve;
      });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<CaptureEvent> {
    for (let event = await this.next(); event !== undefined; event = await this.next()) {
      yield event;
    }
  }

  /** Stops reading and closes the channel; a read waiting answers nothing. */
  close(): void {
    this.#finish();
  }

  /** The next event in hand, from the queue and then the ring, or nothing yet. */
  #take(): CaptureEvent | undefined {
    const queued = this.#events.shift();
    if (queued !== undefined) {
      if (queued.kind === 'block') this.#heldFrames -= queued.channels[0]?.length ?? 0;
      return queued;
    }
    const ring = this.#ring;
    return ring === undefined ? undefined : this.#fromRing(ring);
  }

  /** The next gap, block or end of a take read from a ring, as far as it is written. */
  #fromRing(ring: RingTake): CaptureEvent | undefined {
    const gap = ring.gaps[0];
    if (gap !== undefined && gap.frame <= this.#cursor) {
      ring.gaps.shift();
      this.#cursor = gap.frame + gap.frames;
      return { kind: 'gap', frame: gap.frame, frames: gap.frames };
    }
    const until = Math.min(ring.written, gap?.frame ?? Infinity, ring.end?.frame ?? Infinity);
    const frames = Math.min(until - this.#cursor, CAPTURE_BLOCK_FRAMES);
    if (frames > 0) {
      const channels = Array.from({ length: ring.channels }, () => new Float32Array(frames));
      const read = ring.reader.readFrames(channels, frames);
      if (read !== frames) {
        return this.#failure('The recording’s ring held less than the audio thread said it wrote.');
      }
      const frame = this.#cursor;
      this.#cursor += frames;
      return { kind: 'block', frame, channels };
    }
    const end = ring.end;
    if (end === undefined) return undefined;
    if (this.#cursor === end.frame) return { kind: 'end', ...end };
    return this.#failure('The recording ended before the audio thread had written all of it.');
  }

  #receive(data: unknown): void {
    if (this.#ended) return;
    const read = readCaptureWire(data);
    if (!read.ok) {
      this.#fail(`A message of the recording could not be read: ${read.failures[0].summary}`);
      return;
    }
    const problem = this.#accept(read.value);
    if (problem !== undefined) this.#fail(problem);
    this.#wake();
  }

  /** Takes a message in, or answers why it cannot be part of the take. */
  #accept(message: CaptureWire): string | undefined {
    const begin = this.#begin;
    if (message.kind === CaptureWireKind.Begin) {
      return begin === undefined ? this.#open(message) : 'The recording began twice.';
    }
    if (begin === undefined) return 'Audio arrived before the recording began.';
    const ring = this.#ring;
    switch (message.kind) {
      case CaptureWireKind.Block:
        if (ring !== undefined) return 'A block was posted for a recording that crosses in a ring.';
        return this.#acceptBlock(message.frame, message.channels, begin);
      case CaptureWireKind.Written:
        if (ring === undefined) return 'A ring was written for a recording posted in blocks.';
        if (message.frame < ring.written) return 'The ring was said to hold less than before.';
        ring.written = message.frame;
        return undefined;
      case CaptureWireKind.Gap:
        if (message.frame < this.#arrived) return 'A gap arrived for frames already accounted for.';
        this.#arrived = message.frame + message.frames;
        if (ring === undefined) this.#queueGap(message.frame, message.frames);
        else ring.gaps.push({ frame: message.frame, frames: message.frames });
        return undefined;
      case CaptureWireKind.End: {
        const { kind: _kind, ...end } = message;
        this.#ended = true;
        if (ring !== undefined) ring.end = end;
        else if (end.frame !== this.#arrived)
          return 'The recording ended at a frame its audio did not reach.';
        else this.#events.push({ kind: 'end', ...end });
        return undefined;
      }
    }
  }

  #open(begin: Begin): string | undefined {
    this.#begin = begin;
    this.#arrived = begin.frame;
    this.#cursor = begin.frame;
    const { frame, sampleRate, channels, transport } = begin;
    this.#events.push({ kind: 'begin', frame, sampleRate, channels, transport });
    if (begin.transport === CaptureTransport.Posted) return undefined;
    const reader = RingReader.open(begin.ring);
    if (!reader.ok) return `The recording’s ring cannot be read: ${reader.failures[0].summary}`;
    if (reader.value.channelCount !== channels) {
      return 'The recording’s ring holds another number of channels than the recording.';
    }
    this.#ring = { reader: reader.value, channels, written: frame, gaps: [], end: undefined };
    return undefined;
  }

  #acceptBlock(frame: number, channels: readonly Float32Array[], begin: Begin): string | undefined {
    const frames = channels[0]?.length ?? 0;
    if (channels.length !== begin.channels || channels.some((one) => one.length !== frames)) {
      return 'A block arrived whose channels do not match the recording’s.';
    }
    if (frame !== this.#arrived) return 'A block arrived out of order.';
    this.#arrived += frames;
    if (this.#heldFrames + frames > this.#heldSeconds * begin.sampleRate) {
      this.#queueGap(frame, frames);
      return undefined;
    }
    this.#heldFrames += frames;
    this.#events.push({ kind: 'block', frame, channels });
    return undefined;
  }

  /** Queues a gap, joined to one just before it, so a run of blocks let go is said once. */
  #queueGap(frame: number, frames: number): void {
    const last = this.#events.at(-1);
    if (last?.kind === 'gap' && last.frame + last.frames === frame) {
      this.#events[this.#events.length - 1] = { ...last, frames: last.frames + frames };
      return;
    }
    this.#events.push({ kind: 'gap', frame, frames });
  }

  /** Ends the take as failed after everything before it, unless it has ended already. */
  #fail(summary: string): void {
    if (this.#ended) return;
    this.#ended = true;
    if (this.#ring !== undefined) {
      // What the ring holds was written whole, and is read before the end.
      this.#ring.end = { frame: this.#ring.written, reason: CaptureEndReason.Failed, summary };
    } else {
      this.#events.push({
        kind: 'end',
        frame: this.#arrived,
        reason: CaptureEndReason.Failed,
        summary,
      });
    }
    this.#wake();
  }

  /** The end of a take read from a ring that cannot be read further, after what was read. */
  #failure(summary: string): CaptureEvent {
    return { kind: 'end', frame: this.#cursor, reason: CaptureEndReason.Failed, summary };
  }

  #finish(): void {
    if (this.#done) return;
    this.#done = true;
    this.#ended = true;
    this.#port.onmessage = null;
    this.#port.onmessageerror = null;
    this.#port.close();
    this.#wake();
  }

  #wake(): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    waiting?.();
  }
}
