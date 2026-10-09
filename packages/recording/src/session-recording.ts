/**
 * The recording session's transitions once an input is open: a count-in, a
 * recording from a known clock frame, its stop and its finish (ADR-0070).
 *
 * A recording begins only on an armed input that is open, and only for the
 * tab holding the write lease; it begins with the frames the retrospective
 * buffer holds. When it is finished the input stays armed for another take
 * unless capture itself ended.
 */

import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import { retrospectiveStart } from './retrospective-buffer.js';
import type { SessionEvent } from './session-events.js';
import { NO_WRITE_LEASE, PERMISSION_REVOKED, refused } from './session-refusals.js';
import {
  readied,
  setupOf,
  type Armed,
  type OpenInput,
  type RecordingSession,
  type StopReason,
} from './session-state.js';

export function countingIn(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'count-in-started' }>,
): DomainResult<RecordingSession> {
  if (session.kind !== 'armed' || session.input.kind !== 'open') {
    return refused(session, event, 'a count-in starts only on an armed input that is open.');
  }
  if (!event.holdsWriteLease) return fail(NO_WRITE_LEASE);
  return succeed({
    ...session,
    kind: 'counting-in',
    input: session.input,
    recordAt: event.recordAt,
  });
}

export function recorded(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'record' }>,
): DomainResult<RecordingSession> {
  if (session.kind !== 'armed' || session.input.kind !== 'open') {
    return refused(session, event, 'Record starts only on an armed input that is open.');
  }
  if (!event.holdsWriteLease) return fail(NO_WRITE_LEASE);
  return succeed(recording({ ...session, input: session.input }, event.at, event.held));
}

/** The recording a count-in ends in, or why none is running. */
export function countInElapsed(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'count-in-elapsed' }>,
): DomainResult<RecordingSession> {
  return session.kind === 'counting-in'
    ? succeed(recording(session, session.recordAt, event.held))
    : refused(session, event, 'no count-in is running.');
}

/** A recording that began at clock frame `at`, with the `held` buffered frames before it. */
function recording(
  session: Armed & { readonly input: OpenInput },
  at: SampleCount,
  held: SampleCount,
): RecordingSession {
  const start = retrospectiveStart(session.retrospective, session.input.rate, held, at);
  return {
    kind: 'recording',
    device: session.device,
    profile: session.profile,
    retrospective: session.retrospective,
    purpose: session.purpose,
    input: session.input,
    firstFrame: start.firstFrame,
    retrospectiveFrames: start.frames,
  };
}

export function stopped(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'stop' }>,
): DomainResult<RecordingSession> {
  if (session.kind === 'recording') return succeed(stopping(session, { kind: event.reason }));
  // A count-in stopped has recorded nothing: the input stays armed.
  if (session.kind === 'counting-in') {
    return succeed({
      kind: 'armed',
      ...setupOf(session, session.device),
      device: session.device,
      purpose: session.purpose,
      input: session.input,
    });
  }
  return refused(session, event, 'nothing is being recorded.');
}

export function stopping(
  session: Extract<RecordingSession, { kind: 'recording' }>,
  reason: StopReason,
): RecordingSession {
  return { ...session, kind: 'stopping', reason };
}

/**
 * The session once a recording is finished. The input stays armed for another
 * take after the person's or the timed stop, and after a refused write, which
 * leaves the input as it was; it is closed when capture itself ended.
 */
function afterStopping(session: Extract<RecordingSession, { kind: 'stopping' }>): RecordingSession {
  if (session.inputClosedBy === 'permission-revoked') {
    return { kind: 'failed', failure: PERMISSION_REVOKED };
  }
  if (session.inputClosedBy === 'device-lost')
    return { kind: 'ready', ...setupOf(session, undefined) };
  switch (session.reason.kind) {
    case 'person':
    case 'timed':
    case 'quota':
      return {
        kind: 'armed',
        ...setupOf(session, session.device),
        device: session.device,
        purpose: session.purpose,
        input: session.input,
      };
    case 'background-suspended':
      return readied(session);
    case 'device-lost':
      return { kind: 'ready', ...setupOf(session, undefined) };
    case 'permission-revoked':
      return { kind: 'failed', failure: PERMISSION_REVOKED };
    case 'failure':
      return { kind: 'failed', failure: session.reason.failure };
  }
}

/** The session once a stopping recording is finished, or why none is stopping. */
export function finished(
  session: RecordingSession,
  event: Extract<SessionEvent, { kind: 'stopped' }>,
): DomainResult<RecordingSession> {
  return session.kind === 'stopping'
    ? succeed(afterStopping(session))
    : refused(session, event, 'no recording is stopping.');
}

/**
 * The session after a failure recording cannot go on through: a recording
 * stops, keeping what it committed, and anything else fails.
 */
export function failedWith(session: RecordingSession, failure: DomainFailure): RecordingSession {
  return session.kind === 'recording'
    ? stopping(session, { kind: 'failure', failure })
    : { kind: 'failed', failure };
}
