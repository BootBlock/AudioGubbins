/**
 * The recording session's transitions (`REQ-ARCH-153`, ADR-0070).
 *
 * A pure reducer: a session and an event give the next session, or the reason
 * the session cannot take the event. Nothing here opens a device, writes a
 * chunk or waits: the application does that work and states what happened as
 * events, so every rule of the session is in one table, tested without a
 * browser.
 *
 * The facts the rules need arrive on the events: whether this tab holds the
 * project's write lease (`REQ-STOR-098`), the clock frame Record was pressed
 * at, and the frames the retrospective buffer holds then. Disarming is never
 * refused: closing the microphone is always the person's to do.
 */
import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import type { SessionEvent } from './session-events.js';
import {
  countInElapsed,
  countingIn,
  failedWith,
  finished,
  recorded,
  stopped,
  stopping,
} from './session-recording.js';
import {
  NO_WRITE_LEASE,
  PERMISSION_DENIED,
  PERMISSION_REVOKED,
  refused,
} from './session-refusals.js';
import {
  readied,
  setupOf,
  type ArmedPurpose,
  type OpenInput,
  type RecordingSession,
  type StopReason,
} from './session-state.js';

/** The next session, or why `session` cannot take `event`. */
export function nextSession(
  session: RecordingSession,
  event: SessionEvent,
): DomainResult<RecordingSession> {
  switch (event.kind) {
    case 'permission-asked':
    case 'permission-granted':
    case 'permission-denied':
      return permission(session, event);
    case 'permission-revoked':
      return lost(session, event, { kind: 'permission-revoked' }, PERMISSION_REVOKED);
    case 'device-lost':
      return lost(session, event, { kind: 'device-lost' }, undefined);
    case 'failed':
      return succeed(failedWith(session, event.failure));
    case 'device-chosen':
    case 'profile-chosen':
    case 'retrospective-set':
      return setupChanged(session, event);
    case 'arm':
      return armed(session, event);
    case 'retarget':
      return retargeted(session, event);
    case 'device-opened':
      return session.kind === 'armed' && session.input.kind === 'opening'
        ? succeed({ ...session, input: openInput(event) })
        : refused(session, event, 'no input is being opened, so the one opened is to be closed.');
    case 'disarm':
      return session.kind === 'armed' || session.kind === 'counting-in'
        ? succeed(readied(session))
        : refused(session, event, 'only an armed input is disarmed; a recording is stopped.');
    case 'count-in-started':
      return countingIn(session, event);
    case 'count-in-elapsed':
      return countInElapsed(session, event);
    case 'record':
      return recorded(session, event);
    case 'stop':
      return stopped(session, event);
    case 'stopped':
      return finished(session, event);
    case 'close':
      return session.kind === 'recording' || session.kind === 'stopping'
        ? refused(session, event, 'a recording is stopped before recording is closed.')
        : succeed({ kind: 'closed' });
  }
}

/** The session after the permission was asked for, found or given, or refused. */
function permission(
  session: RecordingSession,
  event: Extract<
    SessionEvent,
    { kind: 'permission-asked' | 'permission-granted' | 'permission-denied' }
  >,
): DomainResult<RecordingSession> {
  switch (event.kind) {
    case 'permission-asked':
      return session.kind === 'closed' || session.kind === 'failed'
        ? succeed({ kind: 'asking' })
        : refused(session, event, 'the permission is asked for only while recording is closed.');
    case 'permission-granted':
      return session.kind === 'closed' || session.kind === 'asking' || session.kind === 'failed'
        ? succeed({ kind: 'ready', ...event.setup })
        : refused(session, event, 'the permission is already held.');
    case 'permission-denied':
      return session.kind === 'closed' || session.kind === 'asking'
        ? succeed({ kind: 'failed', failure: PERMISSION_DENIED })
        : refused(session, event, 'only a permission being asked for is refused.');
  }
}

