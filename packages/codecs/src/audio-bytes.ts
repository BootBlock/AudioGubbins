/**
 * The byte port every reader takes its file through.
 *
 * A reader is handed a size and a ranged, cancellable read, so the media
 * store's byte source, a browser file and a test's memory all serve without an
 * adapter (ADR-0052). The package is compiled without the browser's or Node's
 * type definitions, since it runs in a worker, an AudioWorklet's feeder and a
 * test alike, so it names the part of an `AbortSignal` it reads rather than the
 * host's type, in the shape the audio engine's cancellation already uses.
 */

/** The part of an `AbortSignal` a reader reads. */
export interface ReadSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

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
  read(offset: number, length: number, signal?: ReadSignal): Promise<Uint8Array>;
}

/** Why a read was cancelled, where the signal gave no reason that is an error. */
class ReadCancelled extends Error {
  constructor() {
    super('The read was cancelled.');
    this.name = 'Cancelled';
  }
}

/**
 * Throws the signal's reason if it has been cancelled: the reason itself where
 * it is an error, so a caller's own reason reaches whoever awaited the read.
 */
export function throwIfCancelled(signal: ReadSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error ? signal.reason : new ReadCancelled();
}
