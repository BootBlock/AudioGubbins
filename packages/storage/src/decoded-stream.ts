/**
 * The port a decoded import's audio reaches the storage through (ADR-0090):
 * the messages the codec worker sends of one file, in order, as the storage
 * reads them, and the refusal that ends them.
 *
 * The storage knows no message channel: the storage worker reads the channel
 * the codec worker writes, granting it credit as the storage reads, and gives
 * the storage what it read through this port, so every rule of making a
 * rendition is tested with a stream made in a test. The first message is the
 * stream's description, which the storage reads before it asks for a block,
 * so a file the storage cannot hold is refused before the codec worker
 * decodes more than its header.
 */

import type { DomainFailure, DomainResult } from '@audiogubbins/domain';
import type { DecodedStreamMessage } from '@audiogubbins/import-export';

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

/**
 * Starts decoding one file in the codec worker, answering its stream, or why
 * it cannot be decoded here, such as a codec worker that could not start.
 */
export type StreamDecoding = (signal?: AbortSignal) => Promise<DomainResult<DecodedStream>>;
