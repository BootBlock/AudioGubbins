/**
 * What the storage holds, by the categories a person decides what to keep by
 * (REQ-STOR-200, REQ-STOR-102, REQ-STOR-027).
 *
 * - The journal: every project's records not yet in a checkpoint, and those set
 *   aside.
 * - Named snapshots: the states snapshots keep.
 * - Alternative branches: the states kept for nodes off the line the project is
 *   on.
 * - Recovery checkpoints: every other state kept, the checkpoints, the heads,
 *   the headers and the lease records.
 * - Source media in use: media the state a project is in holds.
 * - Retained deleted media: media no project's current state holds that the
 *   history, a snapshot, the journal or a backup still keeps.
 * - Unreferenced media: media nothing keeps, which a purge would free.
 * - Caches, by category, and backup generations.
 *
 * Each project is measured as of its last checkpoint, whose history says which
 * state is which, and the states of open projects the caller names are taken as
 * current besides, since their newest changes may be in the journal alone. A
 * file whose part cannot be told is reported rather than counted as nothing.
 */

import { isWellFormedId, succeed, unsafeBrandId, type DomainResult } from '@audiogubbins/domain';
import { activeLine, type History } from '@audiogubbins/history';
import { contentReferencedBy, type MediaObjectStore } from '@audiogubbins/media-store';
import type {
  ContentId,
  Digest,
  ProjectState,
  StateFingerprint,
  StorageTree,
} from '@audiogubbins/project-format';

import type { CacheCategory, CacheStore } from './cache-store.js';
import { CheckedRecords } from './checked-records.js';
import { readPair } from './generational-pair.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { ProjectFiles } from './project-files.js';
import { refusalsReported } from './storage-failures.js';
import { BACKUPS_DIRECTORY, PROJECTS_DIRECTORY } from './storage-layout.js';

/** The bytes the storage holds in each category. */
export interface StorageUsage {
  readonly journal: number;
  readonly namedSnapshots: number;
  readonly alternativeBranches: number;
  readonly recoveryCheckpoints: number;
  readonly sourceMedia: number;
  readonly retainedDeletedMedia: number;
  readonly unreferencedMedia: number;
  readonly caches: ReadonlyMap<CacheCategory, number>;
  readonly backups: number;

  /** Files whose category could not be told, and why. */
  readonly unreadable: readonly UnreadableRoot[];
}

/** What measuring works with, each made once by the composition root. */
export interface UsageServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;
}

/** The bytes of each category of the projects' own files. */
interface ProjectBytes {
  journal: number;
  namedSnapshots: number;
  alternativeBranches: number;
  recoveryCheckpoints: number;
}

/** Measures the storage (see the module comment). */
export async function measureUsage(
  services: UsageServices,
  live: Iterable<ProjectState> = [],
  signal?: AbortSignal,
): Promise<DomainResult<StorageUsage>> {
  return await refusalsReported(async () => {
    const { tree, digest, store } = services;
    const records = new CheckedRecords(tree, digest);
    const unreadable: UnreadableRoot[] = [];
    const bytes: ProjectBytes = {
      journal: 0,
      namedSnapshots: 0,
      alternativeBranches: 0,
      recoveryCheckpoints: 0,
    };
    const current = new Set<ContentId>();
    for (const state of live)
      for (const content of contentReferencedBy(state)) current.add(content);
    for (const entry of await tree.list(PROJECTS_DIRECTORY)) {
      signal?.throwIfAborted();
      if (entry.kind !== 'directory' || !isWellFormedId(entry.name)) continue;
      const files = new ProjectFiles(records, unsafeBrandId<'ProjectId'>(entry.name));
      await measureProject(files, bytes, current, unreadable, signal);
    }

    const retained = new Set<ContentId>();
    for await (const content of retainedMedia(tree, digest, (root) => unreadable.push(root))) {
      retained.add(content);
    }
    let sourceMedia = 0;
    let retainedDeletedMedia = 0;
    let unreferencedMedia = 0;
    for await (const { contentId, byteLength } of store.list(signal)) {
      if (current.has(contentId)) sourceMedia += byteLength;
      else if (retained.has(contentId)) retainedDeletedMedia += byteLength;
      else unreferencedMedia += byteLength;
    }
    const caches = await services.caches.usage(signal);
    if (!caches.ok) return caches;
    return succeed({
      ...bytes,
      sourceMedia,
      retainedDeletedMedia,
      unreferencedMedia,
      caches: caches.value,
      backups: await bytesUnder(tree, BACKUPS_DIRECTORY),
      unreadable: dedupedByPath(unreadable),
    });
  });
}

/** Adds one project's files to the categories, and its current media to `current`. */
async function measureProject(
  files: ProjectFiles,
  bytes: ProjectBytes,
  current: Set<ContentId>,
  unreadable: UnreadableRoot[],
  signal?: AbortSignal,
): Promise<void> {
  const tree = files.records.tree;
  bytes.journal += await bytesUnder(tree, files.paths.journal);
  bytes.recoveryCheckpoints +=
    (await bytesUnder(tree, files.paths.directory)) -
    (await bytesUnder(tree, files.paths.journal)) -
    (await bytesUnder(tree, files.paths.states));

  const head = (await readPair(files.records, files.heads, signal)).valid[0];
  const checkpoint =
    head === undefined ? undefined : await files.readCheckpoint(head.value.checkpoint, signal);
  const history = checkpoint?.kind === 'valid' ? checkpoint.value.history : undefined;
  if (checkpoint?.kind === 'valid') {
    const state = await files.states.get(checkpoint.value.cursorState, signal);
    if (state.ok) for (const content of contentReferencedBy(state.value)) current.add(content);
    else
      unreadable.push({
        path: files.states.path(checkpoint.value.cursorState),
        failure: state.failures[0],
      });
  }
  const kinds: ReadonlyMap<StateFingerprint, StateKind> =
    history === undefined ? new Map() : stateKinds(history);
  for (const fingerprint of await files.states.list()) {
    const size = (await tree.openFile(files.states.path(fingerprint)))?.size ?? 0;
    bytes[kinds.get(fingerprint) ?? 'recoveryCheckpoints'] += size;
  }
}

type StateKind = 'namedSnapshots' | 'alternativeBranches' | 'recoveryCheckpoints';

/** The category of each state a history names: a snapshot's, the line's, or a branch's. */
function stateKinds(history: History): ReadonlyMap<StateFingerprint, StateKind> {
  const kinds = new Map<StateFingerprint, StateKind>();
  for (const node of history.nodes.values()) {
    if (node.stateFingerprint !== undefined)
      kinds.set(node.stateFingerprint, 'alternativeBranches');
  }
  for (const node of activeLine(history)) {
    if (node.stateFingerprint !== undefined)
      kinds.set(node.stateFingerprint, 'recoveryCheckpoints');
  }
  for (const snapshot of history.snapshots.values()) {
    kinds.set(snapshot.stateFingerprint, 'namedSnapshots');
  }
  return kinds;
}

/** The bytes of every file under a directory. */
export async function bytesUnder(tree: StorageTree, directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await tree.list(directory)) {
    const path = `${directory}/${entry.name}`;
    bytes +=
      entry.kind === 'directory'
        ? await bytesUnder(tree, path)
        : ((await tree.openFile(path))?.size ?? 0);
  }
  return bytes;
}

function dedupedByPath(roots: readonly UnreadableRoot[]): readonly UnreadableRoot[] {
  return [...new Map(roots.map((root) => [root.path, root])).values()];
}
