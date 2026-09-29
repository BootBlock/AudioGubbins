/**
 * A directory the person chose, holding a project's unpacked tree: the port the
 * platform implements, and the tree read from it or written into it
 * (REQ-STOR-103, REQ-EXEC-216).
 *
 * The browser implements the port over a picked directory, or reads a list of
 * files a folder input gave; nothing here knows which. A repository keeps its
 * own files beside the tree, such as `.git` or a read-me, so only the tree's
 * header and what lies in its directories are read, and a file there that no
 * tree has is refused rather than passed over. Writing replaces the tree's
 * files and removes those of the tree that the project no longer has, and
 * leaves every other file as it was. A media file already there under its
 * content identity, at its length, is not written again. The directory cannot
 * be changed atomically: a write cut short leaves a tree the next write
 * completes, and the reader refuses one that does not agree with itself.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  isProjectTreePath,
  isWithinProjectTree,
  type ByteSink,
  type ByteSource,
  type ProjectTreeFile,
  type ProjectTreeListing,
} from '@audiogubbins/project-format';

import type { BodyOpener } from './bundle-writing.js';
import { bytesSource, streamInto } from './byte-streams.js';
import { refusalsReported } from './storage-failures.js';

/** A file of a directory, by its path inside it with `/` between segments. */
export interface DirectoryFile {
  readonly path: string;
  readonly size: number;
}

/**
 * A directory to read. Each member rejects with a `TreeFailure` where the
 * platform refuses.
 */
export interface DirectoryReader {
  /** Every file under the directory, at any depth. */
  list(signal?: AbortSignal): Promise<readonly DirectoryFile[]>;

  /** A file to read in ranges, or `undefined` where there is none. */
  open(path: string): Promise<ByteSource | undefined>;
}

/** A directory to write, which can be read too. */
export interface DirectoryWriter extends DirectoryReader {
  /** A file to write in order, replacing any there; it is whole once the sink closes. */
  create(path: string): Promise<ByteSink>;

  /** Removes a file. Absent is not a failure. */
  remove(path: string): Promise<void>;
}

/** The tree a directory holds, as a listing and a way to open its media and caches. */
export async function directoryTree(
  reader: DirectoryReader,
  signal?: AbortSignal,
): Promise<DomainResult<{ readonly listing: ProjectTreeListing; readonly open: BodyOpener }>> {
  return await refusalsReported(async () => {
    const files = (await reader.list(signal)).filter(({ path }) => isWithinProjectTree(path));
    const opened = async (path: string) => {
      const source = await reader.open(path);
      return source === undefined ? fail(fileVanished(path)) : succeed(source);
    };
    return succeed({
      listing: {
        files,
        read: async (path, readSignal) =>
          await refusalsReported(async () => {
            const source = await opened(path);
            if (!source.ok) return source;
            const bytes = await source.value.read(0, source.value.size, readSignal);
            return bytes.length === source.value.size ? succeed(bytes) : fail(fileVanished(path));
          }),
      },
      open: async ({ path }) => await refusalsReported(async () => await opened(path)),
    });
  });
}

/**
 * Writes a tree's files into a directory, each media file and cache read by
 * `open`, and removes the tree's files the project no longer has.
 */
export async function writeTreeInto(
  writer: DirectoryWriter,
  files: readonly ProjectTreeFile[],
  open: BodyOpener,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  return await refusalsReported(async () => {
    const present = new Map(
      (await writer.list(signal)).map(({ path, size }) => [path, size] as const),
    );
    for (const file of files) {
      signal?.throwIfAborted();
      const { path, body } = file;
      if (body.kind === 'media' && present.get(path) === body.byteLength) continue;
      const source =
        body.kind === 'text' ? succeed(bytesSource(body.bytes)) : await open(file, signal);
      if (!source.ok) return source;
      const written = await streamInto(source.value, await writer.create(path), signal);
      if (!written.ok) return written;
    }
    const kept = new Set(files.map(({ path }) => path));
    for (const path of present.keys()) {
      if (!kept.has(path) && isProjectTreePath(path)) await writer.remove(path);
    }
    return succeed(undefined);
  });
}

function fileVanished(path: string) {
  return failure(
    'storage.file-changed',
    FailureKind.Conflict,
    'A file of the directory changed or vanished while it was read.',
    { details: { file: path } },
  );
}
