/**
 * Opening a project: to write, where this window can take the write lease, and
 * to read otherwise (REQ-STOR-021, REQ-STOR-098, REQ-STOR-101).
 *
 * To write, the lease is taken first, or taken over where the person decided
 * to; then the project is rebuilt from storage (`project-recovery.ts`), and
 * only then is the epoch raised, sealing each earlier epoch at the last record
 * replayed from it, so a previous owner's late write is never replayed. A
 * project whose lease another window holds opens read-only with that window's
 * description, and so does every project on a platform that cannot coordinate
 * writers, with the reason (REQ-STOR-098: fail safely). Whichever way it opens,
 * the recovery report says what was found and done.
 */

import type { CommandBus } from '@audiogubbins/commands';
import type { Clock, Logger } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type IdGenerator,
  type ProjectId,
} from '@audiogubbins/domain';
import type { Digest, ProjectState, StorageTree } from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { readPair } from './generational-pair.js';
import { raiseEpoch, readLease, type EpochSeal, type LeaseReading } from './lease-records.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import {
  recoverProject,
  type ProjectRecoveryReport,
  type RecoveredProject,
} from './project-recovery.js';
import { ProjectSession } from './project-session.js';
import { DEFAULT_CADENCE, type SessionCadence } from './session-contracts.js';
import type { ReadOnlyReason } from './project-snapshot.js';
import { ReadOnlyProject } from './read-only-project.js';
import { projectMissing, refusalsReported } from './storage-failures.js';
import type { LeaseCoordinator, LeaseOwner, ProjectWriteLease } from './write-lease.js';

/** What opening a project works with, each made once by the composition root. */
export interface OpeningServices {
  readonly tree: StorageTree;
  readonly digest: Digest;

  /** The bus over the project commands, which every change and replay runs through. */
  readonly bus: CommandBus<ProjectState>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;

  /** This window, as another would be told of it. */
  readonly owner: LeaseOwner;
  readonly cadence?: SessionCadence;
}

/** Which project to open, and how. */
export interface OpeningRequest {
  readonly project: ProjectId;
  readonly access: 'write' | 'read';

  /**
   * Take the lease from the window holding it: only after the person decided
   * to, where that window is unavailable or stale.
   */
  readonly steal?: boolean;
  readonly signal?: AbortSignal;
}

/** A project opened, and what recovery found on the way. */
export type OpenedProject =
  | {
      readonly kind: 'writable';
      readonly session: ProjectSession;
      readonly report: ProjectRecoveryReport;
    }
  | {
      readonly kind: 'read-only';
      readonly view: ReadOnlyProject;
      readonly report: ProjectRecoveryReport;
    };

/** Opens a project (see the module comment). */
export async function openProject(
  request: OpeningRequest,
  services: OpeningServices,
): Promise<DomainResult<OpenedProject>> {
  const { project, signal } = request;
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  const header = await refusalsReported(async () => await headerOf(files, signal));
  if (!header.ok) return header;

  const { coordinator } = services;
  if (request.access === 'read') return await openToRead(files, { kind: 'requested' }, services);
  if (coordinator === undefined)
    return await openToRead(files, { kind: 'no-coordination' }, services);
  if (header.value.deleted !== undefined) return fail(projectDeleted(project));

  const acquired = await coordinator.acquire(project, {
    steal: request.steal ?? false,
    owner: services.owner,
  });
  if (acquired.kind === 'busy') {
    const reason: ReadOnlyReason =
      acquired.owner === undefined ? { kind: 'busy' } : { kind: 'busy', owner: acquired.owner };
    return await openToRead(files, reason, services);
  }

  const lease = acquired.lease;
  const opened = await refusalsReported(
    async () => await openToWrite(files, header.value, lease, coordinator, services, signal),
  );
  // Whatever kept the project from opening, the lease is let go, so no other
  // window waits on a writer that never began.
  if (!opened.ok) await lease.release();
  return opened;
}

async function headerOf(
  files: ProjectFiles,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const newest = (await readPair(files.records, files.header, signal)).valid[0];
  return newest === undefined ? fail(projectMissing(files.project)) : succeed(newest.value);
}

async function openToRead(
  files: ProjectFiles,
  reason: ReadOnlyReason,
  services: OpeningServices,
): Promise<DomainResult<OpenedProject>> {
  return await refusalsReported(async () => {
    const lease = await readLease(files.records, files.paths);
    const recovered = await recoverProject(files, lease.current, services);
    if (!recovered.ok) return recovered;
    const view = new ReadOnlyProject(files.project, recovered.value.model, reason, {
      owner: services.owner,
      ...(services.coordinator === undefined ? {} : { coordinator: services.coordinator }),
    });
    return succeed({ kind: 'read-only', view, report: recovered.value.report });
  });
}

async function openToWrite(
  files: ProjectFiles,
  header: ProjectHeader,
  lease: ProjectWriteLease,
  coordinator: LeaseCoordinator,
  services: OpeningServices,
  signal?: AbortSignal,
): Promise<DomainResult<OpenedProject>> {
  const reading = await readLease(files.records, files.paths, signal);
  const recovered = await recoverProject(files, reading.current, services, signal);
  if (!recovered.ok) return recovered;

  const raised = await raiseEpoch(
    files.records,
    files.paths,
    reading,
    sealsAfter(reading, recovered.value),
    signal,
  );
  if (!raised.ok) return raised;

  const session = new ProjectSession(
    {
      files,
      bus: services.bus,
      clock: services.clock,
      ids: services.ids,
      logger: services.logger,
      coordinator,
    },
    {
      recovered: recovered.value,
      lease,
      epoch: raised.value.epoch,
      headerName: header.name,
      cadence: services.cadence ?? DEFAULT_CADENCE,
    },
  );
  return succeed({ kind: 'writable', session, report: recovered.value.report });
}

/**
 * The seals a new epoch is written with: each epoch from the head's to the
 * current one sealed at its last record replayed, which is none for an epoch
 * replay did not reach, and every earlier seal kept as it was.
 */
function sealsAfter(reading: LeaseReading, recovered: RecoveredProject): readonly EpochSeal[] {
  const first = Math.min(...recovered.lastReplayed.keys());
  const seals = reading.current.seals.filter((seal) => seal.epoch < first);
  for (let epoch = first; epoch <= reading.current.epoch; epoch += 1) {
    seals.push({ epoch, lastSequence: recovered.lastReplayed.get(epoch) ?? 0 });
  }
  return seals;
}

function projectDeleted(project: ProjectId) {
  return failure(
    'storage.project-deleted',
    FailureKind.Rejected,
    'The project is deleted; restore it to change it.',
    { details: { project } },
  );
}
