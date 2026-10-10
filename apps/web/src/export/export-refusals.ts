/**
 * The designed failures of the page's export (ADR-0092), one constructor for
 * each kind, so a code means one thing wherever the export raises it.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** Why an export cannot start or go on, under `export.<code>`. */
export function exportRefusal(
  code: string,
  summary: string,
  details?: DomainFailure['details'],
): DomainFailure {
  return failure(
    `export.${code}`,
    FailureKind.Rejected,
    summary,
    details === undefined ? {} : { details },
  );
}

/** A step of an export that stopped by throwing, as the person is told it. */
export function exportStopped(step: string, thrown: unknown): DomainFailure {
  return failure(
    'export.stopped',
    FailureKind.Unrecoverable,
    `The export's ${step} stopped: ${thrown instanceof Error ? thrown.message : 'no reason was given'}.`,
  );
}
