/**
 * A file read synchronously in a dedicated worker, as the codec module reads
 * it (ADR-0090): a chosen file through `FileReaderSync` over a slice of it, or
 * an origin-private file through its sync access handle.
 *
 * The worker's objects are taken by the members used, so the adapters are
 * tested in Node with stand-ins and the worker's entry hands the real ones.
 * Neither adapter repairs a short read: a read that answers fewer bytes than
 * lie before the file's end is answered as it came, which the codec module
 * and the readers take for the file having changed under them.
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';

/** A browser `Blob` or `File`, by the members a read uses. */
export interface BlobLike {
  readonly size: number;
  slice(start: number, end: number): BlobLike;
}

/** A dedicated worker's `FileReaderSync`, by the member a read uses. */
export interface FileReaderSyncLike {
  readAsArrayBuffer(blob: BlobLike): ArrayBuffer;
}

/** An origin-private file's `FileSystemSyncAccessHandle`, by the members a read uses. */
export interface SyncAccessHandleLike {
  getSize(): number;
  read(buffer: Uint8Array, options: { readonly at: number }): number;
  close(): void;
}

/** The bytes `into` can take at `offset` of a file of `size` bytes. */
function wanted(size: number, offset: number, into: Uint8Array): number {
  return Math.max(0, Math.min(into.length, size - offset));
}

/**
 * A chosen file's bytes, each read a slice of it through `reader`. A file
 * changed or removed since it was chosen throws `NotReadableError` from the
 * read, which the caller hears as the file being unreadable.
 */
export function blobSyncBytes(blob: BlobLike, reader: FileReaderSyncLike): SyncAudioBytes {
  const size = blob.size;
  return {
    size,
    readInto: (offset, into) => {
      const length = wanted(size, offset, into);
      if (length === 0) return 0;
      const bytes = new Uint8Array(reader.readAsArrayBuffer(blob.slice(offset, offset + length)));
      const copied = Math.min(bytes.length, length);
      into.set(bytes.subarray(0, copied));
      return copied;
    },
  };
}

/**
 * An origin-private file's bytes, read through its sync access handle into
 * the caller's buffer without a copy. Its size is the size when it was
 * opened, so a file cut short since reads short. The handle is the caller's
 * to close.
 */
export function accessHandleSyncBytes(handle: SyncAccessHandleLike): SyncAudioBytes {
  const size = handle.getSize();
  return {
    size,
    readInto: (offset, into) => {
      const length = wanted(size, offset, into);
      if (length === 0) return 0;
      return handle.read(into.subarray(0, length), { at: offset });
    },
  };
}
