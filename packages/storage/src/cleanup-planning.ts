/**
 * Planning a cleanup: what each step would remove, how many bytes it would
 * free, and what the person would lose by it, in the order that is safest
 * (REQ-STOR-106, REQ-STOR-102, REQ-STOR-200, REQ-STOR-027).
 *
 * The steps come in this order, each only where the person chose it:
 *
 * 1. Caches, category by category, temporary data first, then render and
 *    analysis caches, waveform and spectrogram caches, and intermediate
 *    results. Each is made again when needed, so nothing is lost.
 * 2. Projects whose making was cut short, never finished and never listed, and
 *    projects whose purge was cut short, which the person confirmed.
 * 3. Backup generations each project's retention no longer keeps, and those a
 *    crash left incomplete: restoring to them is lost.
 * 4. History each project's retention policy lets go (`expired-history.ts`):
 *    the plan of each lists the undoing, branches and export states it loses.
 * 5. Journal records recovery set aside: what they held can no longer be looked
 *    at.
 * 6. Media nothing refers to: no project, history, snapshot, journal or backup
 *    holds it, and it is gone for good.
 *
 * Planning removes nothing. Every step past the caches reduces what can be
 * recovered, so carrying the plan out needs the person's confirmation of the
 * bytes those steps would free (`cleanup-running.ts`). Media is planned only
 * where everything that could retain it was read: a file that could not be read
 * might retain anything, so the plan says media cannot be purged, and why,
 * rather than risk media something needs. It is not planned either where the
 * platform cannot coordinate windows, since a purge must keep every other
 * window from storing media while it runs (`cleanup-running.ts`).
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import type { CompactionPlan } from '@audiogubbins/history';
import {
  planCollection,
  type CollectionPlan,
  type MediaObjectStore,
} from '@audiogubbins/media-store';
import {
  Turns,
  type Digest,
  type StorageTree,
  type YieldToHost,
} from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { planBackupPruning } from './backup-planning.js';
import { CACHE_CLEANUP_ORDER, type CacheCategory, type CacheStore } from './cache-store.js';
import { CheckedRecords } from './checked-records.js';
import { expiredHistory } from './expired-history.js';
import { projectsIn } from './project-listing.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { ProjectFiles } from './project-files.js';
import { leftOverOf, type LeftOver } from './project-leftovers.js';
import { refusalsReported } from './storage-failures.js';
import { BACKUPS_DIRECTORY, BackupPaths, PROJECTS_DIRECTORY } from './storage-layout.js';
import { bytesUnder } from './usage-measurement.js';
import type { LeaseCoordinator } from './write-lease.js';

/** One kind of cleanup a person may choose. */
export type CleanupChoice =
  | { readonly kind: 'cache'; readonly category: CacheCategory }
  | { readonly kind: 'unfinished-projects' }
  | { readonly kind: 'expired-backups' }
  | { readonly kind: 'expired-history' }
  | { readonly kind: 'set-aside-records' }
  | { readonly kind: 'unreferenced-media' };

/** What a person chose to clean up: everything, or some of it. */
export type CleanupSelection = 'everything' | readonly CleanupChoice[];

/** What the person loses by a step, which the interface explains before they confirm. */
export type RecoverabilityLoss =
  /** Nothing: a cache is made again when it is needed. */
  | 'nothing'
  /**
   * Nothing a person kept: only projects whose making was cut short, and those
   * whose purge, which the person confirmed, was cut short.
   */
  | 'unfinished-projects'
  /** Restoring the project to the generations removed. */
  | 'backup-generations'
  /** The history each compaction removes, as each plan lists what it loses. */
  | 'history'
  /** Looking at the changes recovery set aside. */
  | 'set-aside-changes'
  /** The media itself, which nothing refers to, for good. */
  | 'unreferenced-media';

/** One step of a cleanup, what it would free, and what it would lose. */
export type CleanupStep = {
  readonly bytes: number;
  readonly loses: RecoverabilityLoss;
} & (
  | { readonly kind: 'cache'; readonly category: CacheCategory }
  | { readonly kind: 'unfinished-projects'; readonly projects: readonly ProjectId[] }
  | {
      readonly kind: 'expired-backups';
      readonly generations: ReadonlyMap<ProjectId, readonly number[]>;
    }
  | {
      readonly kind: 'expired-history';
      readonly compactions: ReadonlyMap<ProjectId, CompactionPlan>;
    }
  | { readonly kind: 'set-aside-records'; readonly projects: readonly ProjectId[] }
  | { readonly kind: 'unreferenced-media'; readonly collection: CollectionPlan }
);

