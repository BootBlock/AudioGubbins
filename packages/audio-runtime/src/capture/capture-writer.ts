/**
 * The capture processor's end of a take's capture channel (ADR-0070): it
 * hands the queued frames on, a bounded block at a time, as posted blocks or
 * into a ring of shared memory, and says where frames were lost and why the
 * take ended.
 *
 * It sends only when a whole block waits, or when the take is ending, so the
 * audio thread posts a message every block of frames rather than every quantum.
 * A posted block's arrays are made for it and transferred, which is what
 * posting needs and all it allocates; a ring is written from arrays made once,
 * when the take starts, and the message after each write only says how far the
 * ring now holds the take. The reader reads no further than that, so a gap the
 * writer reports is always known before the frames after it are read. The
 * writer never closes the port: a port closed straight after a post may lose
 * the post, and the reader closes its own end at the take's end.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import { RingWriter } from '../feed/sample-ring.js';
import type { CaptureQueue } from './capture-queue.js';
import {
  CaptureTransport,
  CaptureWireKind,
  type CaptureEnd,
  type CaptureWire,
} from './capture-wire.js';

/**
 * The most frames one block carries: about 85 ms at 48 kHz, so a take posts
 * about a dozen messages a second, and a queue full of retrospective audio
 * empties at 32 times the rate the input arrives.
 */
export const CAPTURE_BLOCK_FRAMES = 4096;

/** What a message that transfers nothing transfers, made once. */
const NO_TRANSFER: ArrayBuffer[] = [];

/** The part of a `MessagePort` the writer posts on, which the worklet's scope declares. */
export interface CapturePort {
  postMessage(message: CaptureWire, transfer: ArrayBuffer[]): void;
}

/** What a take's channel opens with. */
export interface CaptureBegin {
  /** The context frame of the take's first frame. */
  readonly frame: number;
  readonly sampleRate: SampleRate;
  readonly channels: number;
  /** The ring's memory, where memory is shared; none where blocks are posted. */
  readonly ring: SharedArrayBuffer | undefined;
}

/** Where the frames go: posted, or written into a ring, at most `room` at once. */
interface CaptureSink {
  room(): number;
  /** Sends the oldest `frames` frames of `queue`, the first of them at context frame `frame`. */
  send(queue: CaptureQueue, frames: number, frame: number): void;
}

class PostedSink implements CaptureSink {
  readonly #port: CapturePort;
  readonly #channels: number;

  constructor(port: CapturePort, channels: number) {
    this.#port = port;
    this.#channels = channels;
  }

  room(): number {
    return CAPTURE_BLOCK_FRAMES;
  }

  send(queue: CaptureQueue, frames: number, frame: number): void {
    const channels = Array.from({ length: this.#channels }, () => new Float32Array(frames));
    queue.peek(channels, frames);
    this.#port.postMessage(
      { kind: CaptureWireKind.Block, frame, channels },
      channels.map((channel) => channel.buffer),
    );
  }
}

class RingSink implements CaptureSink {
  readonly #port: CapturePort;
  readonly #ring: RingWriter;
  /** Where a block is gathered from the queue before it is written, made once. */
  readonly #staging: readonly Float32Array[];

  constructor(port: CapturePort, ring: RingWriter, channels: number) {
    this.#port = port;
    this.#ring = ring;
    this.#staging = Array.from({ length: channels }, () => new Float32Array(CAPTURE_BLOCK_FRAMES));
  }

  room(): number {
    return this.#ring.available;
  }

  send(queue: CaptureQueue, frames: number, frame: number): void {
    queue.peek(this.#staging, frames);
    this.#ring.writeFrames(this.#staging, frames);
    this.#port.postMessage({ kind: CaptureWireKind.Written, frame: frame + frames }, NO_TRANSFER);
  }
}

/** The processor's end of one take's capture channel. */
export class CaptureWriter {
  readonly #port: CapturePort;
  readonly #sink: CaptureSink;
  /** The context frame the next frame sent is, which is where a gap would start. */
  #next: number;

  private constructor(port: CapturePort, sink: CaptureSink, frame: number) {
    this.#port = port;
    this.#sink = sink;
    this.#next = frame;
  }

  /**
   * Opens a take's channel on `port`: says where the take begins and how its
   * frames cross, or why the ring it was given is not one of its channels.
   */
  static open(port: CapturePort, begin: CaptureBegin): DomainResult<CaptureWriter> {
    const { frame, sampleRate, channels, ring } = begin;
    if (ring === undefined) {
      port.postMessage(
        {
          kind: CaptureWireKind.Begin,
          transport: CaptureTransport.Posted,
          frame,
          sampleRate,
          channels,
        },
        NO_TRANSFER,
      );
      return succeed(new CaptureWriter(port, new PostedSink(port, channels), frame));
    }
    const writer = RingWriter.open(ring);
    if (!writer.ok) return writer;
    if (writer.value.channelCount !== channels || writer.value.queued !== 0) {
      return fail(
        failure(
          'capture.ring-unfit',
          FailureKind.Rejected,
          `A take of ${String(channels)} channels needs an empty ring of as many, not a ring of ${String(writer.value.channelCount)} holding ${String(writer.value.queued)} frames.`,
        ),
      );
    }
    const sink = new RingSink(port, writer.value, channels);
    port.postMessage(
      {
        kind: CaptureWireKind.Begin,
        transport: CaptureTransport.SharedRing,
        frame,
        sampleRate,
        channels,
        ring,
      },
      NO_TRANSFER,
    );
    return succeed(new CaptureWriter(port, sink, frame));
  }

  /**
   * Sends one block of `queue`'s frames, where a whole block waits or the
   * take is ending (`flush`), as many as the sink has room for, and answers
   * how many it sent. Frames the queue could not keep are reported first.
   */
  send(queue: CaptureQueue, flush: boolean): number {
    const waiting = queue.queued;
    if (waiting === 0 || (!flush && waiting < CAPTURE_BLOCK_FRAMES)) return 0;
    this.#reportLossBefore(queue.headFrame);
    const frames = Math.min(waiting, CAPTURE_BLOCK_FRAMES, this.#sink.room());
    if (frames === 0) return 0;
    this.#sink.send(queue, frames, this.#next);
    queue.advance(frames);
    this.#next += frames;
    return frames;
  }

  /**
   * Ends the take at `end.frame`, the frame after its last, reporting as lost
   * any frame before it that was never sent.
   */
  end(end: CaptureEnd): void {
    this.#reportLossBefore(end.frame);
    this.#port.postMessage({ kind: CaptureWireKind.End, ...end }, NO_TRANSFER);
  }

  /** Says the frames from the next unsent one up to `frame` were captured and lost. */
  #reportLossBefore(frame: number): void {
    if (frame <= this.#next) return;
    this.#port.postMessage(
      {
        kind: CaptureWireKind.Gap,
        frame: this.#next,
        frames: frame - this.#next,
      },
      NO_TRANSFER,
    );
    this.#next = frame;
  }
}
