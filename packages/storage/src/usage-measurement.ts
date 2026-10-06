/**
 * What the storage holds, by the categories a person decides what to keep by
 * (REQ-STOR-200, REQ-STOR-102, REQ-STOR-027).
 *
 * - The journal: every project's records not yet in a checkpoint, and those set
 *   aside.
 * - Named snapshots: the states snapshots keep.
 * - Alternative branches: the states kept for nodes off the line the project is
 *   on, and the share of the history's segments that holds those nodes.
 * - Recovery checkpoints: every other state kept, the rest of the segments, the
 *   checkpoints, the heads, the headers and the lease records.
 * - Source media in use: media the state a project is in holds.
 * - Retained deleted media: media no project's current state holds that the
 *   history, a snapshot, the journal or a backup still keeps, split by what
 *   keeps it (`history-usage.ts`): a snapshot, the line a project is on, only
 *   another branch, or only a backup or the journal.
 * - Unreferenced media: media nothing keeps, which a purge would free.
 * - Caches, by category, and backup generations.
 * - Model packs: the versions installed, and apart from them every version not
 *   installed, whose download is arriving, paused, being checked or was left
 *   unreadable (`model-pack-store.ts`).
 *
 * Each project is measured as of its last checkpoint, whose history says which
 * state is which, and the states of open projects the caller names are taken as
 * current besides, since their newest changes may be in the journal alone. A
 * file whose part cannot be told is reported rather than counted as nothing.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
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
import { historyUsage, strongerOf, type RetainedBy } from './history-usage.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import type { ModelPackStore } from './model-pack-store.js';
import { ProjectFiles } from './project-files.js';
import { projectsIn } from './project-listing.js';
import { refusalsReported } from './storage-failures.js';
import { BACKUPS_DIRECTORY, PROJECTS_DIRECTORY } from './storage-layout.js';
import { bytesUnder } from './tree-bytes.js';

/** The bytes the storage holds in each category. */
export interface StorageUsage {
  readonly journal: number;
  readonly namedSnapshots: number;
  readonly alternativeBranches: number;
  readonly recoveryCheckpoints: number;
  readonly sourceMedia: number;
  readonly retainedDeletedMedia: RetainedMediaUsage;
  readonly unreferencedMedia: number;
  readonly caches: ReadonlyMap<CacheCategory, number>;
  readonly backups: number;
  readonly packs: PackUsage;

  /** Files whose category could not be told, and why. */
  readonly unreadable: readonly UnreadableRoot[];
}

/** The bytes of media no project's state holds, by what keeps it. */
export interface RetainedMediaUsage {
  /** Kept by a named snapshot. */
  readonly namedSnapshots: number;

  /** Kept by the line a project is on, which undo reaches, and by no snapshot. */
  readonly undo: number;

  /** Kept only by another branch of a history. */
  readonly alternativeBranches: number;

  /** Kept only by a backup, or by changes not yet in a checkpoint. */
  readonly elsewhere: number;
}

/** The bytes of the model packs kept, installed and not. */
export interface PackUsage {
  /** The versions installed, which processors may use. */
  readonly installed: number;

  /**
   * Every other version: a download arriving, paused or being checked, or one
   * left unreadable, none of which is used.
   */
  readonly partial: number;
}

/** What measuring works with, each made once by the composition root. */
export interface UsageServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;
  readonly packs: ModelPackStore;

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

/** What measuring the projects gathers as it goes. */
interface Measuring {
  readonly bytes: ProjectBytes;

  /** The media the state each project is in holds. */
  readonly current: Set<ContentId>;

  /** What keeps each piece of media a history keeps. */
  readonly retainedBy: Map<ContentId, RetainedBy>;
  readonly unreadable: UnreadableRoot[];
  readonly turns: Turns;
}

