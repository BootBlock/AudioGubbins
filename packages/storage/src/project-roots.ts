/**
 * Walking everything the projects keep that a restore or an undo could bring
 * back, for what it refers to: the walk a purge of media and the model packs'
 * pins both read (REQ-STOR-099, REQ-STOR-102, REQ-STOR-193, REQ-AUDIO-139).
 *
 * What a project refers to is held by far more than the state it is in: by
 * every state it keeps whole, by every change its history can undo or redo,
 * whose invocations name what they add or remove, and by every record not yet
 * folded into a checkpoint, the quarantined among them. A deleted project holds
 * on until it is purged. What a crash left of a project's making or of its
 * purge holds nothing (`project-leftovers.ts`): nothing refers to a project
 * never finished, whose writer holds what it stores until the project is whole,
 * and a project being purged, with its backups, is gone for good once the purge
 * is finished. So the checkpoint each of a project's heads names is read, with
 * each segment of history and each state it names, and every journal record:
 * the states by the reader's rule for a state, and the rest searched for
 * anything of the shape the reader looks for, anywhere in them, which errs, as
 * it must, on the side of keeping. What is named is what can be restored: a
 * checkpoint no head names, and a segment or a state no such checkpoint names,
 * was replaced or never finished, so it holds nothing and is not read, and what
 * a crash tore of a checkpoint's writing holds nothing back. A state no
 * checkpoint names yet is the state at a node of the history the journal or a
 * named segment holds, which names what it refers to too. Every whole backup
 * generation holds what its checkpoint, and the segments and states that
 * checkpoint names, name, the generations of a purged project among them, until
 * they are removed themselves; an incomplete one is never read as a backup, so
 * it holds nothing.
 *
 * A file that cannot be read cannot say what it refers to, so it is reported
 * to the caller, which must not act as though it referred to nothing. What is
 * found is yielded as it is found, so the caller marks it without holding a
 * list of every file, and nothing is read until the caller asks for the next.
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
  type DomainFailure,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  decodeUtf8,
  parseJson,
  type JsonValue,
  type ProjectState,
  type StorageTree,
} from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import {
  RECORD_LIMITS,
  RecordKind,
  type CheckedRecords,
  type RecordFault,
} from './checked-records.js';
import { readCheckpointRecord } from './checkpoint-record.js';
import type { SegmentPath } from './checkpoint-files.js';
import { ProjectFiles } from './project-files.js';
import { newestHead, readHeads, sameHead } from './project-heads.js';
import { leftOverOf } from './project-leftovers.js';
import { projectsIn } from './project-listing.js';
import { SnapshotStore } from './state-store.js';
import { BACKUPS_DIRECTORY, BackupPaths, PROJECTS_DIRECTORY } from './storage-layout.js';

/** A file whose references could not be told, and why. */
export interface UnreadableRoot {
  readonly path: string;
  readonly failure: DomainFailure;
}

/** What a walk looks for: what a whole state refers to, and what a record's value holds anywhere. */
export interface RootReading<TRoot> {
  readonly inState: (state: ProjectState) => Iterable<TRoot>;
  readonly inValue: (value: JsonValue) => Iterable<TRoot>;
}

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

/** One walk: the records it reads through, what it looks for and whom it tells of a file it cannot read. */
interface Walk<TRoot> {
  readonly records: CheckedRecords;
  readonly reading: RootReading<TRoot>;
  readonly onUnreadable: (root: UnreadableRoot) => void;
  readonly signal: AbortSignal | undefined;
}

/**
 * Everything `reading` finds in what every project keeps, each project's in
 * turn; a root may be yielded more than once. `onUnreadable` hears of each
 * file that could not be read.
 */
export async function* projectRoots<TRoot>(
  records: CheckedRecords,
  reading: RootReading<TRoot>,
  onUnreadable: (root: UnreadableRoot) => void,
  signal?: AbortSignal,
): AsyncGenerator<TRoot, void, undefined> {
  const walk: Walk<TRoot> = { records, reading, onUnreadable, signal };
  const { tree, digest } = records;
  const leftOvers = new Set<ProjectId>();
  for (const project of await projectsIn(tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const files = new ProjectFiles(records, project);
    if ((await leftOverOf(files, signal)) === undefined) yield* projectHolds(walk, files);
    else leftOvers.add(project);
  }
  for (const project of await projectsIn(tree, BACKUPS_DIRECTORY)) {
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
      yield* checkpointHolds(walk, paths.checkpoint(number), named, onUnreadable);
    }
  }
}

