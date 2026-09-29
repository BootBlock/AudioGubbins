/**
 * The storage worker's file-system port bound to the browser's own handles.
 *
 * Thin by design: each member calls the one handle method it mirrors
 * (`sync-file-system.ts`), and every rule of the tree is in the handler that
 * uses it, where it is tested. The synchronous access handle is absent from the
 * DOM type definitions, which declare it only for workers, so it is reached
 * through `Reflect` and its methods are checked before use. Each of its answers
 * is awaited, since the first releases of the handle answered with promises
 * where the floor browsers answer at once.
 *
 * Real handles exist only in a browser, so this module is proved by driving the
 * built application there rather than by a unit test.
 */

import { handlesIn } from './directory-handles.js';
import type { FileSnapshot, SyncDirectory, SyncFile, SyncFileEntry } from './sync-file-system.js';

/** Calls a method of the access handle, which must have it. */
async function call(host: object, name: string, args: readonly unknown[]): Promise<unknown> {
  const method: unknown = Reflect.get(host, name);
  if (typeof method !== 'function') {
    throw new TypeError(`A synchronous access handle has no ${name} method.`);
  }
  const answer: unknown = await Reflect.apply(method, host, args);
  return answer;
}

/** A synchronous access handle, as the port's open file. */
function bindAccessHandle(access: object): SyncFile {
  return {
    write: async (bytes, at) => {
      const written = await call(access, 'write', [bytes, { at }]);
      if (typeof written !== 'number') {
        throw new TypeError('A synchronous write did not say how much it wrote.');
      }
      return written;
    },
    truncate: async (size) => {
      await call(access, 'truncate', [size]);
    },
    flush: async () => {
      await call(access, 'flush', []);
    },
    close: async () => {
      await call(access, 'close', []);
    },
  };
}

function snapshotOf(file: File): FileSnapshot {
  return {
    size: file.size,
    read: async (offset, length) =>
      new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  };
}

function bindFile(handle: FileSystemFileHandle): SyncFileEntry {
  return {
    snapshot: async () => snapshotOf(await handle.getFile()),
    open: async () => {
      const access = await call(handle, 'createSyncAccessHandle', []);
      if (typeof access !== 'object' || access === null) {
        throw new TypeError('The browser opened no synchronous access handle.');
      }
      return bindAccessHandle(access);
    },
  };
}

/** A directory of the origin-private file system, as the storage worker's port. */
export function bindDirectory(handle: FileSystemDirectoryHandle): SyncDirectory {
  return {
    directory: async (name, create) =>
      bindDirectory(await handle.getDirectoryHandle(name, { create })),
    file: async (name, create) => bindFile(await handle.getFileHandle(name, { create })),
    remove: (name) => handle.removeEntry(name, { recursive: true }),
    entries: async function* () {
      for await (const entry of handlesIn(handle)) yield { name: entry.name, kind: entry.kind };
    },
  };
}