/** Why media cannot be purged now. */
export type MediaPurgeRefusal =
  /** Something that could retain media cannot be read. */
  | { readonly kind: 'unreadable'; readonly roots: readonly UnreadableRoot[] }
  /** The platform cannot keep other windows from storing media while a purge runs. */
  | { readonly kind: 'no-coordination' }
  /** A window is storing media it has yet to refer to; the purge may be tried again. */
  | { readonly kind: 'storing' };

/** A cleanup planned: its steps in the safe order, and what confirming it means. */
export interface CleanupPlan {
  readonly steps: readonly CleanupStep[];

  /** The bytes the steps past the caches would free: what the person confirms. */
  readonly confirmationBytes: number;

  /** Why media cannot be purged, where it was chosen and cannot be. */
  readonly mediaRefused?: MediaPurgeRefusal;
}

/** What planning a cleanup works with. */
export interface CleanupServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;

  /** Asked through the passes over each project's history in memory. */
  readonly yieldToHost: YieldToHost;
}

const EVERY_CHOICE: readonly CleanupChoice[] = [
  ...CACHE_CLEANUP_ORDER.map((category) => ({ kind: 'cache', category }) as const),
  { kind: 'unfinished-projects' },
  { kind: 'expired-backups' },
  { kind: 'expired-history' },
  { kind: 'set-aside-records' },
  { kind: 'unreferenced-media' },
];

/** Whether a step removes only what is made again, and so needs no confirmation. */
export function isDisposable(step: CleanupStep): boolean {
  return step.loses === 'nothing';
}

/** Plans a cleanup of what was chosen, at `now` (see the module comment). */
export async function planCleanup(
  selection: CleanupSelection,
  services: CleanupServices,
  now: number,
  signal?: AbortSignal,
): Promise<DomainResult<CleanupPlan>> {
  return await refusalsReported(async () => {
    const chosen = selection === 'everything' ? EVERY_CHOICE : selection;
    const turns = new Turns(services.yieldToHost, signal);
    const records = new CheckedRecords(services.tree, services.digest);
    const steps: CleanupStep[] = [];
    const cacheUsage = await services.caches.usage(signal);
    if (!cacheUsage.ok) return cacheUsage;
    for (const category of CACHE_CLEANUP_ORDER) {
      const bytes = cacheUsage.value.get(category) ?? 0;
      if (
        bytes > 0 &&
        chosen.some((choice) => choice.kind === 'cache' && choice.category === category)
      ) {
        steps.push({ kind: 'cache', category, bytes, loses: 'nothing' });
      }
    }
    const has = (kind: CleanupChoice['kind']): boolean =>
      chosen.some((choice) => choice.kind === kind);
    if (has('unfinished-projects')) steps.push(...(await unfinishedProjects(records, signal)));
    if (has('expired-backups')) steps.push(...(await expiredBackups(records, now, signal)));
    if (has('expired-history'))
      steps.push(...historyStep(await expiredHistory(records, now, turns)));
    if (has('set-aside-records')) steps.push(...(await setAsideRecords(records, signal)));
    let mediaRefused: MediaPurgeRefusal | undefined;
    if (has('unreferenced-media')) {
      const media = await unreferencedMedia(services, signal);
      if (!media.ok) return media;
      if ('refused' in media.value) mediaRefused = media.value.refused;
      else if (media.value.step.bytes > 0) steps.push(media.value.step);
    }
    const confirmationBytes = steps
      .filter((step) => !isDisposable(step))
      .reduce((sum, step) => sum + step.bytes, 0);
    return succeed({
      steps,
      confirmationBytes,
      ...(mediaRefused === undefined ? {} : { mediaRefused }),
    });
  });
}

