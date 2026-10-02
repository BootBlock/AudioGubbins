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
import {
  Turns,
  type ContentId,
  type Digest,
  type ProjectState,
  type StateFingerprint,
  type StorageTree,
  type YieldToHost,
} from '@audiogubbins/project-format';

import type { CacheCategory, CacheStore } from './cache-store.js';
import { CheckedRecords } from './checked-records.js';
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

  /** Asked through the passes over histories and media held in memory. */
  readonly yieldToHost: YieldToHost;
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
    const { tree, digest } = services;
    const turns = new Turns(services.yieldToHost, signal);
    const records = new CheckedRecords(tree, digest);
    const unreadable: UnreadableRoot[] = [];
    const bytes: ProjectBytes = {
      journal: 0,
      namedSnapshots: 0,
      alternativeBranches: 0,
      recoveryCheckpoints: 0,
    };
    const current = new Set<ContentId>();
    for (const state of live) {
      await turns.afterStep();
      for (const content of contentReferencedBy(state)) current.add(content);
    }
    for (const entry of await tree.list(PROJECTS_DIRECTORY)) {
      signal?.throwIfAborted();
      if (entry.kind !== 'directory' || !isWellFormedId(entry.name)) continue;
      const files = new ProjectFiles(records, unsafeBrandId<'ProjectId'>(entry.name));
      await measureProject(files, bytes, current, unreadable, turns);
    }
    const media = await mediaBytes(services, current, unreadable, turns);
    const caches = await services.caches.usage(signal);
    if (!caches.ok) return caches;
    return succeed({
      ...bytes,
      ...media,
      caches: caches.value,
      backups: await bytesUnder(tree, BACKUPS_DIRECTORY, signal),
      unreadable: dedupedByPath(unreadable),
    });
  });
}

/** The bytes of the media the store keeps, by whether a project holds it now or retains it. */
async function mediaBytes(
  { tree, digest, store }: UsageServices,
  current: ReadonlySet<ContentId>,
  unreadable: UnreadableRoot[],
  turns: Turns,
): Promise<Pick<StorageUsage, 'sourceMedia' | 'retainedDeletedMedia' | 'unreferencedMedia'>> {
  const { signal } = turns;
  const retained = new Set<ContentId>();
  const noteUnreadable = (root: UnreadableRoot): void => {
    unreadable.push(root);
  };
  for await (const content of retainedMedia(tree, digest, noteUnreadable, signal)) {
    await turns.afterStep();
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
  return { sourceMedia, retainedDeletedMedia, unreferencedMedia };
}

/** Adds one project's files to the categories, and its current media to `current`. */
async function measureProject(
  files: ProjectFiles,
  bytes: ProjectBytes,
  current: Set<ContentId>,
  unreadable: UnreadableRoot[],
  turns: Turns,
): Promise<void> {
  const tree = files.records.tree;
  const { signal } = turns;
  bytes.journal += await bytesUnder(tree, files.paths.journal, signal);
  bytes.recoveryCheckpoints +=
    (await bytesUnder(tree, files.paths.directory, signal)) -
    (await bytesUnder(tree, files.paths.journal, signal)) -
    (await bytesUnder(tree, files.paths.states, signal));

  const checkpoint = await files.newestCheckpoint(signal);
  const history = checkpoint?.history;
  if (checkpoint !== undefined) {
    const state = await files.states.get(checkpoint.cursorState, signal);
    if (state.ok) for (const content of contentReferencedBy(state.value)) current.add(content);
    else
      unreadable.push({
        path: files.states.path(checkpoint.cursorState),
        failure: state.failures[0],
      });
  }
  const kinds: ReadonlyMap<StateFingerprint, StateKind> =
    history === undefined ? new Map() : await stateKinds(history, turns);
  for (const fingerprint of await files.states.list()) {
    signal?.throwIfAborted();
    const size = (await tree.openFile(files.states.path(fingerprint)))?.size ?? 0;
    bytes[kinds.get(fingerprint) ?? 'recoveryCheckpoints'] += size;
  }
}

type StateKind = 'namedSnapshots' | 'alternativeBranches' | 'recoveryCheckpoints';

/**
 * The category of each state a history names: a snapshot's, the line's, or a
 * branch's. A history may hold a million nodes, so each takes a step.
 */
async function stateKinds(
  history: History,
  turns: Turns,
): Promise<ReadonlyMap<StateFingerprint, StateKind>> {
  const kinds = new Map<StateFingerprint, StateKind>();
  for (const node of history.nodes.values()) {
    await turns.afterStep();
    if (node.stateFingerprint !== undefined)
      kinds.set(node.stateFingerprint, 'alternativeBranches');
  }
  for (const node of activeLine(history)) {
    await turns.afterStep();
    if (node.stateFingerprint !== undefined)
      kinds.set(node.stateFingerprint, 'recoveryCheckpoints');
  }
  for (const snapshot of history.snapshots.values()) {
    kinds.set(snapshot.stateFingerprint, 'namedSnapshots');
  }
  return kinds;
}

/** The bytes of every file under a directory. */
export async function bytesUnder(
  tree: StorageTree,
  directory: string,
  signal?: AbortSignal,
): Promise<number> {
  let bytes = 0;
  for (const entry of await tree.list(directory)) {
    signal?.throwIfAborted();
    const path = `${directory}/${entry.name}`;
    bytes +=
      entry.kind === 'directory'
        ? await bytesUnder(tree, path, signal)
        : ((await tree.openFile(path))?.size ?? 0);
  }
  return bytes;
}

function dedupedByPath(roots: readonly UnreadableRoot[]): readonly UnreadableRoot[] {
  return [...new Map(roots.map((root) => [root.path, root])).values()];
}
