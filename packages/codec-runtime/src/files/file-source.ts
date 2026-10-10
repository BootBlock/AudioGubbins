/**
 * The file a request names, opened for synchronous reading in the codec
 * worker (ADR-0090): a file the person chose, as the `File` the page or the
 * storage worker holds, or an origin-private file, as its handle, which the
 * storage worker hands for a copy it keeps.
 *
 * A chosen file is read through `FileReaderSync`; an origin-private one
 * through a sync access handle opened read-only, so the storage worker, the
 * file's one writer, keeps writing other files. Opening either reads nothing
 * of the file.
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import { thrownName } from '../thrown-name.js';
import {
  accessHandleSyncBytes,
  blobSyncBytes,
  type BlobLike,
  type FileReaderSyncLike,
  type SyncAccessHandleLike,
} from './sync-file-bytes.js';

/** An origin-private file's `FileSystemFileHandle`, by the member opening it uses. */
export interface FileHandleLike {
  createSyncAccessHandle(options: { readonly mode: 'read-only' }): Promise<SyncAccessHandleLike>;
}

/** The file a request names. */
export type FileSource =
  | { readonly kind: 'file'; readonly file: BlobLike }
  | { readonly kind: 'origin-private'; readonly handle: FileHandleLike };

/** A file open for reading, until it is closed. */
export interface OpenedFile {
  readonly bytes: SyncAudioBytes;
  /** Releases what holds the file open. A second call does nothing. */
  close(): void;
}

/** The failure of a file that could not be opened, naming what opening threw. */
function unopened(thrown: unknown): DomainResult<never> {
  return fail(
    failure('codec-runtime.unreadable', FailureKind.Retryable, 'The file could not be read.', {
      details: { cause: thrownName(thrown) },
    }),
  );
}

/** Opens the file `source` names, reading chosen files through `reader`. */
export async function openFileSource(
  source: FileSource,
  reader: FileReaderSyncLike,
): Promise<DomainResult<OpenedFile>> {
  if (source.kind === 'file') {
    return succeed({ bytes: blobSyncBytes(source.file, reader), close: () => undefined });
  }
  let handle: SyncAccessHandleLike;
  try {
    handle = await source.handle.createSyncAccessHandle({ mode: 'read-only' });
  } catch (error) {
    // A file another context holds open for writing, one removed since its
    // handle was given, or a browser without sync access handles throws.
    return unopened(error);
  }
  let bytes: SyncAudioBytes;
  try {
    bytes = accessHandleSyncBytes(handle);
  } catch (error) {
    // Its size is read at once, which a handle closed under it refuses.
    handle.close();
    return unopened(error);
  }
  let open = true;
  return succeed({
    bytes,
    close: () => {
      if (!open) return;
      open = false;
      handle.close();
    },
  });
}
