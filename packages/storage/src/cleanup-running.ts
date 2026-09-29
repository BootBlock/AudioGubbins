/**
 * Carrying a cleanup out, and relieving storage pressure, which may give up
 * caches alone (REQ-STOR-106, REQ-STOR-102, REQ-STOR-027).
 *
 * A plan with any step past the caches is carried out only with the person's
 * confirmation of the bytes those steps would free, as the plan showed them;
 * without it nothing at all is removed. Each step is checked again as it runs,
 * against storage as it is by then: a project is changed only under its write
 * lease, and one another window holds is passed over and reported; a generation
 * protected since the plan was made is kept; and media is removed only where it
 * is still unreachable from roots gathered afresh and read whole. Relieving
 * pressure touches the caches alone, in the order they are given up, and stops
 * once enough is freed: authoritative state, history, backups and source media
 * are never removed without the person.
 */

import {
  FailureKind,
  fail,
  failure,
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
  type CleanupPlan,
  type CleanupServices,
  type CleanupStep,
} from './cleanup-planning.js';
import { readPair } from './generational-pair.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { ProjectFiles } from './project-files.js';
import { noCoordination, refusalsReported } from './storage-failures.js';
import { bytesUnder } from './usage-measurement.js';
import type { LeaseCoordinator, LeaseOwner } from './write-lease.js';

/** The person's confirmation of a plan: the bytes they were shown it would free past the caches. */
export interface CleanupConfirmation {
  readonly bytes: number;
}

/** What carrying a cleanup out works with, each made once by the composition root. */
export interface CleanupRunServices extends CleanupServices {
  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
  readonly owner: LeaseOwner;
}

/** What one step did. */
export interface StepOutcome {
  readonly step: CleanupStep['kind'];
  readonly freed: number;

  /** The projects passed over because another window holds them. */
  readonly busy: readonly ProjectId[];

  /** Where media was kept after all because something could not be read. */
  readonly blockedBy?: readonly UnreadableRoot[];
}

/** Carries a cleanup out (see the module comment). */
export async function runCleanup(
  plan: CleanupPlan,
  confirmation: CleanupConfirmation | undefined,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<DomainResult<readonly StepOutcome[]>> {
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
      const outcome = await runStep(step, services, signal);
      if (!outcome.ok) return outcome;
      outcomes.push(outcome.value);
    }
    return succeed(outcomes);
  });
}

async function runStep(
  step: CleanupStep,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<DomainResult<StepOutcome>> {
  const records = new CheckedRecords(services.tree, services.digest);
  switch (step.kind) {
    case 'cache': {
      const freed = await services.caches.evictCategory(step.category, signal);
      return freed.ok ? succeed({ step: step.kind, freed: freed.value, busy: [] }) : freed;
    }
    case 'unfinished-projects':
      return await eachHeld(step, step.projects, services, async (project) => {
        const files = new ProjectFiles(records, project);
        const header = await readPair(records, files.header);
        if (header.valid.length > 0 || !(await files.isUnfinished())) return 0;
        return await removedBytes(services, files.paths.directory);
      });
    case 'expired-backups':
      return await eachHeld(step, [...step.generations.keys()], services, async (project) => {
        const generations = new BackupGenerations(services.tree, services.digest, project);
        const listing = await generations.list(signal);
        if (!listing.ok) return 0;
        const planned = new Set(step.generations.get(project));
        const guarded = new Set(
          listing.value.generations
            .filter((generation) => generation.protected || generation.reason === 'manual')
            .map(({ number }) => number),
        );
        const removed = [...planned].filter((number) => !guarded.has(number));
        const freed = listing.value.generations
          .filter(({ number }) => removed.includes(number))
          .reduce((sum, generation) => sum + generation.bytes, 0);
        const done = await generations.remove(removed, signal);
        return done.ok ? freed : 0;
      });
    case 'set-aside-records':
      return await eachHeld(step, step.projects, services, async (project) => {
        const files = new ProjectFiles(records, project);
        return await removedBytes(services, files.paths.quarantine);
      });
    case 'unreferenced-media':
      return await purgedMedia(step, services, signal);
  }
}

/**
 * Runs `work` on each project under its write lease, passing over, and
 * reporting, each another window holds. `work` gives the bytes it freed.
 */
async function eachHeld(
  step: CleanupStep,
  projects: readonly ProjectId[],
  services: CleanupRunServices,
  work: (project: ProjectId) => Promise<number>,
): Promise<DomainResult<StepOutcome>> {
  const { coordinator, owner } = services;
  if (coordinator === undefined) return fail(noCoordination());
  const busy: ProjectId[] = [];
  let freed = 0;
  for (const project of projects) {
    const acquired = await coordinator.acquire(project, { steal: false, owner });
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

async function removedBytes(services: CleanupRunServices, directory: string): Promise<number> {
  const bytes = await bytesUnder(services.tree, directory);
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
    return succeed({ step: step.kind, freed: 0, busy: [], blockedBy: unreadable });
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
