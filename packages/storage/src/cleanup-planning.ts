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
 * 2. Model pack downloads not finished: arriving, paused or left by a session
 *    cut short. Nothing unverified is ever used, so nothing is lost but the
 *    download's progress.
 * 3. Projects whose making was cut short, never finished and never listed, and
 *    projects whose purge was cut short, which the person confirmed.
 * 4. Installed model packs the person chose, one by one: the processors that
 *    need them cannot run until they are downloaded again. Every installed pack
 *    is listed for the choosing (`installedPacks`), and none is planned unless
 *    chosen, so no cleanup removes a pack of its own accord; a version a
 *    project needs (the installer's pins) is never planned, and the listing
 *    says why it is kept, as it does for every pack where the pins cannot be
 *    read.
 * 5. Backup generations each project's retention no longer keeps, and those a
 *    crash left incomplete: restoring to them is lost.
 * 6. History each project's retention policy lets go (`expired-history.ts`):
 *    the plan of each lists the undoing, branches and export states it loses.
 * 7. Journal records recovery set aside: what they held can no longer be looked
 *    at.
 * 8. Media nothing refers to: no project, history, snapshot, journal or backup
 *    holds it, and it is gone for good.
 *
 * Planning removes nothing. Every step past the caches and the partial
 * downloads reduces what can be recovered, or what can run without a download,
 * so carrying the plan out needs the person's confirmation of the bytes those
 * steps would free (`cleanup-running.ts`). Media is planned only where
 * everything that could retain it was read: a file that could not be read might
 * retain anything, so the plan says media cannot be purged, and why, rather
 * than risk media something needs. It is not planned either where the platform
 * cannot coordinate windows, since a purge must keep every other window from
 * storing media while it runs (`cleanup-running.ts`).
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import type { CompactionPlan } from '@audiogubbins/history';
import { planCollection, type MediaObjectStore } from '@audiogubbins/media-store';
import {
  Turns,
  type BackupPolicy,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { planBackupPruning } from './backup-planning.js';
import { CACHE_CLEANUP_ORDER, type CacheStore } from './cache-store.js';
import {
  isDisposable,
  type CleanupChoice,
  type CleanupPlan,
  type CleanupSelection,
  type CleanupStep,
  type MediaRefusal,
} from './cleanup-plan.js';
import { CheckedRecords } from './checked-records.js';
import { expiredHistory } from './expired-history.js';
import { projectsIn } from './project-listing.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import type { ModelPackStore } from './model-pack-store.js';
import { planPacks, type PackPins } from './pack-cleanup.js';
import { readProjectCopy } from './project-copy.js';
import { ProjectFiles } from './project-files.js';
import { leftOverOf, type LeftOver } from './project-leftovers.js';
import type { RecoveryServices } from './project-recovery.js';
import { refusalsReported } from './storage-failures.js';
import { BACKUPS_DIRECTORY, BackupPaths, PROJECTS_DIRECTORY } from './storage-layout.js';
import { bytesUnder } from './tree-bytes.js';
import type { LeaseCoordinator } from './write-lease.js';

/**
 * What planning a cleanup works with: what reading a project as recovery does,
 * which each project's policies are read by, its journal included, and the
 * stores.
 */
export interface CleanupServices extends RecoveryServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;
  readonly packs: ModelPackStore;
  readonly packPins: PackPins;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
}

/** Everything but installed model packs, which only the person's choosing plans. */
const EVERY_CHOICE: readonly CleanupChoice[] = [
  ...CACHE_CLEANUP_ORDER.map((category) => ({ kind: 'cache', category }) as const),
  { kind: 'pack-downloads' },
  { kind: 'unfinished-projects' },
  { kind: 'expired-backups' },
  { kind: 'expired-history' },
  { kind: 'set-aside-records' },
  { kind: 'unreferenced-media' },
];

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
    const caches = await cacheSteps(chosen, services.caches, signal);
    if (!caches.ok) return caches;
    steps.push(...caches.value);
    const has = (kind: CleanupChoice['kind']): boolean =>
      chosen.some((choice) => choice.kind === kind);
    const packs = await planPacks(
      services.packs,
      services.packPins,
      has('pack-downloads'),
      chosen.flatMap((choice) => (choice.kind === 'model-packs' ? choice.packs : [])),
      signal,
    );
    if (!packs.ok) return packs;
    if (packs.value.downloads !== undefined) steps.push(packs.value.downloads);
    if (has('unfinished-projects')) steps.push(...(await unfinishedProjects(records, signal)));
    if (packs.value.chosen !== undefined) steps.push(packs.value.chosen);
    if (has('expired-backups')) {
      steps.push(...(await expiredBackups(records, services, now, signal)));
    }
    if (has('expired-history')) {
      steps.push(...historyStep(await expiredHistory(records, services, now, turns)));
    }
    if (has('set-aside-records')) steps.push(...(await setAsideRecords(records, signal)));
    let mediaRefused: MediaRefusal | undefined;
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
      installedPacks: packs.value.installed,
      ...(mediaRefused === undefined ? {} : { mediaRefused }),
    });
  });
}

