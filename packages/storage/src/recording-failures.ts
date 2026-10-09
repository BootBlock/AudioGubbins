/**
 * The designed failures of recording into a project, one constructor each, so
 * a code means one thing wherever it is raised (REQ-EXEC-136.15, ADR-0071).
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import type { RecordingSessionId } from '@audiogubbins/project-format';

import type { ProjectAccess } from './project-snapshot.js';

/** Why a window that does not hold a project to change it cannot record into it (REQ-STOR-098). */
export function recordingNotWritable(access: ProjectAccess): DomainFailure {
  return failure(
    'recording.not-writable',
    FailureKind.Conflict,
    'Only the window that holds this project to change it can record into it, and this one does not.',
    { details: { access: access.kind } },
  );
}

/** Why a session that committed no frame is not made into an asset. */
export function nothingRecorded(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.nothing-recorded',
    FailureKind.Rejected,
    'Nothing was recorded, so there is no take to keep.',
    { details: { session } },
  );
}

/** Why a recording's file, stored, is not taken for its asset. */
export function recordingReadBackDiffers(
  session: RecordingSessionId,
  found: string,
): DomainFailure {
  return failure(
    'recording.read-back-differs',
    FailureKind.IntegrityViolation,
    'The recording’s file did not read back as it was written, so it was not added; the recording is kept to be recovered.',
    { details: { session, found } },
  );
}

/** Why an operation names a session the project does not have. */
export function recordingUnknown(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.unknown-session',
    FailureKind.Rejected,
    'The project has no interrupted recording of that name.',
    { details: { session } },
  );
}

/** Why a recording in progress cannot be recovered or discarded. */
export function recordingInProgress(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.in-progress',
    FailureKind.Conflict,
    'That recording is still being made, so it can only be stopped.',
    { details: { session } },
  );
}

/**
 * Why a punch's take cannot be added where it was recorded for: the asset was
 * edited after the punch was set up, so the range it names no longer lies
 * where it did.
 */
export function punchMoved(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.punch-moved',
    FailureKind.Rejected,
    'The audio was edited after this punch was set up, so its range no longer lies where it was recorded for; the recording is kept to be recovered.',
    { details: { session } },
  );
}

/** Why a recording that makes a take stack was given no name for it. */
export function stackUnnamed(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.stack-unnamed',
    FailureKind.Rejected,
    'A recording that starts a take stack needs a name for the stack.',
    { details: { session } },
  );
}

/** Why a recording cannot start under the name of a session the project has. */
export function recordingTaken(session: RecordingSessionId): DomainFailure {
  return failure(
    'recording.session-taken',
    FailureKind.Conflict,
    'The project already has a recording of that name, which is kept as it is.',
    { details: { session } },
  );
}
