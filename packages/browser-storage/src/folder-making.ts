/**
 * Making the folders a delivery writes into, and taking them back where the
 * delivery is abandoned (ADR-0092, ADR-0102).
 *
 * A folder is made through `getDirectoryHandle(name, { create: true })`, one
 * name at a time, each after the one it is inside, so a refusal part-way (a
 * full disk, a permission withdrawn, a file that took the name) leaves only
 * the folders made before it, which are removed again before the refusal is
 * reported, innermost first. Only a folder this made is removed, and only
 * while it is empty: one another window or program made or wrote into in the
 * meantime is theirs and stays. Removal is never recursive, so nothing but an
 * empty folder made here is ever taken away.
 */

import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import { refusing } from './folder-paths.js';
import { treeFailureOf } from './platform-failures.js';

/** A folder a delivery writes into, and how to take back what making it made. */
export interface MadeFolder {
  readonly handle: FileSystemDirectoryHandle;

  /** Removes, innermost first, each folder made for it that is still empty. */
  undo(): Promise<void>;
}

/** What a folder holds under a name: a folder, a file, or nothing. */
export type NamedEntry = FileSystemDirectoryHandle | 'file' | 'absent';

/** The refusals of a folder that say the name is a file's, or nobody's. */
const NAMED_FILE = 'TypeMismatchError';
const NAMED_NOTHING = 'NotFoundError';

/**
 * The refusals of removing a folder that say it is not this delivery's to
 * remove: something was put in it since it was made, or it went already.
 */
const KEPT_ON_REMOVAL: ReadonlySet<string> = new Set(['InvalidModificationError', NAMED_NOTHING]);

/** The folder `parent` holds as `name`, or whether a file or nothing has the name. */
export async function entryNamed(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<NamedEntry> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    if (error.name === NAMED_FILE) return 'file';
    if (error.name === NAMED_NOTHING) return 'absent';
    throw treeFailureOf(error);
  }
}

/** A folder that is there already, which a delivery takes nothing back from. */
export function folderThere(handle: FileSystemDirectoryHandle): MadeFolder {
  return { handle, undo: () => Promise.resolve() };
}

/** Removes the folder `parent` holds as `name` where it is still there and empty. */
async function removedIfEmpty(parent: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await parent.removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    // Another window or program wrote into it or removed it since it was made:
    // what is there now is theirs.
    if (KEPT_ON_REMOVAL.has(error.name)) return;
    throw treeFailureOf(error);
  }
}

/**
 * The folder `name` inside `above`, made where nothing has the name, so its
 * undoing removes it and then what `above` made; where making it is refused,
 * or `signal` is, what `above` made is removed before the refusal is thrown.
 */
export async function madeInside(
  above: MadeFolder,
  name: string,
  signal?: AbortSignal,
): Promise<MadeFolder> {
  try {
    signal?.throwIfAborted();
    const there = await entryNamed(above.handle, name);
    if (there === 'file') {
      throw new TreeFailure(
        TreeFailureKind.Io,
        `A file took the name "${name}" of a folder as it was made.`,
      );
    }
    if (there !== 'absent') return { handle: there, undo: () => above.undo() };
    const made = await refusing(() => above.handle.getDirectoryHandle(name, { create: true }));
    return {
      handle: made,
      undo: async () => {
        await removedIfEmpty(above.handle, name);
        await above.undo();
      },
    };
  } catch (error) {
    await above.undo();
    throw error;
  }
}