/** The session after its input was lost or its permission taken back. */
function lost(
  session: RecordingSession,
  event: SessionEvent,
  reason: Extract<StopReason, { kind: 'device-lost' | 'permission-revoked' }>,
  failed: DomainFailure | undefined,
): DomainResult<RecordingSession> {
  switch (session.kind) {
    case 'recording':
      return succeed(stopping(session, reason));
    case 'stopping':
      // The recording already ended as it did; what is lost is the input it
      // would have stayed armed on.
      return succeed({ ...session, inputClosedBy: reason.kind });
    case 'ready':
    case 'armed':
    case 'counting-in':
      return succeed(
        failed === undefined
          ? { kind: 'ready', ...setupOf(session, undefined) }
          : { kind: 'failed', failure: failed },
      );
    case 'asking':
      return failed === undefined
        ? refused(session, event, 'no input is chosen while the permission is asked for.')
        : succeed({ kind: 'failed', failure: failed });
    case 'closed':
    case 'failed':
      return refused(session, event, 'nothing is held to lose.');
  }
}

function setupChanged(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'device-chosen' | 'profile-chosen' | 'retrospective-set' }>,
): DomainResult<RecordingSession> {
  if (session.kind !== 'ready' && session.kind !== 'armed') {
    return refused(session, event, 'the input and its setup change only while ready or armed.');
  }
  const profile = event.kind === 'profile-chosen' ? event.profile : session.profile;
  const retrospective = event.kind === 'retrospective-set' ? event.setting : session.retrospective;
  if (session.kind === 'ready') {
    const device = event.kind === 'device-chosen' ? event.device : session.device;
    return succeed({
      kind: 'ready',
      profile,
      retrospective,
      ...(device === undefined ? {} : { device }),
    });
  }

  // Another device or profile is another stream, so an armed input opens
  // again with it; the buffer is only started or stopped, on the same stream.
  return succeed({
    kind: 'armed',
    device: event.kind === 'device-chosen' ? event.device : session.device,
    profile,
    retrospective,
    purpose: session.purpose,
    input: event.kind === 'retrospective-set' ? session.input : { kind: 'opening' },
  });
}

function armed(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'arm' }>,
): DomainResult<RecordingSession> {
  if (session.kind !== 'ready') return refused(session, event, 'only a ready input is armed.');
  if (!event.holdsWriteLease) return fail(NO_WRITE_LEASE);
  if (session.device === undefined) {
    return refused(session, event, 'no input is chosen to arm.');
  }
  const purposeProblem = purposeRefusal(event.purpose);
  if (purposeProblem !== undefined) return refused(session, event, purposeProblem);
  return succeed({
    kind: 'armed',
    ...setupOf(session, session.device),
    device: session.device,
    purpose: event.purpose,
    input: { kind: 'opening' },
  });
}

function retargeted(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'retarget' }>,
): DomainResult<RecordingSession> {
  if (session.kind !== 'armed')
    return refused(session, event, 'only an armed input is retargeted.');
  const purposeProblem = purposeRefusal(event.purpose);
  return purposeProblem === undefined
    ? succeed({ ...session, purpose: event.purpose })
    : refused(session, event, purposeProblem);
}

/** Why `purpose` cannot be recorded for, or none. */
function purposeRefusal(purpose: ArmedPurpose): string | undefined {
  if (purpose.kind !== 'punch') return undefined;
  if (purpose.length === 0) return 'a punch is over a range of at least one frame.';
  // The pre-roll is recorded, and the punch reads the take from it, so it
  // cannot reach before the asset's first frame.
  return purpose.preRoll > purpose.start
    ? "a punch's pre-roll cannot begin before the asset does."
    : undefined;
}

function openInput(event: Extract<SessionEvent, { kind: 'device-opened' }>): OpenInput {
  return { kind: 'open', granted: event.granted, rate: event.rate, channels: event.channels };
}
