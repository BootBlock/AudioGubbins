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
 * 2. Projects whose making was cut short: never finished, never listed.
 * 3. Backup generations each project's retention no longer keeps, and those a
 *    crash left incomplete: restoring to them is lost.
 * 4. Journal records recovery set aside: what they held can no longer be looked
 *    at.
 * 5. Media nothing refers to: no project, history, snapshot, journal or backup
 *    holds it, and it is gone for good.
 *
 * Planning removes nothing. Every step past the caches reduces what can be
 * recovered, so carrying the plan out needs the person's confirmation of the
 * bytes those steps would free (`cleanup-running.ts`). Media is planned only
 * where everything that could retain it was read: a file that could not be read
 * might retain anything, so the plan says media cannot be purged, and why,
 * rather than risk media something needs.
 */

import {
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  planCollection,
  type CollectionPlan,
  type MediaObjectStore,
} from '@audiogubbins/media-store';
import type { Digest, StorageTree } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { planBackupPruning } from './backup-planning.js';
import { CACHE_CLEANUP_ORDER, type CacheCategory, type CacheStore } from './cache-store.js';
import { CheckedRecords } from './checked-records.js';
import { readPair } from './generational-pair.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { ProjectFiles } from './project-files.js';
import { refusalsReported } from './storage-failures.js';
import { BACKUPS_DIRECTORY, BackupPaths, PROJECTS_DIRECTORY } from './storage-layout.js';
import { bytesUnder } from './usage-measurement.js';

/** One kind of cleanup a person may choose. */
export type CleanupChoice =
  | { readonly kind: 'cache'; readonly category: CacheCategory }
  | { readonly kind: 'unfinished-projects' }
  | { readonly kind: 'expired-backups' }
  | { readonly kind: 'set-aside-records' }
  | { readonly kind: 'unreferenced-media' };

/** What a person chose to clean up: everything, or some of it. */
export type CleanupSelection = 'everything' | readonly CleanupChoice[];

/** What the person loses by a step, which the interface explains before they confirm. */
export type RecoverabilityLoss =
  /** Nothing: a cache is made again when it is needed. */
  | 'nothing'
  /** Nothing a person finished: only projects whose making was cut short. */
  | 'unfinished-projects'
  /** Restoring the project to the generations removed. */
  | 'backup-generations'
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
  | { readonly kind: 'set-aside-records'; readonly projects: readonly ProjectId[] }
  | { readonly kind: 'unreferenced-media'; readonly collection: CollectionPlan }
);

/** A cleanup planned: its steps in the safe order, and what confirming it means. */
export interface CleanupPlan {
  readonly steps: readonly CleanupStep[];

  /** The bytes the steps past the caches would free: what the person confirms. */
  readonly confirmationBytes: number;

  /** Why media cannot be purged, where it was chosen and cannot be. */
  readonly mediaBlockedBy?: readonly UnreadableRoot[];
}

/** What planning a cleanup works with. */
export interface CleanupServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;
}

const EVERY_CHOICE: readonly CleanupChoice[] = [
  ...CACHE_CLEANUP_ORDER.map((category) => ({ kind: 'cache', category }) as const),
  { kind: 'unfinished-projects' },
  { kind: 'expired-backups' },
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
    if (has('unfinished-projects')) steps.push(...(await unfinishedProjects(records)));
    if (has('expired-backups')) steps.push(...(await expiredBackups(records, now, signal)));
    if (has('set-aside-records')) steps.push(...(await setAsideRecords(records)));
    let mediaBlockedBy: readonly UnreadableRoot[] | undefined;
    if (has('unreferenced-media')) {
      const media = await unreferencedMedia(services, signal);
      if (!media.ok) return media;
      if ('blockedBy' in media.value) mediaBlockedBy = media.value.blockedBy;
      else if (media.value.step.bytes > 0) steps.push(media.value.step);
    }
    const confirmationBytes = steps
      .filter((step) => !isDisposable(step))
      .reduce((sum, step) => sum + step.bytes, 0);
    return succeed({
      steps,
      confirmationBytes,
      ...(mediaBlockedBy === undefined ? {} : { mediaBlockedBy }),
    });
  });
}

/** Every project directory under `directory`, by identifier. */
async function projectsIn(tree: StorageTree, directory: string): Promise<readonly ProjectId[]> {
  return (await tree.list(directory)).flatMap((entry) =>
    entry.kind === 'directory' && isWellFormedId(entry.name)
      ? [unsafeBrandId<'ProjectId'>(entry.name)]
      : [],
  );
}

async function unfinishedProjects(records: CheckedRecords): Promise<readonly CleanupStep[]> {
  const projects: ProjectId[] = [];
  let bytes = 0;
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    const files = new ProjectFiles(records, project);
    if ((await readPair(records, files.header)).valid.length > 0 || !(await files.isUnfinished())) {
      continue;
    }
    projects.push(project);
    bytes += await bytesUnder(records.tree, files.paths.directory);
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
    for (const number of numbers) bytes += await bytesUnder(records.tree, paths.generation(number));
  }
  return generations.size === 0
    ? []
    : [{ kind: 'expired-backups', generations, bytes, loses: 'backup-generations' }];
}

/** A project's backup policy, as its newest checkpoint records it. */
async function backupPolicyOf(files: ProjectFiles, signal?: AbortSignal) {
  const head = (await readPair(files.records, files.heads, signal)).valid[0];
  if (head === undefined) return undefined;
  const checkpoint = await files.readCheckpoint(head.value.checkpoint, signal);
  return checkpoint.kind === 'valid' ? checkpoint.value.backup : undefined;
}

async function setAsideRecords(records: CheckedRecords): Promise<readonly CleanupStep[]> {
  const projects: ProjectId[] = [];
  let bytes = 0;
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    const { quarantine } = new ProjectFiles(records, project).paths;
    const held = await bytesUnder(records.tree, quarantine);
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
): Promise<
  DomainResult<{ readonly step: CleanupStep } | { readonly blockedBy: readonly UnreadableRoot[] }>
> {
  const unreadable: UnreadableRoot[] = [];
  const roots = retainedMedia(
    services.tree,
    services.digest,
    (root) => unreadable.push(root),
    signal,
  );
  const collection = await planCollection(services.store, roots, signal);
  if (!collection.ok) return collection;
  if (unreadable.length > 0) return succeed({ blockedBy: unreadable });
  return succeed({
    step: {
      kind: 'unreferenced-media',
      collection: collection.value,
      bytes: collection.value.reclaimableBytes,
      loses: 'unreferenced-media',
    },
  });
}
