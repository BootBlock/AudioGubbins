/**
 * The designed failures of an open project's operations, one constructor each,
 * so a code means one thing wherever it is raised (REQ-EXEC-136.15).
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import type { CompactionPlan } from '@audiogubbins/history';

import type { ProjectAccess } from './project-snapshot.js';
import type { SaveStatus } from './write-queue.js';

/** The failure of an operation on a project this window no longer writes. */
export function notWritable(access: ProjectAccess): DomainFailure {
  return failure(
    'storage.not-writable',
    FailureKind.Conflict,
    access.kind === 'lost'
      ? 'Another window took the project, so this one can no longer change it. Reopen it to read.'
      : 'This window no longer holds the project to change it.',
    { details: { access: access.kind } },
  );
}

/** The failure of letting a project go while changes are not yet saved. */
export function unsavedChanges(status: SaveStatus): DomainFailure {
  return failure(
    'storage.unsaved-changes',
    FailureKind.Retryable,
    'Changes are not yet saved, so the project stays open here until they are.',
    { details: { status: status.kind } },
  );
}

/**
 * The failure of a command that changed the project and gave no way to undo
 * it: a change the history cannot reverse cannot be kept in it.
 */
export function notRecordable(): DomainFailure {
  return failure(
    'storage.change-not-recordable',
    FailureKind.IntegrityViolation,
    'A command changed the project without saying how to undo it, so the change was not kept.',
  );
}

export const NOTHING_TO_UNDO = failure(
  'history.nothing-to-undo',
  FailureKind.Rejected,
  'There is nothing to undo.',
);

export const NOTHING_TO_REDO = failure(
  'history.nothing-to-redo',
  FailureKind.Rejected,
  'There is nothing to redo.',
);

export const NO_SUCH_NODE = failure(
  'history.unknown-node',
  FailureKind.Rejected,
  'The history holds no such point to go to.',
);

export const NO_COMPARISON = failure(
  'comparison.none-open',
  FailureKind.Rejected,
  'No comparison is open.',
);

/**
 * The failure of a retention policy that would let history go, set without the
 * person's confirmation of what it lets go (REQ-STOR-106).
 */
export function retentionUnconfirmed(plan: CompactionPlan): DomainFailure {
  return failure(
    'storage.retention-unconfirmed',
    FailureKind.Rejected,
    'The retention policy would remove history, and was not confirmed as it was shown.',
    { details: { reclaimableBytes: plan.reclaimableBytes, changes: plan.removable.length } },
  );
}
