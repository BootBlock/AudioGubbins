/**
 * The messages the workers exchange over a message channel of their own for
 * each stream (ADR-0090, ADR-0092).
 *
 * Only the storage worker writes, and no sample passes through the page, so a
 * decoded import and an encoded export each travel from the codec worker to
 * the storage worker, and a rendered export from the render worker to the
 * codec worker: blocks or bytes in order, then one end. The receiver grants
 * credit, how many more messages it will take, by `ready`, and the sender
 * sends no message, its end included, past the credit granted; a receiver
 * that awaits a stream keeps credit outstanding, so a sender always has room
 * to end. Neither side runs ahead of the other by more than the credit, and
 * neither holds a whole sound. Each message is read field by field on arrival
 * (`stream-message-reading.ts`).
 */

import type { FinishedAudioFile, MetadataMap } from '@audiogubbins/codecs';
import type { ChannelLayout, DomainFailure, SampleCount } from '@audiogubbins/domain';

/** What a decoded stream is, sent once before its first block. */
export interface DecodedStreamDescription {
  readonly sampleRate: number;
  readonly layout: ChannelLayout;

  /** The frames the stream states it holds, or `undefined` where it states none. */
  readonly statedFrames: SampleCount | undefined;
  readonly metadata: MetadataMap;
}

/**
 * The codec worker's side of a decoded import: the description, planar 32-bit
 * float blocks at the stream's own rate (their buffers transferred), then the
 * end with the frames decoded, or the failure that ends the stream.
 */
export type DecodedStreamMessage =
  | { readonly kind: 'description'; readonly description: DecodedStreamDescription }
  | { readonly kind: 'block'; readonly channels: readonly Float32Array[]; readonly frames: number }
  | { readonly kind: 'end'; readonly frames: SampleCount }
  | { readonly kind: 'failed'; readonly failure: DomainFailure };

/**
 * The codec worker's side of an encoded export: body bytes in order (their
 * buffers transferred), then the file's head and tail with the metadata parts
 * the format dropped, or the failure that ends the stream.
 */
export type EncodedStreamMessage =
  | { readonly kind: 'body'; readonly bytes: Uint8Array }
  | { readonly kind: 'finished'; readonly file: FinishedAudioFile }
  | { readonly kind: 'failed'; readonly failure: DomainFailure };

/**
 * The render worker's side of a rendered export: planar 32-bit float blocks at
 * the export's rate and layout (their buffers transferred), then the end with
 * the frames rendered, or the failure that ends the stream.
 */
export type RenderedStreamMessage =
  | { readonly kind: 'block'; readonly channels: readonly Float32Array[]; readonly frames: number }
  | { readonly kind: 'end'; readonly frames: SampleCount }
  | { readonly kind: 'failed'; readonly failure: DomainFailure };

/**
 * The receiver's side of any of the channels: credit for more messages, or a
 * refusal that ends the stream, such as a write refused for quota or a
 * cancelled job.
 */
export type StreamReceiverMessage =
  | { readonly kind: 'ready'; readonly credit: number }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };
