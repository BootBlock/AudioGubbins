/**
 * The designed failures of keeping projects, one constructor each, so a code
 * means one thing wherever it is raised (REQ-EXEC-136.15).
 *
 * A refusal of the storage tree becomes a failure by its kind. A full storage
 * may take the write once room is made (REQ-STOR-106), and nothing already
 * stored was harmed by the refusal; an unreachable storage will not, until the
 * platform lets it; any other refusal of the platform may pass. No quota is
 * assumed anywhere (REQ-EXEC-216): the storage says it is full by refusing.
 */

import {
  FailureKind,
  fail,
  failure,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  TreeFailure,
  TreeFailureKind,
  type ContentId,
  type NamedSnapshot,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import type { LeaseAcquisition } from './write-lease.js';

/** The failure a refusal of the storage tree is reported as. */
export function storageRefused(refusal: TreeFailure): DomainFailure {
  switch (refusal.kind) {
    case TreeFailureKind.Quota:
      return failure(
        STORAGE_FULL,
        FailureKind.Retryable,
        'The storage is full; the change is kept in memory and is written once room is made.',
      );
    case TreeFailureKind.Unavailable:
      return failure(
        STORAGE_UNAVAILABLE,
        FailureKind.Retryable,
        'The storage cannot be reached; the change is kept in memory until it can be.',
      );
    case TreeFailureKind.Io:
      return failure(
        STORAGE_FAILED,
        FailureKind.Retryable,
        'The storage refused the write for a reason of its own; it can be tried again.',
      );
  }
}

/** Why the storage refused a write: it is full, cannot be reached, or gave its own reason. */
export type StorageRefusal = 'full' | 'unavailable' | 'failed';

const STORAGE_FULL = 'storage.full';
const STORAGE_UNAVAILABLE = 'storage.unavailable';
const STORAGE_FAILED = 'storage.failed';

const REFUSALS: ReadonlyMap<string, StorageRefusal> = new Map([
  [STORAGE_FULL, 'full'],
  [STORAGE_UNAVAILABLE, 'unavailable'],
  [STORAGE_FAILED, 'failed'],
]);

/**
 * Why the storage refused a write, where a failure is {@link storageRefused}'s,
 * so an interface can say what the refusal means for what it was writing.
 */
export function storageRefusalOf(cause: DomainFailure): StorageRefusal | undefined {
  return REFUSALS.get(cause.code);
}

/**
 * Whether a failure is a write refused because the storage is full, which may
 * pass once room is made.
 */
export function isStorageFull(cause: DomainFailure): boolean {
  return storageRefusalOf(cause) === 'full';
}

/**
 * The failure of a backup refused because a state its project keeps cannot be
 * read, being missing or damaged: the state, and the name of the snapshot
 * keeping it where one does, so the person knows which part of the project a
 * backup would lack.
 */
export function keptStateUnreadable(
  project: ProjectId,
  state: StateFingerprint,
  snapshot: NamedSnapshot | undefined,
  cause: DomainFailure | undefined,
): DomainFailure {
  return failure(
    KEPT_STATE_UNREADABLE,
    FailureKind.IntegrityViolation,
    snapshot === undefined
      ? 'A state the project’s history keeps cannot be read, so a backup would not be whole and none was made.'
      : `The state of the snapshot “${snapshot.name}” cannot be read, so a backup would not be whole and none was made.`,
    {
      details: { project, state, ...(snapshot === undefined ? {} : { snapshot: snapshot.name }) },
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

/**
 * Which state a backup could not read, where a failure is
 * {@link keptStateUnreadable}'s: the name of the snapshot keeping it, where one
 * does.
 */
export function unreadableStateOf(
  cause: DomainFailure,
): { readonly snapshot?: string } | undefined {
  if (cause.code !== KEPT_STATE_UNREADABLE) return undefined;
  const snapshot = cause.details?.['snapshot'];
  return typeof snapshot === 'string' ? { snapshot } : {};
}

const KEPT_STATE_UNREADABLE = 'storage.backup-state-unreadable';

/**
 * A designed failure met where only a throw can carry it out, such as a source
 * whose bytes are refused as they are read, which {@link refusalsReported}
 * reports as the failure it carries.
 */
export class CarriedFailure extends Error {
  readonly failure: DomainFailure;

  constructor(carried: DomainFailure) {
    super(carried.summary);
    this.name = 'CarriedFailure';
    this.failure = carried;
  }
}

/**
 * Runs work against the tree and reports the tree's refusals, and the failures
 * carried out by a throw, as designed failures. Anything else, an abort or a
 * defect among them, is the caller's to hear as thrown.
 */
export async function refusalsReported<TValue>(
  work: () => Promise<DomainResult<TValue>>,
): Promise<DomainResult<TValue>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TreeFailure) return fail(storageRefused(error));
    if (error instanceof CarriedFailure) return fail(error.failure);
    throw error;
  }
}

/** The failure of media whose bytes are not the media its identity names. */
export function mediaDamaged(path: string, contentId: ContentId): DomainFailure {
  return failure(
    'storage.media-damaged',
    FailureKind.IntegrityViolation,
    'A media file is not the media its name says it is.',
    { details: { file: path, contentId } },
  );
}

/**
 * The failure of a write refused because what it holds is larger than its
 * reader accepts: `kind` is the record's kind, or `state` for a kept state. It
 * is never retried as it stands, since the same write would be refused again.
 */
export function recordTooLarge(kind: string, cause: DomainFailure): DomainFailure {
  return failure(
    RECORD_TOO_LARGE,
    FailureKind.Rejected,
    'This is larger than storage can read back, so it was not written.',
    { details: { kind }, cause },
  );
}

/** Whether a failure is {@link recordTooLarge}'s. */
export function isRecordTooLarge(cause: DomainFailure): boolean {
  return cause.code === RECORD_TOO_LARGE;
}

const RECORD_TOO_LARGE = 'storage.record-too-large';

/** The failure of asking for a project the storage does not hold. */
export function projectMissing(project: ProjectId): DomainFailure {
  return failure('storage.project-missing', FailureKind.Rejected, 'There is no such project.', {
    details: { project },
  });
}

/**
 * The failure of an operation that needs the write lease where the platform
 * offers no way to coordinate one (REQ-STOR-098: fail safely).
 */
export function noCoordination(): DomainFailure {
  return failure(
    'storage.no-coordination',
    FailureKind.Unrecoverable,
    'This browser cannot coordinate which window may change a project, so none may.',
  );
}

/**
 * The failure of restoring or deleting again a project whose purge began: a
 * crash cut it short, so its files may be part gone, and it can only be purged.
 */
export function projectPurging(project: ProjectId): DomainFailure {
  return failure(
    'storage.project-purging',
    FailureKind.Rejected,
    'This project was being purged, so it can no longer be restored. Purge it to finish.',
    { details: { project } },
  );
}

/** The failure of an operation refused because another window holds the project. */
export function projectBusy(project: ProjectId): DomainFailure {
  return failure(
    'storage.project-busy',
    FailureKind.Conflict,
    'Another window is changing this project.',
    { details: { project } },
  );
}

/** Why a project's lease that was asked for is not held: another window's, or none to be had. */
export function leaseRefused(
  refusal: Exclude<LeaseAcquisition, { readonly kind: 'held' }>,
  project: ProjectId,
): DomainFailure {
  return refusal.kind === 'busy' ? projectBusy(project) : noCoordination();
}

/**
 * The failure of a replayed invocation the command layer would not apply: the
 * stored history no longer describes a change this build can make.
 */
export function replayRefused(cause: DomainFailure): DomainFailure {
  return failure(
    'storage.replay-refused',
    FailureKind.IntegrityViolation,
    'A stored change could not be made again, so the project cannot be rebuilt past it.',
    { cause },
  );
}

/**
 * The failure of a replay that made a state other than the one recorded: the
 * stored changes no longer describe this project, so nothing past them is
 * trusted.
 */
export function replayDiverged(): DomainFailure {
  return failure(
    'storage.replay-diverged',
    FailureKind.IntegrityViolation,
    'Replaying the stored changes did not give the state they were recorded with.',
  );
}
