/**
 * Carrying a cleanup out (REQ-STOR-106, REQ-STOR-102, REQ-STOR-027).
 *
 * A plan with any step past the caches and the partial downloads is carried out
 * only with the person's confirmation of the bytes those steps would free, as
 * the plan showed them; without it nothing at all is removed. Each step is
 * checked again as it runs, against storage as it is by then: a project is
 * changed only under its write lease, and one another window holds is passed
 * over and reported, while the project this window writes is changed under the
 * lease its own session holds, and its history compacted through that session.
 * Only what the plan showed is removed, and only where it still is what the
 * plan found: a project left over as the plan found it; a generation the
 * retention, under the policy the project holds by then, still does not keep at
 * the moment the plan judged, or one still incomplete; the records set aside
 * that the plan listed, not those set aside since; a history compacted through
 * a session of its project, and only where its plan still fits; media still
 * unreachable from roots gathered afresh and read whole; a model pack download
 * the plan listed that is still not installed; and an installed pack the person
 * chose that is still installed, and that no project has come to need by then,
 * as the pins are read again. A project being made, a generation being written,
 * media being stored and a pack being downloaded each look left over until they
 * are whole, so the steps that remove left-overs run with the storage-wide lock
 * held alone, which every such writer shares while it writes
 * (`storage-sharing.ts`). Where that lock cannot be had now, because a window
 * is writing, the step removes nothing and its outcome says why; where the
 * platform cannot coordinate windows, media is kept and says so, and the other
 * steps are refused, as every step that needs a project's lease is.
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
import type { PackInstaller } from '@audiogubbins/model-packs';

import { BackupGenerations } from './backup-generations.js';
import { CheckedRecords } from './checked-records.js';
import {
  isDisposable,
  type CleanupPlan,
  type CleanupRefusal,
  type CleanupStep,
} from './cleanup-plan.js';
import { leftOverBytes, removableGenerations, type CleanupServices } from './cleanup-planning.js';
import { compactExpiredHistory } from './expired-history.js';
import { removeChosenPacks, removePartialPacks, type ChosenRemoval } from './pack-cleanup.js';
import { purgeMedia } from './media-purging.js';
import { ProjectFiles } from './project-files.js';
import { leftOverOf, removeLeftOver, type LeftOver } from './project-leftovers.js';
import { noCoordination, refusalsReported } from './storage-failures.js';
import { BackupPaths } from './storage-layout.js';
import { whileAlone } from './storage-sharing.js';
import type { OpeningServices } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { bytesUnder } from './tree-bytes.js';
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

  /** The installer every removal of a model pack goes through (`pack-cleanup.ts`). */
  readonly packInstaller: PackInstaller;
}

/** What one step did. */
export interface StepOutcome {
  readonly step: CleanupStep['kind'];
  readonly freed: number;

  /** The projects passed over because another window holds them. */
  readonly busy: readonly ProjectId[];

  /** The projects whose history had moved on from its plan, left as they were. */
  readonly unapplied?: readonly ProjectId[];

  /** The model packs chosen that a project came to need after the plan, kept. */
  readonly needed?: NonNullable<ChosenRemoval['needed']>;

  /** Why the step removed nothing after all. */
  readonly refused?: CleanupRefusal;
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
      const evicted = await services.caches.evictCategory(step.category, signal);
      return outcomeOf(
        step.kind,
        mapResult(evicted, (freed) => ({ freed })),
      );
    }
    case 'pack-downloads':
    case 'model-packs':
      return await packsRemoved(step, services, signal);
    case 'unfinished-projects':
      return await aloneFor(
        step,
        services,
        signal,
        async () =>
          await eachHeld(step, [...step.projects.keys()], services, options, (project) =>
            leftOverRemoved(new ProjectFiles(records, project), step.projects, signal),
          ),
      );
    case 'expired-backups':
      return await aloneFor(
        step,
        services,
        signal,
        async () =>
          await eachHeld(step, [...step.generations.keys()], services, options, (project) =>
            expiredGenerationsRemoved(project, step, services, signal),
          ),
      );
    case 'expired-history':
      return outcomeOf(
        step.kind,
        await compactExpiredHistory(step.compactions, services, held, signal),
      );
    case 'set-aside-records':
      return await eachHeld(step, [...step.records.keys()], services, options, (project) =>
        setAsideRemoved(new ProjectFiles(records, project), step.records, signal),
      );
    case 'unreferenced-media':
      return outcomeOf(step.kind, await purgeMedia(step.collection, services, signal));
  }
}

