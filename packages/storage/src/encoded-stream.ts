/**
 * The port an export's encoded bytes reach the storage through (ADR-0092):
 * the body the codec worker encodes, in order, then the file's head and tail
 * once the encoder finishes, or the failure that ends the stream, as the
 * storage reads them.
 *
 * The storage knows no message channel: the storage worker reads the channel
 * the codec worker writes, granting it credit as the storage reads, and gives
 * the storage what it read through this port, so every rule of staging an
 * export is tested with a stream made in a test.
 */

import type { DomainFailure } from '@audiogubbins/domain';
import type { EncodedStreamMessage } from '@audiogubbins/import-export';

/** One export's encoded stream, as it arrives. */
export interface EncodedStream {
  /**
   * The next message, waiting for it, which asks the codec worker for more as
   * it is read; nothing once the stream has ended or been closed.
   */
  next(): Promise<EncodedStreamMessage | undefined>;

  /** Tells the codec worker the stream is refused, for `failure`, and stops reading. */
  refuse(failure: DomainFailure): void;

  /** Stops reading once the stream has ended; a read waiting answers nothing. */
  close(): void;
}
