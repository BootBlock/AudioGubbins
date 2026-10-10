/**
 * The messages the codec worker and the storage worker exchange over a message
 * channel (ADR-0090, ADR-0092).
 *
 * Only the storage worker writes, and no sample passes through the page, so a
 * decoded import and an encoded export each travel from the codec worker to
 * the storage worker over a channel of their own: blocks or bytes in order,
 * then one end. The storage worker answers each `ready` with how many more
 * messages it will take, so the codec worker never runs ahead of the writes by
 * more than that credit and neither worker holds a whole sound.
 */

import type {
  CodecId,
  CodecImplementation,
  FinishedAudioFile,
  MetadataMap,
} from '@audiogubbins/codecs';
import type { ChannelLayout, DomainFailure, SampleCount } from '@audiogubbins/domain';

/**
 * What a decoded stream is, sent once before its first block: what the
 * storage sizes the rendition by before anything is stored, and what the
 * asset's provenance records of the file and its decoder (ADR-0090).
 */
export interface DecodedStreamDescription {
  /** The codec the stream is in, which a container that states none names only past its start. */
  readonly codec: CodecId;
  readonly sampleRate: number;
  readonly layout: ChannelLayout;

  /** The frames the stream states it holds after its priming, or `undefined` where it states none. */
  readonly statedFrames: SampleCount | undefined;

  /** The file's average bit rate in bits a second, where it states one. */
  readonly bitRate: number | undefined;

  /**
   * The file's frames before the stream's first decoded frame, as the
   * positions in `metadata` count them: the priming the decoder trimmed where
   * the format's loops and cues count it, and zero where they count from the
   * first frame the decoder gives.
   */
  readonly leadingFrames: SampleCount;

  /** The implementation that decodes the stream, its own name and its version. */
  readonly decoder: {
    readonly implementation: CodecImplementation;
    readonly name: string;
    readonly version: string;
  };
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
 * The storage worker's side of either channel: credit for more messages, or a
 * refusal that ends the stream, such as a write refused for quota or a
 * cancelled job.
 */
export type StreamReceiverMessage =
  | { readonly kind: 'ready'; readonly credit: number }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };
