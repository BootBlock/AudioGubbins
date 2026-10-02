/**
 * What the page serves the storage worker: the ports only the page can serve,
 * which the worker calls back while it works (ADR-0022).
 *
 * A sink the person chose, a folder they picked, the backups folder and the
 * search for a linked file, which may need a permission prompt, belong to the
 * page. The page lends each to the worker for one call, under a number of its
 * own, and the worker reaches it by that number; the page lets it go once the
 * call settles. Bytes cross transferred, so a chunk is copied once at most. A
 * file the page holds crosses as itself, since a `File` clones and the worker
 * reads it as well as the page can, so only bytes the page alone can read are
 * read through it.
 */

import type { AssetId } from '@audiogubbins/domain';
import type { AbsenceReason, ExternalFile } from '@audiogubbins/media-store';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { DirectoryFile, ExternalBackupTarget } from '@audiogubbins/storage';

import type { Operation } from './operations.js';

/** A port the page lent the worker, by the number the page gave it. */
export type PagePort = number;

/**
 * A file the page holds, which crosses as itself: with the handle it came
 * through, where it did, which tells the reader whether it changed since.
 */
export interface HeldFile {
  readonly kind: 'file';
  readonly file: File;
  readonly handle?: FileSystemFileHandle;
}

/** Bytes the worker reads: a file it reads itself, or a source the page reads for it. */
export type CrossingBytes =
  HeldFile | { readonly kind: 'port'; readonly port: PagePort; readonly size: number };

/** A file the person chose, as the media store takes it, with its bytes as they cross. */
export type CrossingFile = Omit<ExternalFile, 'source'> & { readonly bytes: CrossingBytes };

/** A file of a folder the page's folder input gave, by where it lies inside the folder. */
export interface FolderFile {
  readonly path: string;
  readonly file: File;
}

/** A folder to read: the files a folder input gave, or a folder the page reads for the worker. */
export type CrossingFolder =
  | { readonly kind: 'files'; readonly files: readonly FolderFile[] }
  | { readonly kind: 'port'; readonly port: PagePort };

/** The file a linked asset was recorded from, where it can be read, or why it cannot. */
export type CrossingLocated =
  | { readonly kind: 'found'; readonly file: CrossingFile }
  | { readonly kind: 'absent'; readonly reason: AbsenceReason };

/** One backup generation's copy, as the backups folder is asked to name it. */
export type BackupCopy = Parameters<ExternalBackupTarget['create']>[0];

/** An operation of the port lent as `port`. */
type Lent<TArgument, TAnswer> = Operation<{ readonly port: PagePort } & TArgument, TAnswer>;

/** The operations the worker calls on the page's ports, by the kind of port. */
export type PageOperations = {
  /** Writes a chunk, whose buffer crosses transferred. */
  'sink.write': Lent<{ readonly chunk: Uint8Array<ArrayBuffer> }, undefined>;
  'sink.close': Lent<unknown, undefined>;

  /** Abandons what the sink was written, for the reason given as text. */
  'sink.abort': Lent<{ readonly reason: string | undefined }, undefined>;

  /** A range of the source's bytes, whose buffer crosses transferred. */
  'source.read': Lent<
    { readonly offset: number; readonly length: number },
    Uint8Array<ArrayBuffer>
  >;
  'folder.list': Lent<unknown, readonly DirectoryFile[]>;
  'folder.open': Lent<{ readonly path: string }, CrossingBytes | undefined>;

  /** A sink for a file of the folder, lent for the rest of the call that lent the folder. */
  'folder.create': Lent<{ readonly path: string }, PagePort>;
  'folder.remove': Lent<{ readonly path: string }, undefined>;

  /** A sink for one generation's copy, lent for the rest of the call that lent the folder. */
  'backupFolder.create': Lent<{ readonly generation: BackupCopy }, PagePort>;
  'linkedFiles.locate': Lent<
    { readonly asset: AssetId; readonly identity: ExternalSourceIdentity },
    CrossingLocated
  >;
};
