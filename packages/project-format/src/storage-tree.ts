/**
 * The port every stored form of a project is kept through: a tree of files by
 * relative path.
 *
 * The media store and the project storage above this package write the same
 * tree, and the browser adapters implement it over the origin-private file
 * system (ADR-0020). It promises less than a file system: a write is not
 * atomic and a rename does not exist, because Safari at the floor offers only
 * synchronous access handles that write in place. Everything written through
 * it therefore carries its own check, and the protocol above decides what is
 * current, so a torn write is never read as data (REQ-STOR-101).
 */

import type { ByteSink, ByteSource } from './byte-ports.js';

/**
 * Why the tree refused an operation.
 *
 * - `quota`: the browser's storage is full; nothing already stored was harmed,
 *   and the write may succeed once room is made (REQ-STOR-106).
 * - `unavailable`: the storage cannot be reached at all, for example in a
 *   private window that refuses it.
 * - `io`: the operation failed for another reason the platform gave.
 */
export const TreeFailureKind = {
  Quota: 'quota',
  Unavailable: 'unavailable',
  Io: 'io',
} as const;

/** Why the tree refused an operation. */
export type TreeFailureKind = (typeof TreeFailureKind)[keyof typeof TreeFailureKind];

/**
 * The failure a tree operation rejects with.
 *
 * A class, so a caller can tell the tree's refusal from a defect by
 * `instanceof` and decide by its kind, while the platform's own error stays
 * reachable as the cause.
 */
export class TreeFailure extends Error {
  readonly kind: TreeFailureKind;

  constructor(kind: TreeFailureKind, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'TreeFailure';
    this.kind = kind;
  }
}

/** One entry of a directory. */
export interface TreeEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

/**
 * A tree of files by relative path.
 *
 * A path is segments joined by `/`, each one of {@link isTreeSegment}; an
 * implementation refuses any other as a programmer error. A directory exists
 * while anything is in it, and is made by writing into it.
 */
export interface StorageTree {
  /** The whole of a small file, or `undefined` where there is none. */
  readFile(path: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer> | undefined>;

  /** A file to read in ranges, or `undefined` where there is none. */
  openFile(path: string): Promise<ByteSource | undefined>;

  /**
   * Writes a whole file, replacing any there. A crash part-way may leave the
   * file torn, which the caller's check detects.
   */
  writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void>;

  /** A file to write in order; it exists whole only once the sink closes. */
  createFile(path: string): Promise<ByteSink>;

  /** Removes a file, or a directory and everything in it. Absent is not a failure. */
  remove(path: string): Promise<void>;

  /** The entries of a directory, sorted by name; none where it does not exist. */
  list(directory: string): Promise<readonly TreeEntry[]>;
}

/**
 * One segment of a tree path: lower-case letters, digits, `.`, `_` and `-`,
 * not starting with a dot, at most 128 characters.
 *
 * Narrow, so every name AudioGubbins writes is the same on every file system
 * and in a ZIP entry, and no segment can climb out of the tree.
 */
const SEGMENT = /^[a-z0-9_-][a-z0-9._-]{0,127}$/u;

/** Whether a string is one segment of a tree path. */
export function isTreeSegment(segment: string): boolean {
  return SEGMENT.test(segment);
}

/** Whether a string is a relative tree path of valid segments, or the root (''). */
export function isTreePath(path: string): boolean {
  return path === '' || path.split('/').every(isTreeSegment);
}
