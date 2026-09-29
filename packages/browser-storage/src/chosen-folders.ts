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

import type { ExternalFile } from '@audiogubbins/media-store';
import type { ByteSink, ByteSource } from '@audiogubbins/project-format';
import type { DirectoryFile, DirectoryReader, DirectoryWriter } from '@audiogubbins/storage';

import { handlesIn } from './directory-handles.js';
import { fileSource } from './file-source.js';
import { openFileSink } from './file-stream-sink.js';
import { meansAbsent, treeFailureOf } from './platform-failures.js';

/**
 * The files of a folder the person chose, as a directory to read: each by where
 * it lies inside the folder. A file with no place inside a folder, as one
 * chosen alone has, is no file of it.
 */
export function listedFolder(files: readonly ExternalFile[]): DirectoryReader {
  const byPath = new Map<string, ByteSource>();
  for (const file of files) {
    if (file.relativePath !== undefined) byPath.set(file.relativePath, file.source);
  }
  return {
    list: () =>
      Promise.resolve(Array.from(byPath, ([path, source]) => ({ path, size: source.size }))),
    open: (path) => Promise.resolve(byPath.get(path)),
  };
}

/** Runs a step of the platform, its refusal made the designed failure. */
async function refusing<Result>(step: () => Promise<Result>): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof DOMException) throw treeFailureOf(error);
    throw error;
  }
}

/** Runs a step that finds something, `undefined` where it is not there. */
async function finding<Result>(step: () => Promise<Result>): Promise<Result | undefined> {
  try {
    return await refusing(step);
  } catch (error) {
    // The failure keeps the platform's refusal as its cause, which is what says
    // whether nothing of the kind asked for was there.
    if (error instanceof Error && meansAbsent(error.cause)) return undefined;
    throw error;
  }
}

/** A path's folders and its last segment. */
function partsOf(path: string): { readonly folders: readonly string[]; readonly name: string } {
  const segments = path.split('/');
  const name = segments.pop();
  if (name === undefined || name === '') throw new Error(`Not a file path: ${path}`);
  return { folders: segments, name };
}

/** The folder a run of names leads to, made where `create` asks, `undefined` where absent. */
async function folderAt(
  root: FileSystemDirectoryHandle,
  folders: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | undefined> {
  let folder: FileSystemDirectoryHandle | undefined = root;
  for (const name of folders) {
    const parent: FileSystemDirectoryHandle = folder;
    folder = await finding(() => parent.getDirectoryHandle(name, { create }));
    if (folder === undefined) return undefined;
  }
  return folder;
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
      const { folders, name } = partsOf(path);
      const folder = await folderAt(root, folders, false);
      const handle = await finding(async () => await folder?.getFileHandle(name));
      if (handle === undefined) return undefined;
      const file = await finding(() => handle.getFile());
      return file === undefined ? undefined : fileSource(file, () => handle.getFile());
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
