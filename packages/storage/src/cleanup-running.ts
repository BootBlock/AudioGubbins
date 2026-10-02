/**
 * Carrying a cleanup out, and relieving storage pressure, which may give up
 * caches alone (REQ-STOR-106, REQ-STOR-102, REQ-STOR-027).
 *
 * A plan with any step past the caches is carried out only with the person's
 * confirmation of the bytes those steps would free, as the plan showed them;
 * without it nothing at all is removed. Each step is checked again as it runs,
 * against storage as it is by then: a project is changed only under its write
 * lease, and one another window holds is passed over and reported, while the
 * project this window writes is changed under the lease its own session holds,
 * and its history compacted through that session; a generation protected since
 * the plan was made is kept; a history is compacted through a session of its
 * project, and only where its plan still fits; and media is removed only where
 * it is still unreachable from roots gathered afresh and read whole, under the
 * storage-wide lock held alone, so no window stores media meanwhile that
 * nothing yet refers to (`media-sharing.ts`). Where that lock cannot be had,
 * because a window is storing media or the platform cannot coordinate windows,
 * no media is removed, and the outcome says why. Relieving pressure touches the
 * caches alone, in the order they are given up, and stops once enough is freed:
 * authoritative state, history, backups and source media are never removed
 * without the person.
 */

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import { collect } from '@audiogubbins/media-store';
import type { ContentId } from '@audiogubbins/project-format';

import { BackupGenerations } from './backup-generations.js';
import { CACHE_CLEANUP_ORDER, type CacheCategory, type CacheStore } from './cache-store.js';
import { CheckedRecords } from './checked-records.js';
import {
  isDisposable,
  leftOverBytes,
  type CleanupPlan,
  type CleanupServices,
  type CleanupStep,
  type MediaPurgeRefusal,
} from './cleanup-planning.js';
import { compactExpiredHistory } from './expired-history.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { ProjectFiles } from './project-files.js';
import { leftOverOf, removeLeftOver } from './project-leftovers.js';
import { noCoordination, refusalsReported } from './storage-failures.js';
import type { OpeningServices } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { bytesUnder } from './usage-measurement.js';
import type { LeaseCoordinator } from './write-lease.js';

/** How a cleanup is carried out in the window that runs it. */
export interface CleanupRunOptions {
  /**
   * The session of the project this window writes, whose steps run under the
   * lease it holds and whose history is compacted through it: asking for a
   * lease of its own would find the project held, by this very window.
   */
  readonly held?: ProjectSession;
  readonly signal?: AbortSignal;
}

/** The person's confirmation of a plan: the bytes they were shown it would free past the caches. */
export interface CleanupConfirmation {
  readonly bytes: number;
}

/**
 * What carrying a cleanup out works with, each made once by the composition
 * root: what planning works with, and what opening a project to compact its
 * history does.
 */
export interface CleanupRunServices extends CleanupServices, OpeningServices {
  readonly coordinator?: LeaseCoordinator;
}

/** What one step did. */
export interface StepOutcome {
  readonly step: CleanupStep['kind'];
  readonly freed: number;

  /** The projects passed over because another window holds them. */
  readonly busy: readonly ProjectId[];

  /** The projects whose history had moved on from its plan, left as they were. */
  readonly unapplied?: readonly ProjectId[];

  /** Why media was kept after all. */
  readonly refused?: MediaPurgeRefusal;
}

/** Carries a cleanup out (see the module comment). */
export async function runCleanup(
  plan: CleanupPlan,
  confirmation: CleanupConfirmation | undefined,
  services: CleanupRunServices,
  options: CleanupRunOptions = {},
): Promise<DomainResult<readonly StepOutcome[]>> {
  const { signal } = options;
  const reducesRecoverability = plan.steps.some((step) => !isDisposable(step));
  if (reducesRecoverability && confirmation?.bytes !== plan.confirmationBytes) {
    return fail(
      failure(
        'storage.cleanup-unconfirmed',
        FailureKind.Rejected,
        'The cleanup removes what cannot be made again, and was not confirmed as it was shown.',
      ),
    );
  }
  return await refusalsReported(async () => {
    const outcomes: StepOutcome[] = [];
    for (const step of plan.steps) {
      signal?.throwIfAborted();
      const outcome = await runStep(step, services, options);
      if (!outcome.ok) return outcome;
      outcomes.push(outcome.value);
    }
    return succeed(outcomes);
  });
}

async function runStep(
  step: CleanupStep,
  services: CleanupRunServices,
  options: CleanupRunOptions,
): Promise<DomainResult<StepOutcome>> {
  const { held, signal } = options;
  const records = new CheckedRecords(services.tree, services.digest);
  switch (step.kind) {
    case 'cache': {
      const freed = await services.caches.evictCategory(step.category, signal);
      return freed.ok ? succeed({ step: step.kind, freed: freed.value, busy: [] }) : freed;
    }
    case 'unfinished-projects':
      return await eachHeld(step, step.projects, services, options, async (project) => {
        const files = new ProjectFiles(records, project);
        const leftOver = await leftOverOf(files, signal);
        if (leftOver === undefined) return 0;
        const bytes = await leftOverBytes(files, leftOver, signal);
        await removeLeftOver(files, leftOver);
        return bytes;
      });
    case 'expired-backups':
      return await eachHeld(step, [...step.generations.keys()], services, options, (project) =>
        expiredGenerationsRemoved(project, step.generations, services, signal),
      );
    case 'expired-history': {
      const compacted = await compactExpiredHistory(step.compactions, services, held, signal);
      return mapResult(compacted, ({ freed, busy, unapplied }) => ({
        step: step.kind,
        freed,
        busy,
        unapplied,
      }));
    }
    case 'set-aside-records':
      return await eachHeld(step, step.projects, services, options, async (project) => {
        const files = new ProjectFiles(records, project);
        return await removedBytes(services, files.paths.quarantine, signal);
      });
    case 'unreferenced-media':
      return await purgedMedia(step, services, signal);
  }
}

