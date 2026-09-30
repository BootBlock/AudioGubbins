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
 * content identity, at its length, is not written again. A directory is
 * claimed for a project before anything is written into it: one that holds no
 * tree, or the same project's, is claimed at once, and one that holds another
 * project's tree, or a tree whose header cannot be read, only where the person
 * confirmed replacing it, so no write ever takes another project's files
 * unasked. The directory cannot be changed atomically: a write cut short
 * leaves a tree the next write completes, and the reader refuses one that does
 * not agree with itself, and says whether it changed the directory at all.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  isProjectTreePath,
  isWithinProjectTree,
  readProjectTreeHeader,
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

/** A directory's tree, as a listing of `listed` and a way to open its media and caches. */
function treeOf(
  reader: DirectoryReader,
  listed: readonly DirectoryFile[],
): { readonly listing: ProjectTreeListing; readonly open: BodyOpener } {
  const files = listed.filter(({ path }) => isWithinProjectTree(path));
  const opened = async (path: string) => {
    const source = await reader.open(path);
    return source === undefined ? fail(fileVanished(path)) : succeed(source);
  };
  return {
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
  };
}

/** The tree a directory holds, as a listing and a way to open its media and caches. */
export async function directoryTree(
  reader: DirectoryReader,
  signal?: AbortSignal,
): Promise<DomainResult<{ readonly listing: ProjectTreeListing; readonly open: BodyOpener }>> {
  return await refusalsReported(async () => succeed(treeOf(reader, await reader.list(signal))));
}

/** Whether a directory holding another project's tree may be written over. */
export interface DirectoryClaim {
  /** The person confirmed replacing the other project's files. */
  readonly replaceAnother?: boolean;
}

/** A directory claimed for one project's tree, and the files it held then. */
export interface ClaimedDirectory {
  readonly writer: DirectoryWriter;
  readonly present: ReadonlyMap<string, number>;
}

const HOLDS_ANOTHER_PROJECT = 'storage.folder-holds-another-project';

/** Why a directory is not claimed: it holds another project's tree, named where it can be read. */
function holdsAnother(name: string | undefined): DomainFailure {
  return failure(
    HOLDS_ANOTHER_PROJECT,
    FailureKind.Conflict,
    name === undefined
      ? 'The folder holds files of a project whose header cannot be read. Choose another folder, or replace them.'
      : `The folder holds another project, "${name}". Choose another folder, or replace its files.`,
    name === undefined ? {} : { details: { name } },
  );
}

/** Another project a claimed directory was found to hold, named where its header could be read. */
export interface AnotherProject {
  readonly name: string | undefined;
}

/**
 * The other project a failure found in a directory, which the person may
 * replace, or `undefined` where the failure is anything else.
 */
export function anotherProjectIn(cause: DomainFailure): AnotherProject | undefined {
  if (cause.code !== HOLDS_ANOTHER_PROJECT) return undefined;
  const name = cause.details?.['name'];
  return { name: typeof name === 'string' ? name : undefined };
}

/** Claims a directory for `project`'s tree (see the module comment). */
export async function claimDirectory(
  writer: DirectoryWriter,
  project: ProjectId,
  claim: DirectoryClaim,
  signal?: AbortSignal,
): Promise<DomainResult<ClaimedDirectory>> {
  return await refusalsReported(async () => {
    const listed = await writer.list(signal);
    const present = new Map(listed.map(({ path, size }) => [path, size] as const));
    const claimed = succeed({ writer, present });
    if (!listed.some(({ path }) => isProjectTreePath(path)) || claim.replaceAnother === true) {
      return claimed;
    }
    const header = await readProjectTreeHeader(treeOf(writer, listed).listing, signal);
    if (header.ok && header.value.project === project) return claimed;
    return fail(holdsAnother(header.ok ? header.value.displayName : undefined));
  });
}

/** What writing a tree came to, and whether it changed the directory before any failure. */
export interface TreeWrite {
  readonly written: DomainResult<void>;
  readonly changed: boolean;
}

/**
 * Writes a tree's files into a claimed directory, each media file and cache
 * read by `open`, and removes the tree's files the project no longer has.
 */
export async function writeTreeInto(
  claimed: ClaimedDirectory,
  files: readonly ProjectTreeFile[],
  open: BodyOpener,
  signal?: AbortSignal,
): Promise<TreeWrite> {
  const { writer, present } = claimed;
  let changed = false;
  const written = await refusalsReported(async () => {
    for (const file of files) {
      signal?.throwIfAborted();
      const { path, body } = file;
      if (body.kind === 'media' && present.get(path) === body.byteLength) continue;
      const source =
        body.kind === 'text' ? succeed(bytesSource(body.bytes)) : await open(file, signal);
      if (!source.ok) return source;
      const sink = await writer.create(path);
      changed = true;
      const streamed = await streamInto(source.value, sink, signal);
      if (!streamed.ok) return streamed;
    }
    const kept = new Set(files.map(({ path }) => path));
    for (const path of present.keys()) {
      if (kept.has(path) || !isProjectTreePath(path)) continue;
      changed = true;
      await writer.remove(path);
    }
    return succeed(undefined);
  });
  return { written, changed };
}

function fileVanished(path: string) {
  return failure(
    'storage.file-changed',
    FailureKind.Conflict,
    'A file of the directory changed or vanished while it was read.',
    { details: { file: path } },
  );
}
