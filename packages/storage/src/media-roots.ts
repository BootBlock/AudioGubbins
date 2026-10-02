/**
 * Gathering every piece of managed media the projects retain, which a purge of
 * media must not remove (REQ-STOR-099, REQ-STOR-102, REQ-STOR-193).
 *
 * Media is retained by far more than the state a project is in: by every state
 * it keeps whole, by every change its history can undo or redo, whose
 * invocations name the media they add or remove, and by every record not yet
 * folded into a checkpoint, the quarantined among them. A deleted project
 * retains its media until it is purged. What a crash left of a project's making
 * or of its purge retains nothing (`project-leftovers.ts`): nothing refers to a
 * project never finished, whose writer holds the media it stores until the
 * project is whole, and a project being purged, with its backups, is gone for
 * good once the purge is finished. So the checkpoint each of a project's heads
 * names is read, with each segment of history and each state it names, and
 * every journal record: the states by the media store's own rule,
 * `contentReferencedBy`, and the rest searched for any content identifier they
 * hold anywhere, which errs, as it must, on the side of keeping. What is named
 * is what can be restored: a checkpoint no head names, and a segment or a state
 * no such checkpoint names, was replaced or never finished, so it retains
 * nothing and is not read, and what a crash tore of a checkpoint's writing
 * holds no purge back. A state no checkpoint names yet is the state at a node
 * of the history the journal or a named segment holds, which names its media
 * too. Every whole backup generation retains what its checkpoint, and the
 * segments and states that checkpoint names, name, the generations of a purged
 * project among them, until they are removed themselves; an incomplete one is
 * never read as a backup, so it retains nothing.
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

import { BackupGenerations } from './backup-generations.js';
import { CheckedRecords, RecordKind, type RecordFault } from './checked-records.js';
import { readCheckpointRecord } from './checkpoint-record.js';
import type { SegmentPath } from './checkpoint-files.js';
import { contentIdsIn } from './content-references.js';
import { ProjectFiles } from './project-files.js';
import { newestHead, readHeads, sameHead } from './project-heads.js';
import { leftOverOf } from './project-leftovers.js';
import { SnapshotStore } from './state-store.js';
import { BACKUPS_DIRECTORY, BackupPaths, PROJECTS_DIRECTORY } from './storage-layout.js';

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
 * Where the files a checkpoint names lie, and the paths one gathering has read
 * already, since checkpoints one after another name many of the same.
 */
interface NamedFiles {
  readonly segment: SegmentPath;
  readonly states: SnapshotStore;
  readonly read: Set<string>;
}

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
  const leftOvers = new Set<ProjectId>();
  for (const project of await projectsUnder(tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const files = new ProjectFiles(records, project);
    if ((await leftOverOf(files, signal)) === undefined) {
      yield* projectRetains(files, onUnreadable, signal);
    } else leftOvers.add(project);
  }
  for (const project of await projectsUnder(tree, BACKUPS_DIRECTORY)) {
    if (leftOvers.has(project)) continue;
    const paths = new BackupPaths(project);
    const listing = await new BackupGenerations(tree, digest, project).list(signal);
    if (!listing.ok) {
      onUnreadable({ path: paths.directory, failure: listing.failures[0] });
      continue;
    }
    for (const { number } of listing.value.generations) {
      signal?.throwIfAborted();
      const named: NamedFiles = {
        segment: (segment) => paths.segment(number, segment),
        states: new SnapshotStore(tree, digest, paths.states(number)),
        read: new Set(),
      };
      yield* checkpointRetains(records, paths.checkpoint(number), named, onUnreadable, signal);
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
    const heads = await readHeads(files.records, files.paths, signal);
    const before = heads.valid[0];
    const problems: UnreadableRoot[] = [];
    const noteProblem = (problem: UnreadableRoot): void => {
      problems.push(problem);
    };
    const named: NamedFiles = {
      segment: (segment) => files.paths.segment(segment),
      states: files.states,
      read: new Set(),
    };
    for (const { epoch, checkpoint } of heads.valid) {
      signal?.throwIfAborted();
      const path = files.paths.checkpoint(epoch, checkpoint);
      yield* checkpointRetains(files.records, path, named, noteProblem, signal);
    }
    for await (const path of filesUnder(tree, files.paths.journal)) {
      signal?.throwIfAborted();
      yield* fileRetains(tree, path, noteProblem, signal);
    }
    if (sameHead(before, await newestHead(files.records, files.paths, signal))) {
      for (const problem of problems) onUnreadable(problem);
      return;
    }
  }
  onUnreadable({ path: files.paths.heads, failure: headMoving() });
}

/**
 * What a checkpoint retains, with the segments of history and the states it
 * names, each read once in a gathering.
 */
async function* checkpointRetains(
  records: CheckedRecords,
  path: string,
  named: NamedFiles,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<ContentId, void, undefined> {
  if (!firstRead(named, path)) return;
  const record = await records.read(path, RecordKind.Checkpoint, readCheckpointRecord, signal);
  if (record.kind !== 'valid') {
    const failure = record.kind === 'absent' ? rootGone(path) : rootUnreadable(path, record.fault);
    onUnreadable({ path, failure });
    return;
  }
  yield* fileRetains(records.tree, path, onUnreadable, signal);
  for (const segment of record.value.history.segments) {
    const segmentPath = named.segment(segment);
    if (!firstRead(named, segmentPath)) continue;
    signal?.throwIfAborted();
    yield* fileRetains(records.tree, segmentPath, onUnreadable, signal);
  }
  for (const fingerprint of new Set([record.value.cursorState, ...record.value.keptStates])) {
    const statePath = named.states.path(fingerprint);
    if (!firstRead(named, statePath)) continue;
    signal?.throwIfAborted();
    const state = await named.states.get(fingerprint, signal);
    if (state.ok) yield* contentReferencedBy(state.value);
    else onUnreadable({ path: statePath, failure: state.failures[0] });
  }
}

/** Whether a gathering reads `path` for the first time, which it then has. */
function firstRead(named: NamedFiles, path: string): boolean {
  if (named.read.has(path)) return false;
  named.read.add(path);
  return true;
}

/** What a file of JSON retains, or that it is gone or cannot be read. */
async function* fileRetains(
  tree: StorageTree,
  path: string,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<ContentId, void, undefined> {
  const bytes = await tree.readFile(path, signal);
  if (bytes === undefined) onUnreadable({ path, failure: rootGone(path) });
  else yield* searched(bytes, path, onUnreadable);
}

function rootUnreadable(path: string, fault: RecordFault): DomainFailure {
  return failure(
    'storage.root-unreadable',
    FailureKind.IntegrityViolation,
    'A checkpoint that may retain media cannot be read.',
    { details: { path, fault: fault.kind } },
  );
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
