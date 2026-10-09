/**
 * Why a recording session refuses an event, or cannot go on: the failures its
 * transitions give, in one place, so a reason is worded once and a test or a
 * view keys it by one code.
 */

import {
  FailureKind,
  fail,
  failure,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

import type { SessionEvent } from './session-events.js';
import type { RecordingSession } from './session-state.js';

/** Why nothing can be recorded after the person refused the microphone. */
export const PERMISSION_DENIED: DomainFailure = failure(
  'recording.permission-denied',
  FailureKind.Rejected,
  'The microphone permission was refused, so nothing can be recorded until it is given.',
);

/** Why recording stopped, and cannot start, after the person took the microphone back. */
export const PERMISSION_REVOKED: DomainFailure = failure(
  'recording.permission-revoked',
  FailureKind.Rejected,
  'The microphone permission was taken back, so recording stopped and nothing more can be recorded until it is given again.',
);

/** Why a tab without the project's write lease cannot arm or record (`REQ-STOR-098`). */
export const NO_WRITE_LEASE: DomainFailure = failure(
  'recording.no-write-lease',
  FailureKind.Conflict,
  'Another tab holds this project for writing, so this tab cannot arm or record into it.',
);

/** Why `session` cannot take `event`. */
export function refused(
  session: RecordingSession,
  event: SessionEvent,
  why: string,
): DomainResult<never> {
  return fail(
    failure(
      'recording.transition-refused',
      FailureKind.Conflict,
      `A recording session that is ${session.kind} cannot take ${event.kind}: ${why}`,
      { details: { state: session.kind, event: event.kind } },
    ),
  );
}
