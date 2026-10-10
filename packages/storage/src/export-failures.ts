/**
 * The designed failures of staging and delivering an export (ADR-0092,
 * REQ-EXEC-136.15), one constructor each, so a code means one thing wherever
 * it is raised. A delivery refused leaves the export staged, so each says
 * what the person can do next without a new render.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import { TreeFailureKind, type TreeFailure } from '@audiogubbins/project-format';

/** An encoded stream that broke the order its messages come in, with what it did. */
export function encodedOutOfOrder(problem: string): DomainFailure {
  return failure(
    'export.stream-out-of-order',
    FailureKind.IntegrityViolation,
    `The encoded file arrived out of order (${problem}), so nothing of it was kept.`,
  );
}

/** What the codec worker is told of an export the person cancelled. */
export function exportCancelled(): DomainFailure {
  return failure('export.cancelled', FailureKind.Conflict, 'The export was cancelled.');
}

/** A staged export the storage no longer holds, given up or never staged. */
export function stagedExportMissing(token: string): DomainFailure {
  return failure(
    'export.staged-missing',
    FailureKind.Conflict,
    'The exported file is no longer staged, so it must be exported again.',
    { details: { staged: token } },
  );
}

/** A delivery whose destination may not be written now, the export left staged. */
export function destinationNeedsPermission(): DomainFailure {
  return failure(
    'export.permission-needed',
    FailureKind.Rejected,
    'AudioGubbins may not write to that destination now. Allow it, then try again, or choose another; the export is kept and needs no new render.',
  );
}

/** A delivery the person chose to skip, the name taken, the export left staged. */
export function collisionSkipped(name: string): DomainFailure {
  return failure(
    'export.collision-skipped',
    FailureKind.Rejected,
    'A file of that name is there already, so the export was not written; it is kept, to be delivered elsewhere or under another name.',
    { details: { name } },
  );
}

/** A delivery the destination refused as it was written, the export left staged. */
export function deliveryRefused(refusal: TreeFailure): DomainFailure {
  switch (refusal.kind) {
    case TreeFailureKind.Quota:
      return failure(
        'export.destination-full',
        FailureKind.Retryable,
        'The destination is full, so the file was not written. Make room or choose another destination; the export is kept and needs no new render.',
      );
    case TreeFailureKind.Unavailable:
      return failure(
        'export.destination-unavailable',
        FailureKind.Retryable,
        'The destination could not be written, as its permission may have been withdrawn. Allow it or choose another; the export is kept and needs no new render.',
      );
    case TreeFailureKind.Io:
      return failure(
        'export.destination-failed',
        FailureKind.Retryable,
        'The destination refused the file for a reason of its own, so it was not written. Try again or choose another; the export is kept.',
      );
  }
}
