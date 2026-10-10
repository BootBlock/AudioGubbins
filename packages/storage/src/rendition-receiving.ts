/**
 * Writing a decoded stream as it arrives into the data of its rendition
 * (ADR-0090, REQ-EXEC-216): 32-bit floats, little-endian and interleaved in
 * the stream's channel order, which `stored-wav.ts` then heads and stores.
 *
 * The data goes to one scratch file in the storage's staging, written through
 * one sink and closed once the stream ends: a rendition cut short by a crash
 * is made again by importing again, so it needs no chunk a crash keeps, and
 * the staging is cleared whenever the storage worker starts. Each block is
 * interleaved into one buffer, grown to the largest block and reused, so a
 * long file is never held in memory.
 *
 * A stream that fails part way, that breaks the order its messages come in,
 * whose write the storage refuses, or whose import is cancelled keeps
 * nothing: the scratch file is abandoned and removed, and the codec worker is
 * told the stream is refused so it stops decoding.
 */

import {
  derivedSampleCount,
  fail,
  succeed,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import {
  TreeFailure,
  type ByteSink,
  type ByteSource,
  type StorageTree,
} from '@audiogubbins/project-format';

import type { DecodedStream } from './decoded-stream.js';
import { importCancelled, streamEmpty, streamOutOfOrder } from './import-failures.js';
import { FLOAT_SAMPLE_BYTES, interleaveFloats } from './interleaved-floats.js';
import { storageRefused } from './storage-failures.js';

/** A rendition's data, written whole, and the way to remove it once it is stored or abandoned. */
export interface ReceivedRendition {
  readonly frames: SampleCount;
  readonly data: ByteSource;
  readonly discard: () => Promise<void>;
}

/** Where a rendition's data is written: a file of the storage's staging. */
export interface RenditionScratch {
  readonly tree: StorageTree;
  readonly path: string;
}

/** What one message of the stream came to. */
type Received =
  | { readonly kind: 'more' }
  | { readonly kind: 'ended'; readonly frames: number }
  | { readonly kind: 'failed'; readonly failure: DomainFailure };

/**
 * Writes the blocks `stream` brings after its description, of `layout`'s
 * channels, into `scratch`, telling `decoded` the frames written so far (see
 * the module comment). Rejects with the signal's reason, having kept nothing,
 * where the import is cancelled.
 */
export async function receiveRendition(
  stream: DecodedStream,
  layout: ChannelLayout,
  scratch: RenditionScratch,
  decoded: (frames: number) => void,
  signal?: AbortSignal,
): Promise<DomainResult<ReceivedRendition>> {
  const channels = layout.roles.length;
  const discard = async (): Promise<void> => {
    await scratch.tree.remove(scratch.path);
  };
  let sink: ByteSink | undefined;
  let closed = false;
  try {
    sink = await scratch.tree.createFile(scratch.path);
    const writer = new BlockWriter(sink, channels);
    for (;;) {
      signal?.throwIfAborted();
      const message = await stream.next();
      // A cancel heard while the stream was awaited ends it here, whatever came.
      signal?.throwIfAborted();
      const received = await receiveOne(message, writer, channels);
      if (received.kind === 'failed') {
        stream.refuse(received.failure);
        return fail(received.failure);
      }
      if (received.kind === 'ended') {
        if (received.frames === 0) {
          stream.refuse(streamEmpty());
          return fail(streamEmpty());
        }
        await sink.close();
        closed = true;
        stream.close();
        const data = await scratch.tree.openFile(scratch.path);
        if (data === undefined) throw new TreeFailure('io', 'The decoded audio vanished.');
        return succeed({ frames: derivedSampleCount(received.frames), data, discard });
      }
      decoded(writer.frames);
    }
  } catch (error) {
    // Whatever ended the stream, the codec worker is told, so it stops
    // decoding: a cancelled import rejects with the cancellation, a write the
    // storage refused is the import's failure, and anything else is a defect.
    if (signal?.aborted === true) {
      stream.refuse(importCancelled());
      throw error;
    }
    if (!(error instanceof TreeFailure)) {
      stream.refuse(streamOutOfOrder('the storage failed to write it'));
      throw error;
    }
    const refused = storageRefused(error);
    stream.refuse(refused);
    return fail(refused);
  } finally {
    if (!closed) await abandon(sink, discard);
  }
}

/** Takes one message of the stream, writing a block's frames. */
async function receiveOne(
  message: Awaited<ReturnType<DecodedStream['next']>>,
  writer: BlockWriter,
  channels: number,
): Promise<Received> {
  switch (message?.kind) {
    case undefined:
      return { kind: 'failed', failure: streamOutOfOrder('the stream stopped before its end') };
    case 'description':
      return { kind: 'failed', failure: streamOutOfOrder('a second description came') };
    case 'failed':
      return { kind: 'failed', failure: message.failure };
    case 'end':
      return message.frames === writer.frames
        ? { kind: 'ended', frames: writer.frames }
        : {
            kind: 'failed',
            failure: streamOutOfOrder(
              `it ended at ${String(message.frames)} frames after sending ${String(writer.frames)}`,
            ),
          };
    case 'block': {
      const { frames } = message;
      const whole =
        Number.isSafeInteger(frames) &&
        frames > 0 &&
        message.channels.length === channels &&
        message.channels.every((channel) => channel.length >= frames);
      if (!whole) {
        return {
          kind: 'failed',
          failure: streamOutOfOrder('a block was not one array of its frames for each channel'),
        };
      }
      await writer.write(message.channels, frames);
      return { kind: 'more' };
    }
  }
}

/** Abandons a scratch file part written, and removes it. */
async function abandon(sink: ByteSink | undefined, discard: () => Promise<void>): Promise<void> {
  try {
    await sink?.abort();
    await discard();
  } catch (error) {
    // A scratch file that cannot be removed now is removed with the staging
    // when the storage worker next starts; what failed the import is what its
    // caller hears.
    if (!(error instanceof TreeFailure)) throw error;
  }
}

/**
 * Interleaves blocks into one buffer and writes them, refilling the buffer
 * once each write has taken it, as a sink's write does before it resolves.
 */
class BlockWriter {
  readonly #sink: ByteSink;
  readonly #channels: number;
  #buffer = new Uint8Array(0);
  #view = new DataView(this.#buffer.buffer);
  #frames = 0;

  constructor(sink: ByteSink, channels: number) {
    this.#sink = sink;
    this.#channels = channels;
  }

  /** The frames written. */
  get frames(): number {
    return this.#frames;
  }

  async write(channels: readonly Float32Array[], frames: number): Promise<void> {
    const bytes = frames * this.#channels * FLOAT_SAMPLE_BYTES;
    if (this.#buffer.length < bytes) {
      this.#buffer = new Uint8Array(bytes);
      this.#view = new DataView(this.#buffer.buffer);
    }
    interleaveFloats(channels, 0, frames, this.#view, 0);
    await this.#sink.write(this.#buffer.subarray(0, bytes));
    this.#frames += frames;
  }
}