/** A step's outcome from what its work came to: no project passed over unless it says so. */
function outcomeOf(
  step: CleanupStep['kind'],
  done: DomainResult<Omit<StepOutcome, 'step' | 'busy'> & Partial<Pick<StepOutcome, 'busy'>>>,
): DomainResult<StepOutcome> {
  return mapResult(done, (value) => ({ step, busy: [], ...value }));
}

/**
 * Removes the packs a step planned: downloads not finished with the
 * storage-wide lock held alone, so none is being written, and the installed
 * packs the person chose as `pack-cleanup.ts` checks them again.
 */
async function packsRemoved(
  step: Extract<CleanupStep, { kind: 'pack-downloads' | 'model-packs' }>,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<DomainResult<StepOutcome>> {
  if (step.kind === 'model-packs') {
    const removed = await removeChosenPacks(
      step.packs,
      services.packs,
      services.packInstaller,
      services.packPins,
      signal,
    );
    return outcomeOf(step.kind, removed);
  }
  return await aloneFor(step, services, signal, async () => {
    const removed = await removePartialPacks(
      step.packs,
      services.packs,
      services.packInstaller,
      signal,
    );
    return outcomeOf(
      step.kind,
      mapResult(removed, (freed) => ({ freed })),
    );
  });
}

/**
 * Removes what a crash left of a project, where it is still what the plan
 * found, giving the bytes it held.
 */
async function leftOverRemoved(
  files: ProjectFiles,
  planned: ReadonlyMap<ProjectId, LeftOver>,
  signal?: AbortSignal,
): Promise<number> {
  const leftOver = await leftOverOf(files, signal);
  if (leftOver === undefined || leftOver !== planned.get(files.project)) return 0;
  const bytes = await leftOverBytes(files, leftOver, signal);
  await removeLeftOver(files, leftOver);
  return bytes;
}

/**
 * Removes the records of a project the plan found set aside, and none set
 * aside since, giving the bytes they held.
 */
async function setAsideRemoved(
  files: ProjectFiles,
  planned: ReadonlyMap<ProjectId, readonly string[]>,
  signal?: AbortSignal,
): Promise<number> {
  const { tree } = files.records;
  let freed = 0;
  for (const name of planned.get(files.project) ?? []) {
    signal?.throwIfAborted();
    const path = `${files.paths.quarantine}/${name}`;
    freed += (await tree.openFile(path))?.size ?? 0;
    await tree.remove(path);
  }
  return freed;
}

/**
 * Runs a step that removes left-overs with the storage-wide lock held alone,
 * or says why it removed nothing (see the module comment).
 */
async function aloneFor(
  step: CleanupStep,
  services: CleanupRunServices,
  signal: AbortSignal | undefined,
  work: () => Promise<DomainResult<StepOutcome>>,
): Promise<DomainResult<StepOutcome>> {
  const alone = await whileAlone(services.coordinator, work, signal);
  switch (alone.kind) {
    case 'done':
      return alone.value;
    case 'busy':
      return succeed({ step: step.kind, freed: 0, busy: [], refused: { kind: 'storing' } });
    case 'unavailable':
      return fail(noCoordination());
  }
}

/**
 * Removes those of a project's planned generations its retention still does
 * not keep at the moment the plan judged, under the policy it holds now, or
 * that are still incomplete, giving the bytes they held.
 */
async function expiredGenerationsRemoved(
  project: ProjectId,
  step: Extract<CleanupStep, { kind: 'expired-backups' }>,
  services: CleanupRunServices,
  signal?: AbortSignal,
): Promise<number> {
  const records = new CheckedRecords(services.tree, services.digest);
  const removable = new Set(
    await removableGenerations(project, records, services, step.at, signal),
  );
  const removed = (step.generations.get(project) ?? []).filter((number) => removable.has(number));
  const paths = new BackupPaths(project);
  let freed = 0;
  for (const number of removed) {
    freed += await bytesUnder(services.tree, paths.generation(number), signal);
  }
  const generations = new BackupGenerations(services.tree, services.digest, project);
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
