/**
 * The ports a decoded import reaches the codec worker through (ADR-0090): its
 * analysis of a compressed file, before anything is stored, and the stream of
 * the file decoded, as the storage reads it.
 *
 * The storage knows no message channel and no codec worker: the storage
 * worker asks the codec worker over the channel the page joined them by,
 * reads the stream's channel with credit, and gives the storage what it read
 * through these ports, so every rule of making a rendition is tested with an
 * analysis and a stream made in a test.
 */

import type { CodecId, ContainerId, DecoderIdentity } from '@audiogubbins/codecs';
import type {
  ChannelLayout,
  DomainFailure,
  DomainResult,
  SampleCount,
  SampleRate,
} from '@audiogubbins/domain';
import type { DecodedStreamMessage } from '@audiogubbins/import-export';

import type { FileMetadata } from './import-analysis.js';

/**
 * A compressed file's stream as the codec worker's analysis found it from its
 * headers: what the storage sizes the rendition by before anything is stored,
 * and what the asset's provenance records of the file and its decoder.
 */
export interface StreamAnalysis {
  readonly container: ContainerId;
  readonly codec: CodecId;

  /** The stream's own rate, which the rendition keeps. */
  readonly sampleRate: SampleRate;

  /** The stream's channels, in the order they decode in. */
  readonly layout: ChannelLayout;

  /** The frames the stream states after its priming, where it states them. */
  readonly statedFrames: SampleCount | undefined;

  /** The file's frames before the first decoded, which its own positions count from. */
  readonly leadingFrames: SampleCount;

  /** The file's average bit rate in bits a second, where it states one. */
  readonly bitRate: number | undefined;
  readonly decoder: DecoderIdentity;
  readonly metadata: FileMetadata;
}

/** One file's decoded stream, as it arrives. */
export interface DecodedStream {
  /**
   * The next message, waiting for it, which asks the codec worker for more as
   * it is read; nothing once the stream has ended or been closed.
   */
  next(): Promise<DecodedStreamMessage | undefined>;

  /** Tells the codec worker the stream is refused, for `failure`, and stops reading. */
  refuse(failure: DomainFailure): void;

  /** Stops reading once the stream has ended; a read waiting answers nothing. */
  close(): void;
}

/** One file's decoding in the codec worker: its analysis, then its stream. */
export interface FileDecoding {
  /**
   * The codec worker's analysis of the file, or why it is refused here, such
   * as a codec no implementation in this browser decodes, or no codec worker.
   */
  analyse(signal?: AbortSignal): Promise<DomainResult<StreamAnalysis>>;

  /** Starts decoding the file, answering its stream, or why it cannot start. */
  decode(signal?: AbortSignal): Promise<DomainResult<DecodedStream>>;
}
