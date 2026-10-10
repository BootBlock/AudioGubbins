/**
 * Where an export is delivered in the browser (ADR-0092, REQ-EXEC-216): a file
 * a save dialog gave, and a folder the directory picker gave or a trusted
 * folder kept, each written through `createWritable`, which replaces a file
 * only when its stream closes.
 *
 * Whether the destination may be written now is asked of its handle without
 * asking the person, which only the page can do, in answer to their gesture;
 * a handle without permission methods grants what it names. A folder lists the
 * names of every entry it holds, files and folders alike, since either takes
 * a name. A file a delivery makes appears in the folder as soon as its handle
 * is made, empty, so where its writing is abandoned it is removed again and
 * the folder is left as it was.
 */

import type { ByteSink, ByteSource } from '@audiogubbins/project-format';
import type { DeliveryFile, DeliveryFolder, DestinationAccess } from '@audiogubbins/storage';

import { handlesIn } from './directory-handles.js';
import { fileSource } from './file-source.js';
import { openFileSink } from './file-stream-sink.js';
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
  return {
    name: folder.name,
    access: () => accessOf(folder),
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
    create: async (name): Promise<ByteSink> => {
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
    },
  };
}