/** Measures the storage (see the module comment). */
export async function measureUsage(
  services: UsageServices,
  live: Iterable<ProjectState> = [],
  signal?: AbortSignal,
): Promise<DomainResult<StorageUsage>> {
  return await refusalsReported(async () => {
    const { tree, digest } = services;
    const records = new CheckedRecords(tree, digest);
    const measuring: Measuring = {
      bytes: { journal: 0, namedSnapshots: 0, alternativeBranches: 0, recoveryCheckpoints: 0 },
      current: new Set(),
      retainedBy: new Map(),
      unreadable: [],
      turns: new Turns(services.yieldToHost, signal),
    };
    for (const state of live) {
      await measuring.turns.afterStep();
      for (const content of contentReferencedBy(state)) measuring.current.add(content);
    }
    for (const project of await projectsIn(tree, PROJECTS_DIRECTORY)) {
      signal?.throwIfAborted();
      await measureProject(new ProjectFiles(records, project), measuring);
    }
    const media = await mediaBytes(services, measuring);
    const caches = await services.caches.usage(signal);
    if (!caches.ok) return caches;
    const packs = await services.packs.measured(signal);
    if (!packs.ok) return packs;
    const packUsage = { installed: 0, partial: 0 };
    for (const pack of packs.value) packUsage[pack.kind] += pack.bytes;
    return succeed({
      ...measuring.bytes,
      ...media,
      caches: caches.value,
      backups: await bytesUnder(tree, BACKUPS_DIRECTORY, signal),
      packs: packUsage,
      unreadable: dedupedByPath(measuring.unreadable),
    });
  });
}

/** The bytes of the media the store keeps, by whether a project holds it now or what retains it. */
async function mediaBytes(
  { tree, digest, store }: UsageServices,
  { current, retainedBy, unreadable, turns }: Measuring,
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
  let unreferencedMedia = 0;
  const kept = { namedSnapshots: 0, undo: 0, alternativeBranches: 0, elsewhere: 0 };
  for await (const { contentId, byteLength } of store.list(signal)) {
    if (current.has(contentId)) sourceMedia += byteLength;
    else if (retained.has(contentId)) kept[retainedBy.get(contentId) ?? 'elsewhere'] += byteLength;
    else unreferencedMedia += byteLength;
  }
  return { sourceMedia, retainedDeletedMedia: kept, unreferencedMedia };
}

/**
 * Adds one project's files to the categories, its current media to `current`,
 * and what its history keeps to `retainedBy`.
 */
async function measureProject(files: ProjectFiles, measuring: Measuring): Promise<void> {
  const { bytes, current, unreadable, turns } = measuring;
  const tree = files.records.tree;
  const { signal } = turns;
  bytes.journal += await bytesUnder(tree, files.paths.journal, signal);
  bytes.recoveryCheckpoints +=
    (await bytesUnder(tree, files.paths.directory, signal)) -
    (await bytesUnder(tree, files.paths.journal, signal)) -
    (await bytesUnder(tree, files.paths.states, signal));

  const checkpoint = await files.newestCheckpoint(signal);
  if (checkpoint !== undefined) {
    const state = await files.states.get(checkpoint.cursorState, signal);
    if (state.ok) for (const content of contentReferencedBy(state.value)) current.add(content);
    else
      unreadable.push({
        path: files.states.path(checkpoint.cursorState),
        failure: state.failures[0],
      });
    const history = await historyUsage(files, checkpoint, turns, unreadable);
    bytes.recoveryCheckpoints -= history.branchBytes;
    bytes.alternativeBranches += history.branchBytes;
    for (const [content, by] of history.retainedBy) {
      measuring.retainedBy.set(content, strongerOf(measuring.retainedBy.get(content), by));
    }
  }
  const kinds: ReadonlyMap<StateFingerprint, StateKind> =
    checkpoint === undefined ? new Map() : await stateKinds(checkpoint.history, turns);
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

function dedupedByPath(roots: readonly UnreadableRoot[]): readonly UnreadableRoot[] {
  return [...new Map(roots.map((root) => [root.path, root])).values()];
}
