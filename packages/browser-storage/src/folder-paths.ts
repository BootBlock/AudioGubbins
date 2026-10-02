/**
 * Walking a path of names down from a directory handle, for a folder the
 * person chose and for the origin-private file system alike: every refusal of
 * the platform becomes a `TreeFailure` of its kind, and a file or a folder that
 * is not there is absent rather than a failure, as the storage ports ask.
 */

import { meansAbsent, treeFailureOf } from './platform-failures.js';

/** Runs a step of the platform, its refusal made the designed failure. */
export async function refusing<Result>(step: () => Promise<Result>): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof DOMException) throw treeFailureOf(error);
    throw error;
  }
}

/** Runs a step that finds something, `undefined` where it is not there. */
export async function finding<Result>(step: () => Promise<Result>): Promise<Result | undefined> {
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
export function partsOf(path: string): {
  readonly folders: readonly string[];
  readonly name: string;
} {
  const segments = path.split('/');
  const name = segments.pop();
  if (name === undefined || name === '') throw new Error(`Not a file path: ${path}`);
  return { folders: segments, name };
}

/** The folder a run of names leads to, made where `create` asks, `undefined` where absent. */
export async function folderAt(
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

/** The file at `path` under `root` with its handle, `undefined` where it is not there. */
export async function fileAt(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<{ readonly file: File; readonly handle: FileSystemFileHandle } | undefined> {
  const { folders, name } = partsOf(path);
  const folder = await folderAt(root, folders, false);
  const handle = await finding(async () => await folder?.getFileHandle(name));
  if (handle === undefined) return undefined;
  const file = await finding(() => handle.getFile());
  return file === undefined ? undefined : { file, handle };
}

/**
 * The origin-private file system's file at a path of the storage tree, as a
 * snapshot the platform hands out: a `File` reads the bytes it was made over,
 * and never writes. `undefined` where nothing is at the path.
 */
export function originPrivateFile(
  readRoot: (() => Promise<FileSystemDirectoryHandle>) | undefined,
): (path: string) => Promise<File | undefined> {
  return async (path) => {
    if (readRoot === undefined) {
      throw new DOMException(
        'This browser offers no private storage to the storage worker.',
        'NotSupportedError',
      );
    }
    return (await fileAt(await readRoot(), path))?.file;
  };
}
