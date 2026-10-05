/**
 * A folder the person chose, as the storage's directory ports: the files a
 * folder input or the directory picker gave, read as a project's unpacked tree,
 * and a folder the directory picker gave, written with one (REQ-STOR-103,
 * ADR-0020).
 *
 * Reading needs no more than the files the browser handed over, so it works in
 * every browser, through the page's own folder input. Writing needs a handle to
 * the folder, which only the directory picker gives, so where the browser has
 * no picker there is nothing here to write with and the caller says so. Every
 * refusal of the platform becomes a `TreeFailure` of its kind, and a file or a
 * folder that is not there is absent rather than a failure, as the ports ask.
 */

import type { ByteSink, ByteSource } from '@audiogubbins/project-format';
import type { DirectoryFile, DirectoryReader, DirectoryWriter } from '@audiogubbins/storage';

import { handlesIn } from './directory-handles.js';
import type { ChosenFile } from './external-files.js';
import { fileSource } from './file-source.js';
import { openFileSink } from './file-stream-sink.js';
import { fileAt, finding, folderAt, partsOf, refusing } from './folder-paths.js';

/**
 * The files of a folder the person chose, as a directory to read: each by where
 * it lies inside the folder. A file with no place inside a folder, as one
 * chosen alone has, is no file of it.
 */
export function listedFolder(
  files: readonly Pick<ChosenFile, 'file' | 'handle' | 'relativePath'>[],
): DirectoryReader {
  const byPath = new Map<string, ByteSource>();
  for (const { file, handle, relativePath } of files) {
    if (relativePath === undefined) continue;
    byPath.set(
      relativePath,
      fileSource(file, handle === undefined ? undefined : () => handle.getFile()),
    );
  }
  return {
    list: () =>
      Promise.resolve(Array.from(byPath, ([path, source]) => ({ path, size: source.size }))),
    open: (path) => Promise.resolve(byPath.get(path)),
  };
}

/** Every file under a folder, at any depth, by where it lies inside it. */
async function filesUnder(
  folder: FileSystemDirectoryHandle,
  within: string,
  found: DirectoryFile[],
  signal?: AbortSignal,
): Promise<void> {
  for await (const handle of handlesIn(folder)) {
    signal?.throwIfAborted();
    const path = within === '' ? handle.name : `${within}/${handle.name}`;
    if (handle instanceof FileSystemDirectoryHandle) {
      await filesUnder(handle, path, found, signal);
    } else if (handle instanceof FileSystemFileHandle) {
      const file = await refusing(() => handle.getFile());
      found.push({ path, size: file.size });
    }
  }
}

/** A folder the directory picker gave, as a directory to write (see the module comment). */
export function writableFolder(root: FileSystemDirectoryHandle): DirectoryWriter {
  return {
    list: async (signal) => {
      const found: DirectoryFile[] = [];
      await filesUnder(root, '', found, signal);
      return found;
    },
    open: async (path) => {
      const found = await fileAt(root, path);
      return found === undefined ? undefined : fileSource(found.file, () => found.handle.getFile());
    },
    create: async (path): Promise<ByteSink> => {
      const { folders, name } = partsOf(path);
      const folder = await folderAt(root, folders, true);
      if (folder === undefined) throw new Error(`A folder on the way to ${path} vanished.`);
      const handle = await refusing(() => folder.getFileHandle(name, { create: true }));
      return await openFileSink(handle);
    },
    remove: async (path) => {
      const { folders, name } = partsOf(path);
      const folder = await folderAt(root, folders, false);
      await finding(async () => {
        await folder?.removeEntry(name);
      });
    },
  };
}