async function unfinishedProjects(
  records: CheckedRecords,
  signal?: AbortSignal,
): Promise<readonly CleanupStep[]> {
  const projects: ProjectId[] = [];
  let bytes = 0;
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const files = new ProjectFiles(records, project);
    const leftOver = await leftOverOf(files, signal);
    if (leftOver === undefined) continue;
    projects.push(project);
    bytes += await leftOverBytes(files, leftOver, signal);
  }
  return projects.length === 0
    ? []
    : [{ kind: 'unfinished-projects', projects, bytes, loses: 'unfinished-projects' }];
}

/**
 * The generations each project's retention no longer keeps, and those a crash
 * left incomplete. A project whose policy cannot be read keeps every whole one.
 */
async function expiredBackups(
  records: CheckedRecords,
  now: number,
  signal?: AbortSignal,
): Promise<readonly CleanupStep[]> {
  const generations = new Map<ProjectId, readonly number[]>();
  let bytes = 0;
  for (const project of await projectsIn(records.tree, BACKUPS_DIRECTORY)) {
    signal?.throwIfAborted();
    const listing = await new BackupGenerations(records.tree, records.digest, project).list(signal);
    if (!listing.ok) continue;
    const policy = await backupPolicyOf(new ProjectFiles(records, project), signal);
    const expired =
      policy?.kind === 'automatic'
        ? planBackupPruning(listing.value.generations, policy.retention, now).removed
        : [];
    const paths = new BackupPaths(project);
    const numbers = [...expired.map(({ number }) => number), ...listing.value.incomplete];
    if (numbers.length === 0) continue;
    generations.set(project, numbers);
    for (const number of numbers) {
      bytes += await bytesUnder(records.tree, paths.generation(number), signal);
    }
  }
  return generations.size === 0
    ? []
    : [{ kind: 'expired-backups', generations, bytes, loses: 'backup-generations' }];
}

/** The bytes what is left of a project holds, its backups among them where it is being purged. */
export async function leftOverBytes(
  files: ProjectFiles,
  leftOver: LeftOver,
  signal?: AbortSignal,
): Promise<number> {
  const tree = files.records.tree;
  const backups =
    leftOver === 'purging'
      ? await bytesUnder(tree, new BackupPaths(files.project).directory, signal)
      : 0;
  return backups + (await bytesUnder(tree, files.paths.directory, signal));
}

/** The step of history compactions, where any project lets history go. */
function historyStep(compactions: ReadonlyMap<ProjectId, CompactionPlan>): readonly CleanupStep[] {
  let bytes = 0;
  for (const plan of compactions.values()) bytes += plan.reclaimableBytes;
  return compactions.size === 0
    ? []
    : [{ kind: 'expired-history', compactions, bytes, loses: 'history' }];
}

/** A project's backup policy, as its newest checkpoint records it. */
async function backupPolicyOf(files: ProjectFiles, signal?: AbortSignal) {
  return (await files.newestCheckpoint(signal))?.backup;
}

async function setAsideRecords(
  records: CheckedRecords,
  signal?: AbortSignal,
): Promise<readonly CleanupStep[]> {
  const projects: ProjectId[] = [];
  let bytes = 0;
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const { quarantine } = new ProjectFiles(records, project).paths;
    const held = await bytesUnder(records.tree, quarantine, signal);
    if ((await records.tree.list(quarantine)).length === 0) continue;
    projects.push(project);
    bytes += held;
  }
  return projects.length === 0
    ? []
    : [{ kind: 'set-aside-records', projects, bytes, loses: 'set-aside-changes' }];
}

/** The media nothing refers to, or what kept the storage from being sure. */
async function unreferencedMedia(
  services: CleanupServices,
  signal?: AbortSignal,
): Promise<DomainResult<{ readonly step: CleanupStep } | { readonly refused: MediaPurgeRefusal }>> {
  if (services.coordinator === undefined) return succeed({ refused: { kind: 'no-coordination' } });
  const unreadable: UnreadableRoot[] = [];
  const roots = retainedMedia(
    services.tree,
    services.digest,
    (root) => unreadable.push(root),
    signal,
  );
  const collection = await planCollection(services.store, roots, signal);
  if (!collection.ok) return collection;
  if (unreadable.length > 0) {
    return succeed({ refused: { kind: 'unreadable', roots: unreadable } });
  }
  return succeed({
    step: {
      kind: 'unreferenced-media',
      collection: collection.value,
      bytes: collection.value.reclaimableBytes,
      loses: 'unreferenced-media',
    },
  });
}