/** What a project holds, gathered until its newest head stays still (see the module comment). */
async function* projectHolds<TRoot>(
  walk: Walk<TRoot>,
  files: ProjectFiles,
): AsyncGenerator<TRoot, void, undefined> {
  const { signal } = walk;
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
      yield* checkpointHolds(walk, path, named, noteProblem);
    }
    for await (const path of filesUnder(tree, files.paths.journal)) {
      signal?.throwIfAborted();
      yield* fileHolds(walk, path, noteProblem);
    }
    if (sameHead(before, await newestHead(files.records, files.paths, signal))) {
      for (const problem of problems) walk.onUnreadable(problem);
      return;
    }
  }
  walk.onUnreadable({ path: files.paths.heads, failure: headMoving() });
}

/**
 * What a checkpoint holds, with the segments of history and the states it
 * names, each read once in a gathering.
 */
async function* checkpointHolds<TRoot>(
  walk: Walk<TRoot>,
  path: string,
  named: NamedFiles,
  onUnreadable: (root: UnreadableRoot) => void,
): AsyncGenerator<TRoot, void, undefined> {
  const { records, signal } = walk;
  if (!firstRead(named, path)) return;
  const record = await records.read(path, RecordKind.Checkpoint, readCheckpointRecord, signal);
  if (record.kind !== 'valid') {
    const failure = record.kind === 'absent' ? rootGone(path) : rootUnreadable(path, record.fault);
    onUnreadable({ path, failure });
    return;
  }
  yield* fileHolds(walk, path, onUnreadable);
  for (const segment of record.value.history.segments) {
    const segmentPath = named.segment(segment);
    if (!firstRead(named, segmentPath)) continue;
    signal?.throwIfAborted();
    yield* fileHolds(walk, segmentPath, onUnreadable);
  }
  for (const fingerprint of new Set([record.value.cursorState, ...record.value.keptStates])) {
    const statePath = named.states.path(fingerprint);
    if (!firstRead(named, statePath)) continue;
    signal?.throwIfAborted();
    const state = await named.states.get(fingerprint, signal);
    if (state.ok) yield* walk.reading.inState(state.value);
    else onUnreadable({ path: statePath, failure: state.failures[0] });
  }
}

/** Whether a gathering reads `path` for the first time, which it then has. */
function firstRead(named: NamedFiles, path: string): boolean {
  if (named.read.has(path)) return false;
  named.read.add(path);
  return true;
}

/** What a file of JSON holds, or that it is gone or cannot be read. */
async function* fileHolds<TRoot>(
  walk: Walk<TRoot>,
  path: string,
  onUnreadable: (root: UnreadableRoot) => void,
): AsyncGenerator<TRoot, void, undefined> {
  const bytes = await walk.records.tree.readFile(path, walk.signal);
  if (bytes === undefined) {
    onUnreadable({ path, failure: rootGone(path) });
    return;
  }
  const parsed = flatMapResult(decodeUtf8(bytes), (text) => parseJson(text, RECORD_LIMITS));
  if (parsed.ok) yield* walk.reading.inValue(parsed.value);
  else onUnreadable({ path, failure: parsed.failures[0] });
}

function rootUnreadable(path: string, fault: RecordFault): DomainFailure {
  return failure(
    'storage.root-unreadable',
    FailureKind.IntegrityViolation,
    'A checkpoint whose references must be known cannot be read.',
    { details: { path, fault: fault.kind } },
  );
}

function rootGone(path: string): DomainFailure {
  return failure(
    'storage.root-gone',
    FailureKind.Conflict,
    'A file whose references must be known was removed while it was being read.',
    { details: { path } },
  );
}

function headMoving(): DomainFailure {
  return failure(
    'storage.roots-moving',
    FailureKind.Retryable,
    'A project kept changing while what it refers to was gathered.',
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
