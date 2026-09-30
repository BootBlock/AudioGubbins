/**
 * Gathering every piece of managed media the projects retain, which a purge of
 * media must not remove (REQ-STOR-099, REQ-STOR-102, REQ-STOR-193).
 *
 * Media is retained by far more than the state a project is in: by every state
 * it keeps whole, by every change its history can undo or redo, whose
 * invocations name the media they add or remove, and by every record not yet
 * folded into a checkpoint, the quarantined among them. A deleted project
 * retains its media until it is purged. So every project's states are read by
 * the media store's own rule, `contentReferencedBy`, and every checkpoint and
 * journal record is searched for any content identifier it holds anywhere,
 * which errs, as it must, on the side of keeping. Every backup generation
 * retains what its states and its checkpoint name, the generations of a purged
 * project among them, until they are removed themselves.
 *
 * A file that cannot be read cannot say what it retains, so it is reported to
 * the caller, which must not purge as though it retained nothing. The roots are
 * yielded as they are found, so the caller marks them without holding a list of
 * every file.
 *
 * Another window may write a checkpoint of a project while its files are
 * gathered, folding records into a checkpoint and a state the listings were
 * taken before, and then removing the records. A checkpoint removes nothing
 * until its head is written, so a project's files are gathered again whenever
 * its newest head is not the same after gathering as before; only a pass the
 * head stayed still through counts, and a project whose head never stays still
 * is reported as unreadable. A file listed and gone in a pass that counts is
 * reported too, since nothing that removes one does so without a new head.
 */

import {
  FailureKind,
  failure,
  flatMapResult,
  isWellFormedId,
  unsafeBrandId,
  type DomainFailure,
  type ProjectId,
} from '@audiogubbins/domain';
import { contentReferencedBy, type ContentRoots } from '@audiogubbins/media-store';
import {
  decodeUtf8,
  parseJson,
  type ContentId,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { contentIdsIn } from './content-references.js';
import { ProjectFiles } from './project-files.js';
import { newestHead, type ProjectHead } from './project-heads.js';
import { SnapshotStore } from './state-store.js';
import {
  BACKUPS_DIRECTORY,
  BackupPaths,
  PROJECTS_DIRECTORY,
  numberOfGeneration,
} from './storage-layout.js';

/** A file whose retained media could not be told, and why. */
export interface UnreadableRoot {
  readonly path: string;
  readonly failure: DomainFailure;
}

/** The bounds a checkpoint's or record's text is searched within. */
const SEARCH_LIMITS = { maximumLength: 2 ** 28, maximumDepth: 32 } as const;

/** How many times a project's files are gathered before a moving head is given up on. */
const MOST_PASSES = 4;

/**
 * Every content identifier every project retains, each project's in turn; an
 * identifier may be yielded more than once. `onUnreadable` hears of each file
 * that could not be read.
 */
export function retainedMedia(
  tree: StorageTree,
  digest: Digest,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): ContentRoots {
  return gather(new CheckedRecords(tree, digest), onUnreadable, signal);
}

async function* gather(
  records: CheckedRecords,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<ContentId, void, undefined> {
  const { tree, digest } = records;
  for (const project of await projectsUnder(tree, PROJECTS_DIRECTORY)) {
    yield* projectRetains(new ProjectFiles(records, project), onUnreadable, signal);
  }
  for (const project of await projectsUnder(tree, BACKUPS_DIRECTORY)) {
    const paths = new BackupPaths(project);
    for (const entry of await tree.list(paths.directory)) {
      const generation = numberOfGeneration(entry.name);
      if (generation === undefined) continue;
      const states = new SnapshotStore(tree, digest, paths.states(generation));
      yield* statesRetain(states, onUnreadable, signal);
      const checkpoint = paths.checkpoint(generation);
      yield* searched(await tree.readFile(checkpoint, signal), checkpoint, onUnreadable);
    }
  }
}

/** What a project retains, gathered until its newest head stays still (see the module comment). */
async function* projectRetains(
  files: ProjectFiles,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<ContentId, void, undefined> {
  const { tree } = files.records;
  for (let pass = 0; pass < MOST_PASSES; pass += 1) {
    const before = await newestHead(files.records, files.paths, signal);
    const problems: UnreadableRoot[] = [];
    const noteProblem = (problem: UnreadableRoot): void => {
      problems.push(problem);
    };
    yield* statesRetain(files.states, noteProblem, signal);
    for (const directory of [files.paths.checkpoints, files.paths.journal]) {
      for await (const path of filesUnder(tree, directory)) {
        signal?.throwIfAborted();
        const bytes = await tree.readFile(path, signal);
        if (bytes === undefined) noteProblem({ path, failure: rootGone(path) });
        else yield* searched(bytes, path, noteProblem);
      }
    }
    if (sameHead(before, await newestHead(files.records, files.paths, signal))) {
      for (const problem of problems) onUnreadable(problem);
      return;
    }
  }
  onUnreadable({ path: files.paths.heads, failure: headMoving() });
}

function sameHead(one: ProjectHead | undefined, other: ProjectHead | undefined): boolean {
  return one?.epoch === other?.epoch && one?.generation === other?.generation;
}

function rootGone(path: string): DomainFailure {
  return failure(
    'storage.root-gone',
    FailureKind.Conflict,
    'A file that may retain media was removed while it was being read.',
    { details: { path } },
  );
}

function headMoving(): DomainFailure {
  return failure(
    'storage.roots-moving',
    FailureKind.Retryable,
    'A project kept changing while the media it retains was gathered.',
  );
}

/** The projects a directory holds one directory for each of. */
async function projectsUnder(tree: StorageTree, directory: string): Promise<readonly ProjectId[]> {
  return (await tree.list(directory)).flatMap((entry) =>
    entry.kind === 'directory' && isWellFormedId(entry.name)
      ? [unsafeBrandId<'ProjectId'>(entry.name)]
      : [],
  );
}

/** What every state of a store refers to. */
async function* statesRetain(
  states: SnapshotStore,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<ContentId, void, undefined> {
  for (const fingerprint of await states.list()) {
    signal?.throwIfAborted();
    const state = await states.get(fingerprint, signal);
    if (state.ok) yield* contentReferencedBy(state.value);
    else onUnreadable({ path: states.path(fingerprint), failure: state.failures[0] });
  }
}

/** Every file under a directory, in name order. */
async function* filesUnder(tree: StorageTree, directory: string): AsyncGenerator<string> {
  for (const entry of await tree.list(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.kind === 'directory') yield* filesUnder(tree, path);
    else yield path;
  }
}

/** Every content identifier a JSON file holds, anywhere in it. */
function* searched(
  bytes: Uint8Array | undefined,
  path: string,
  onUnreadable: (root: UnreadableRoot) => void,
): Generator<ContentId> {
  if (bytes === undefined) return;
  const parsed = flatMapResult(decodeUtf8(bytes), (text) => parseJson(text, SEARCH_LIMITS));
  if (parsed.ok) yield* contentIdsIn(parsed.value);
  else onUnreadable({ path, failure: parsed.failures[0] });
}
