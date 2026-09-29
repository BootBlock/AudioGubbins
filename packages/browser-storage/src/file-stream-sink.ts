/**
 * Writing a bundle or a backup to a file the user chose, or into a folder they
 * chose, as a byte sink (REQ-STOR-105).
 *
 * The browser's writable stream writes to a copy it swaps in only when the
 * stream closes, so the file the user had is never torn: until `close` resolves
 * it is untouched, and an abort discards the copy, which is the promise the
 * sink port makes. A refusal becomes a `TreeFailure` of its kind
 * (`platform-failures.ts`), so a full disk is reported as one.
 */

import type { ByteSink } from '@audiogubbins/project-format';

import { unshared } from './array-buffer-views.js';
import { treeFailureOf } from './platform-failures.js';

/** The stream, as far as the sink uses it: `FileSystemWritableFileStream`. */
export interface FileWriteStream {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

/** A file to write, as far as the sink uses it: `FileSystemFileHandle`. */
export interface WritableFile {
  createWritable(options: { readonly keepExistingData: boolean }): Promise<FileWriteStream>;
}

/** A folder to write into, as far as the sink uses it: `FileSystemDirectoryHandle`. */
export interface WritableDirectory {
  getFileHandle(name: string, options: { readonly create: boolean }): Promise<WritableFile>;
}

/** Runs a step of the stream, reporting a refusal of the platform as its designed failure. */
async function refusing<Result>(step: () => Promise<Result>): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof DOMException) throw treeFailureOf(error);
    throw error;
  }
}

/** A byte sink over the stream (see the module comment). */
function streamSink(stream: FileWriteStream): ByteSink {
  let open = true;
  const end = (): void => {
    if (!open) throw new Error('A sink cannot be used once it is closed or aborted.');
  };
  return {
    write: async (chunk) => {
      end();
      await refusing(() => stream.write(unshared(chunk)));
    },
    close: async () => {
      end();
      open = false;
      await refusing(() => stream.close());
    },
    abort: async (reason) => {
      end();
      open = false;
      await refusing(() => stream.abort(reason));
    },
  };
}

/** A sink that replaces the file the handle names once it closes. */
export async function openFileSink(file: WritableFile): Promise<ByteSink> {
  const stream = await refusing(() => file.createWritable({ keepExistingData: false }));
  return streamSink(stream);
}

/** A sink that writes the named file in the folder, made where it is not there. */
export async function openFileSinkIn(
  directory: WritableDirectory,
  name: string,
): Promise<ByteSink> {
  const file = await refusing(() => directory.getFileHandle(name, { create: true }));
  return await openFileSink(file);
}