/**
 * Removes a project's planned generations that are still unprotected and not
 * manual, giving the bytes they held.
 */
async function expiredGenerationsRemoved(
  project: ProjectId,
  planned: ReadonlyMap<ProjectId, readonly number[]>,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<number> {
  const generations = new BackupGenerations(services.tree, services.digest, project);
  const listing = await generations.list(signal);
  if (!listing.ok) return 0;
  const numbers = new Set(planned.get(project));
  const guarded = new Set(
    listing.value.generations
      .filter((generation) => generation.protected)
      .map(({ number }) => number),
  );
  const removed = [...numbers].filter((number) => !guarded.has(number));
  const freed = listing.value.generations
    .filter(({ number }) => removed.includes(number))
    .reduce((sum, generation) => sum + generation.bytes, 0);
  const done = await generations.remove(removed, signal);
  return done.ok ? freed : 0;
}

/**
 * Runs `work` on each project under its write lease, passing over, and
 * reporting, each another window holds; the project of `held` runs under the
 * lease its session holds while it still writes. `work` gives the bytes it
 * freed. The run is given up between two projects.
 */
async function eachHeld(
  step: CleanupStep,
  projects: readonly ProjectId[],
  services: CleanupRunServices,
  { held, signal }: CleanupRunOptions,
  work: (project: ProjectId) => Promise<number>,
): Promise<DomainResult<StepOutcome>> {
  const { coordinator, owner } = services;
  if (coordinator === undefined) return fail(noCoordination());
  const busy: ProjectId[] = [];
  let freed = 0;
  for (const project of projects) {
    signal?.throwIfAborted();
    if (held?.project === project) {
      if (writes(held)) freed += await work(project);
      else busy.push(project);
      continue;
    }
    const acquired = await coordinator.acquire(project, { steal: false, owner });
    if (acquired.kind === 'unavailable') return fail(noCoordination());
    if (acquired.kind === 'busy') {
      busy.push(project);
      continue;
    }
    try {
      freed += await work(project);
    } finally {
      await acquired.lease.release();
    }
  }
  return succeed({ step: step.kind, freed, busy });
}

/** Whether a session still holds its project's write lease. */
function writes(session: ProjectSession): boolean {
  return session.getSnapshot().access.kind === 'writable';
}

/** Removes a directory once its bytes are counted, given up only before the removal. */
async function removedBytes(
  services: CleanupRunServices,
  directory: string,
  signal?: AbortSignal,
): Promise<number> {
  const bytes = await bytesUnder(services.tree, directory, signal);
  await services.tree.remove(directory);
  return bytes;
}

/**
 * Purges the planned media still unreachable from roots gathered afresh, and
 * none where anything that could retain media cannot be read.
 */
async function purgedMedia(
  step: Extract<CleanupStep, { kind: 'unreferenced-media' }>,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<DomainResult<StepOutcome>> {
  const refused = (reason: MediaPurgeRefusal): DomainResult<StepOutcome> =>
    succeed({ step: step.kind, freed: 0, busy: [], refused: reason });
  const { coordinator } = services;
  if (coordinator === undefined) return refused({ kind: 'no-coordination' });
  const lock = await coordinator.lockStorage('exclusive', {
    wait: false,
    ...(signal === undefined ? {} : { signal }),
  });
  if (lock.kind === 'unavailable') return refused({ kind: 'no-coordination' });
  if (lock.kind === 'busy') return refused({ kind: 'storing' });
  try {
    return await collectedUnderLock(step, services, signal);
  } finally {
    await lock.release();
  }
}

/** Collects what is still unreachable, while no window stores media. */
async function collectedUnderLock(
  step: Extract<CleanupStep, { kind: 'unreferenced-media' }>,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<DomainResult<StepOutcome>> {
  const unreadable: UnreadableRoot[] = [];
  const roots: ContentId[] = [];
  for await (const root of retainedMedia(
    services.tree,
    services.digest,
    (problem) => {
      unreadable.push(problem);
    },
    signal,
  )) {
    roots.push(root);
  }
  if (unreadable.length > 0) {
    return succeed({
      step: step.kind,
      freed: 0,
      busy: [],
      refused: { kind: 'unreadable', roots: unreadable },
    });
  }
  const collected = await collect(
    services.store,
    step.collection,
    { reclaimableBytes: step.collection.reclaimableBytes },
    roots,
    signal,
  );
  return collected.ok
    ? succeed({ step: step.kind, freed: collected.value.reclaimedBytes, busy: [] })
    : collected;
}

/** What relieving storage pressure freed, category by category. */
export interface PressureRelief {
  readonly freed: ReadonlyMap<CacheCategory, number>;
  readonly total: number;
}

/**
 * Gives up caches in the order they go under pressure until `wanted` bytes are
 * freed, or every cache where no amount is named. Only caches: nothing that
 * cannot be made again is touched without the person.
 */
export async function relieveStoragePressure(
  caches: CacheStore,
  wanted: number = Number.POSITIVE_INFINITY,
  signal?: AbortSignal,
): Promise<DomainResult<PressureRelief>> {
  const freed = new Map<CacheCategory, number>();
  let total = 0;
  for (const category of CACHE_CLEANUP_ORDER) {
    if (total >= wanted) break;
    const evicted = await caches.evictCategory(category, signal);
    if (!evicted.ok) return evicted;
    freed.set(category, evicted.value);
    total += evicted.value;
  }
  return succeed({ freed, total });
}
