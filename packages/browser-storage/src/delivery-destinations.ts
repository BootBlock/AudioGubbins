/**
 * Where an export is delivered in the browser (ADR-0092, REQ-EXEC-216): a file
 * a save dialog gave, and a folder the directory picker gave or a trusted
 * folder kept, or a folder inside one (ADR-0102), each written through
 * `createWritable`, which replaces a file only when its stream closes.
 *
 * Whether the destination may be written now is asked of its handle without
 * asking the person, which only the page can do, in answer to their gesture; a
 * handle without permission methods grants what it names. A folder lists the
 * names of every entry it holds, files and folders alike, since either takes a
 * name. A file a delivery makes appears in the folder as soon as its handle is
 * made, empty, so where its writing is abandoned it is removed again and the
 * folder is left as it was.
 *
 * A folder inside one that is not there yet is made only when a file is
 * created in it, with every folder above it still to be made, and taken back
 * where that file is abandoned (`folder-making.ts`). Until then it lists
 * nothing, so its collisions are decided as a new folder's; and since another
 * window or program may make it in the meantime, its file is written only
 * where nothing has taken that name in it by then.
 */

import {
  TreeFailure,
  TreeFailureKind,
  type ByteSink,
  type ByteSource,
} from '@audiogubbins/project-format';
import type { DeliveryFile, DeliveryFolder, DestinationAccess } from '@audiogubbins/storage';

import { handlesIn } from './directory-handles.js';
import { fileSource } from './file-source.js';
import { openFileSink } from './file-stream-sink.js';
import { entryNamed, folderThere, madeInside, type MadeFolder } from './folder-making.js';
import { finding, refusing } from './folder-paths.js';
import { queryWritePermission } from './handle-permissions.js';

/** Whether the handle may be written now, without asking the person. */
async function accessOf(handle: FileSystemHandle): Promise<DestinationAccess> {
  return (await queryWritePermission(handle)) === 'granted' ? 'granted' : 'needs-permission';
}

/** A file a save dialog gave, as a delivery's destination. */
export function fileDestination(handle: FileSystemFileHandle): DeliveryFile {
  return {
    name: handle.name,
    access: () => accessOf(handle),
    open: () => openFileSink(handle),
  };
}

/** A folder the directory picker gave, or a trusted folder kept, as a delivery's destination. */
export function folderDestination(folder: FileSystemDirectoryHandle): DeliveryFolder {
  const access = (): Promise<DestinationAccess> => accessOf(folder);
  return {
    name: folder.name,
    access,
    list: async (signal) => {
      const names: string[] = [];
      for await (const handle of handlesIn(folder)) {
        signal?.throwIfAborted();
        names.push(handle.name);
      }
      return names;
    },
    open: async (name): Promise<ByteSource | undefined> => {
      const handle = await finding(() => folder.getFileHandle(name));
      if (handle === undefined) return undefined;
      const file = await refusing(() => handle.getFile());
      return fileSource(file, () => handle.getFile());
    },
    folder: async (name, signal) => {
      signal?.throwIfAborted();
      const there = await entryNamed(folder, name);
      if (there === 'file') return undefined;
      if (there !== 'absent') return folderDestination(there);
      return folderToMake(name, access, (cancel) => madeInside(folderThere(folder), name, cancel));
    },
    create: (name) => createdFile(folder, name),
  };
}

/**
 * A folder not there yet, as a delivery's destination: listing nothing, and
 * made by `made` only when a file is created in it (see the module comment).
 */
function folderToMake(
  name: string,
  access: () => Promise<DestinationAccess>,
  made: (signal?: AbortSignal) => Promise<MadeFolder>,
): DeliveryFolder {
  return {
    name,
    access,
    list: () => Promise.resolve([]),
    open: () => Promise.resolve(undefined),
    folder: (inner, signal) => {
      signal?.throwIfAborted();
      return Promise.resolve(
        folderToMake(
          inner,
          access,
          async (cancel) => await madeInside(await made(cancel), inner, cancel),
        ),
      );
    },
    create: async (file, signal) => {
      const folder = await made(signal);
      try {
        signal?.throwIfAborted();
        if ((await finding(() => folder.handle.getFileHandle(file))) !== undefined) {
          throw new TreeFailure(
            TreeFailureKind.Io,
            `A file named "${file}" was put in the folder as the export was delivered.`,
          );
        }
        const sink = await createdFile(folder.handle, file);
        return {
          write: (chunk) => sink.write(chunk),
          close: () => sink.close(),
          abort: async (reason) => {
            await sink.abort(reason);
            await folder.undo();
          },
        };
      } catch (error) {
        await folder.undo();
        throw error;
      }
    },
  };
}

/** A sink for the file `name` in `folder`, which removes the file again where it made it and is abandoned. */
async function createdFile(folder: FileSystemDirectoryHandle, name: string): Promise<ByteSink> {
  const existed = (await finding(() => folder.getFileHandle(name))) !== undefined;
  const handle = await refusing(() => folder.getFileHandle(name, { create: true }));
  const sink = await openFileSink(handle);
  if (existed) return sink;
  return {
    write: (chunk) => sink.write(chunk),
    close: () => sink.close(),
    abort: async (reason) => {
      await sink.abort(reason);
      await refusing(() => folder.removeEntry(name));
    },
  };
}
