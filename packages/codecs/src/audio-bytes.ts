/**
 * The byte port every reader takes its file through.
 *
 * A reader is handed a size and a ranged, cancellable read, so the media
 * store's byte source, a browser file and a test's memory all serve without an
 * adapter (ADR-0052). Its cancellation is the domain's, so a read cancelled
 * fails with the same `Cancelled` the engine reading through it recognises.
 */

import type { CancellationSignal } from '@audiogubbins/domain';

/**
 * The bytes of one file.
 *
 * `size` is the true size of the file. A read answers exactly the bytes asked
 * for wherever they lie within `size`; a reader treats a shorter answer as the
 * file having changed under it, never as data to trust. A file cut short by a
 * crash shows as a header promising more than `size` holds, which is a
 * truncation the reader reports, not a short read.
 */
export interface AudioBytes {
  readonly size: number;
  read(offset: number, length: number, signal?: CancellationSignal): Promise<Uint8Array>;
}
