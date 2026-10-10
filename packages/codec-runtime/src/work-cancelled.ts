/**
 * What a stream's receiver is told of work cancelled: a failure that ends the
 * stream, so the receiver keeps nothing of it (ADR-0090, ADR-0092).
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

export const WORK_CANCELLED: DomainFailure = failure(
  'codec-runtime.cancelled',
  FailureKind.Rejected,
  'The work was cancelled, so nothing of it is kept.',
);
