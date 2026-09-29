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
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

/** The failure a refusal of the storage tree is reported as. */
export function storageRefused(refusal: TreeFailure): DomainFailure {
  switch (refusal.kind) {
    case TreeFailureKind.Quota:
      return failure(
        'storage.full',
        FailureKind.Retryable,
        'The storage is full; the change is kept in memory and is written once room is made.',
      );
    case TreeFailureKind.Unavailable:
      return failure(
        'storage.unavailable',
        FailureKind.Retryable,
        'The storage cannot be reached; the change is kept in memory until it can be.',
      );
    case TreeFailureKind.Io:
      return failure(
        'storage.failed',
        FailureKind.Retryable,
        'The storage refused the write for a reason of its own; it can be tried again.',
      );
  }
}

/**
 * Runs work against the tree and reports the tree's refusals as designed
 * failures. Anything else, an abort or a defect among them, is the caller's to
 * hear as thrown.
 */
export async function refusalsReported<TValue>(
  work: () => Promise<DomainResult<TValue>>,
): Promise<DomainResult<TValue>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TreeFailure) return fail(storageRefused(error));
    throw error;
  }
}

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

/** The failure of an operation refused because another window holds the project. */
export function projectBusy(project: ProjectId): DomainFailure {
  return failure(
    'storage.project-busy',
    FailureKind.Conflict,
    'Another window is changing this project.',
    { details: { project } },
  );
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