/** The step of each cache chosen that holds anything, in the order caches are given up. */
async function cacheSteps(
  chosen: readonly CleanupChoice[],
  caches: CacheStore,
  signal?: AbortSignal,
): Promise<DomainResult<readonly CleanupStep[]>> {
  const usage = await caches.usage(signal);
  if (!usage.ok) return usage;
  return succeed(
    CACHE_CLEANUP_ORDER.flatMap((category): CleanupStep[] => {
      const bytes = usage.value.get(category) ?? 0;
      const wanted = chosen.some(
        (choice) => choice.kind === 'cache' && choice.category === category,
      );
      return bytes > 0 && wanted ? [{ kind: 'cache', category, bytes, loses: 'nothing' }] : [];
    }),
  );
}

async function unfinishedProjects(
  records: CheckedRecords,
  signal?: AbortSignal,
): Promise<readonly CleanupStep[]> {
  const projects = new Map<ProjectId, LeftOver>();
  let bytes = 0;
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const files = new ProjectFiles(records, project);
    const leftOver = await leftOverOf(files, signal);
    if (leftOver === undefined) continue;
    projects.set(project, leftOver);
    bytes += await leftOverBytes(files, leftOver, signal);
  }
  return projects.size === 0
    ? []
    : [{ kind: 'unfinished-projects', projects, bytes, loses: 'unfinished-projects' }];
}

/**
 * The generations each project's retention no longer keeps, under the policy
 * it holds now, and those a crash left incomplete. A project whose policy
 * cannot be read keeps every whole one.
 */
async function expiredBackups(
  records: CheckedRecords,
  services: RecoveryServices,
  now: number,
  signal?: AbortSignal,
): Promise<readonly CleanupStep[]> {
  const generations = new Map<ProjectId, readonly number[]>();
  let bytes = 0;
  for (const project of await projectsIn(records.tree, BACKUPS_DIRECTORY)) {
    signal?.throwIfAborted();
    const numbers = await removableGenerations(project, records, services, now, signal);
    if (numbers.length === 0) continue;
    generations.set(project, numbers);
    const paths = new BackupPaths(project);
    for (const number of numbers) {
      bytes += await bytesUnder(records.tree, paths.generation(number), signal);
    }
  }
  return generations.size === 0
    ? []
    : [{ kind: 'expired-backups', generations, at: now, bytes, loses: 'backup-generations' }];
}

/**
 * The numbers of a project's generations its retention, under the policy it
 * holds now, does not keep at `at`, and of those incomplete: being written, or
 * left so by a crash.
 */
export async function removableGenerations(
  project: ProjectId,
  records: CheckedRecords,
  services: RecoveryServices,
  at: number,
  signal?: AbortSignal,
): Promise<readonly number[]> {
  const listing = await new BackupGenerations(records.tree, records.digest, project).list(signal);
  if (!listing.ok) return [];
  const policy = await backupPolicyOf(new ProjectFiles(records, project), services, signal);
  const expired =
    policy?.kind === 'automatic'
      ? planBackupPruning(listing.value.generations, policy.retention, at).removed
      : [];
  return [...expired.map(({ number }) => number), ...listing.value.incomplete];
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

/**
 * A project's backup policy as recovery reads it, its journal included, or
 * `undefined` where the project cannot be read whole.
 */
async function backupPolicyOf(
  files: ProjectFiles,
  services: RecoveryServices,
  signal?: AbortSignal,
): Promise<BackupPolicy | undefined> {
  const copy = await readProjectCopy(files, services, signal);
  return copy.ok ? copy.value.model.backup : undefined;
}

async function setAsideRecords(
  records: CheckedRecords,
  signal?: AbortSignal,
): Promise<readonly CleanupStep[]> {
  const setAside = new Map<ProjectId, readonly string[]>();
  let bytes = 0;
  for (const project of await projectsIn(records.tree, PROJECTS_DIRECTORY)) {
    signal?.throwIfAborted();
    const { quarantine } = new ProjectFiles(records, project).paths;
    const names: string[] = [];
    for (const entry of await records.tree.list(quarantine)) {
      if (entry.kind !== 'file') continue;
      names.push(entry.name);
      bytes += (await records.tree.openFile(`${quarantine}/${entry.name}`))?.size ?? 0;
    }
    if (names.length > 0) setAside.set(project, names);
  }
  return setAside.size === 0
    ? []
    : [{ kind: 'set-aside-records', records: setAside, bytes, loses: 'set-aside-changes' }];
}

/** The media nothing refers to, or what kept the storage from being sure. */
async function unreferencedMedia(
  services: CleanupServices,
  signal?: AbortSignal,
): Promise<DomainResult<{ readonly step: CleanupStep } | { readonly refused: MediaRefusal }>> {
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
