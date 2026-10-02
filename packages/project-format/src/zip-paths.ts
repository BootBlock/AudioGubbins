/**
 * Which names an entry of a portable bundle may have, and which sets of names
 * an archive may hold (REQ-STOR-026, REQ-STOR-103).
 *
 * The writer and the reader hold names to the same rule, so an archive this
 * package writes is always one it reads, and an archive from elsewhere cannot
 * name a file outside the folder it is unpacked into.
 */

import { encodeUtf8 } from './utf8.js';

/**
 * A character no name may hold: a control character, which no file system
 * shows faithfully, a lone surrogate, which has no UTF-8 form, the backslash,
 * which Windows reads as a separator, and the colon, which Windows reads as a
 * drive or a stream.
 */
const FORBIDDEN = /[\p{Cc}\p{Cs}\\:]/u;

/** The longest name a ZIP record can carry, in bytes. */
const LONGEST_NAME_BYTES = 0xffff;

/**
 * The UTF-8 bytes of `path` where it is a safe entry name, or `undefined`.
 *
 * Safe: relative, `/`-separated segments, none empty, `.` or `..`, and none
 * holding a {@link FORBIDDEN} character, in at most 65,535 bytes. Wider than
 * {@link isTreePath}, because a bundle also carries names the tree never
 * writes, such as the raw data exported before a schema reset (REQ-STOR-052).
 */
export function entryNameBytes(path: string): Uint8Array<ArrayBuffer> | undefined {
  if (FORBIDDEN.test(path)) return undefined;
  if (!path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')) {
    return undefined;
  }
  const bytes = encodeUtf8(path);
  return bytes.length <= LONGEST_NAME_BYTES ? bytes : undefined;
}

/** Why a name cannot join the names already in an archive. */
export type NameClash = 'duplicate' | 'file-and-folder';

/**
 * The names of an archive so far, refusing a name that repeats one or that
 * makes a file and a folder of the same path, since neither could be unpacked
 * as a tree.
 */
export class ArchiveNames {
  private readonly files = new Set<string>();
  private readonly folders = new Set<string>();
  private readonly listedFolders = new Set<string>();

  /** Adds the file `path`, or says why it clashes with the names already added. */
  addFile(path: string): NameClash | undefined {
    if (this.files.has(path)) return 'duplicate';
    if (this.folders.has(path)) return 'file-and-folder';
    const clash = this.addParents(path);
    if (clash === undefined) this.files.add(path);
    return clash;
  }

  /** Adds the folder `path`, which an archive from elsewhere may list on its own. */
  addFolder(path: string): NameClash | undefined {
    if (this.listedFolders.has(path)) return 'duplicate';
    if (this.files.has(path)) return 'file-and-folder';
    const clash = this.addParents(path);
    if (clash === undefined) {
      this.folders.add(path);
      this.listedFolders.add(path);
    }
    return clash;
  }

  /** Adds each folder `path` lies in, unless one of them is a file. */
  private addParents(path: string): NameClash | undefined {
    const parents: string[] = [];
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
      const parent = path.slice(0, slash);
      if (this.files.has(parent)) return 'file-and-folder';
      parents.push(parent);
    }
    for (const parent of parents) this.folders.add(parent);
    return undefined;
  }
}
