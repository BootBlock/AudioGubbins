/**
 * Controlled recording: a count-in, a timed stop and a start at a set time,
 * as decisions over the media clock (`REQ-REC-020`, `REQ-REC-097`, ADR-0070).
 *
 * Nothing here keeps time. The application reads the clock, a frame of the
 * context the capture runs in, and asks what to do now; the answer is to wait
 * until a frame, or to act. So a schedule is tested by giving it frames, and
 * the one clock that places a capture's first frame also decides when it
 * starts.
 *
 * A scheduled recording runs only while the page stays open, armed and
 * visible: a browser may suspend capture in the background or under a screen
 * lock, so a page that is hidden before recording starts cancels the schedule,
 * and one hidden while recording stops it and keeps what it has.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import type { ArmedPurpose } from './session-state.js';

/** What the person asked for, in frames of the media clock. */
export interface ControlledRecording {
  /** The frames counted in before recording begins, which are not recorded: none for no count-in. */
  readonly countIn: SampleCount;

  /** The frames recorded before the recording stops by itself, where it does. */
  readonly stopAfter?: SampleCount;

  /** The clock frame recording begins at, where it is set; otherwise it begins when the count-in ends. */
  readonly startAt?: SampleCount;
}

/** What is true when a recording is scheduled. */
export interface ScheduleFacts {
  /** The media clock's frame now. */
  readonly now: SampleCount;
  readonly armed: boolean;
  readonly pageVisible: boolean;

  /** Whether this platform may suspend capture in the background or under a screen lock. */
  readonly suspensionRisk: boolean;
}

/** When a recording counts in, begins and stops, in frames of the media clock. */
export interface RecordingSchedule {
  readonly countInFrom: SampleCount;
  readonly recordAt: SampleCount;
  readonly stopAt?: SampleCount;

  /** What the person is told before it is scheduled, where the platform may suspend capture. */
  readonly caution?: string;
}

/** Said before a recording is scheduled on a platform that may suspend capture. */
export const SUSPENSION_CAUTION =
  'This browser may pause recording while the page is in the background or the screen is locked, so keep this page open and in view until the recording ends.';

/** The schedule of `plan`, or why it cannot be scheduled. */
export function scheduleRecording(
  plan: ControlledRecording,
  facts: ScheduleFacts,
): DomainResult<RecordingSchedule> {
  if (!facts.armed)
    return refused('recording.schedule-not-armed', 'Arm an input before scheduling a recording.');
  if (!facts.pageVisible) {
    return refused(
      'recording.schedule-page-hidden',
      'A recording is scheduled only while the page is in view, since a hidden page may not record.',
    );
  }
  if (plan.stopAfter === 0) {
    return refused('recording.schedule-empty', 'A timed recording lasts at least one frame.');
  }

  const recordAt = plan.startAt ?? derivedSampleCount(facts.now + plan.countIn);
  const countInFrom = recordAt - plan.countIn;
  if (countInFrom < facts.now) {
    return refused(
      'recording.schedule-in-the-past',
      plan.startAt !== undefined && plan.startAt >= facts.now
        ? 'The start is too soon for the count-in before it.'
        : 'The start is in the past.',
    );
  }

  return succeed({
    countInFrom: derivedSampleCount(countInFrom),
    recordAt,
    ...(plan.stopAfter === undefined
      ? {}
      : { stopAt: derivedSampleCount(recordAt + plan.stopAfter) }),
    ...(facts.suspensionRisk ? { caution: SUSPENSION_CAUTION } : {}),
  });
}

/** Where a scheduled recording is. */
export type SchedulePhase = 'waiting' | 'counting-in' | 'recording';

/**
 * What to do now.
 *
 * - `wait`: nothing yet; ask again at clock frame `until`, or when the page's
 *   visibility changes, where nothing is due.
 * - `begin-count-in`, `begin-recording`: the session's count-in or recording
 *   begins (`session-transition.ts`).
 * - `stop`: the timed end came, or the page was hidden while recording.
 * - `cancel`: the page was hidden before recording began.
 */
export type ScheduleStep =
  | { readonly kind: 'wait'; readonly until?: SampleCount }
  | { readonly kind: 'begin-count-in' }
  | { readonly kind: 'begin-recording' }
  | { readonly kind: 'stop'; readonly reason: 'timed' | 'background-suspended' }
  | { readonly kind: 'cancel'; readonly reason: string };

/** What `schedule`, in `phase`, does at clock frame `now` with the page visible or not. */
export function scheduleStep(
  schedule: RecordingSchedule,
  phase: SchedulePhase,
  now: SampleCount,
  pageVisible: boolean,
): ScheduleStep {
  switch (phase) {
    case 'waiting':
    case 'counting-in':
      if (!pageVisible) {
        return {
          kind: 'cancel',
          reason:
            'The scheduled recording was cancelled because the page was hidden before it began.',
        };
      }
      if (phase === 'waiting' && schedule.countInFrom < schedule.recordAt) {
        return now >= schedule.countInFrom
          ? { kind: 'begin-count-in' }
          : { kind: 'wait', until: schedule.countInFrom };
      }
      return now >= schedule.recordAt
        ? { kind: 'begin-recording' }
        : { kind: 'wait', until: schedule.recordAt };
    case 'recording':
      if (!pageVisible) return { kind: 'stop', reason: 'background-suspended' };
      if (schedule.stopAt === undefined) return { kind: 'wait' };
      return now >= schedule.stopAt
        ? { kind: 'stop', reason: 'timed' }
        : { kind: 'wait', until: schedule.stopAt };
  }
}

/** Where on the asset a punch's recording runs: from its pre-roll to the end of its post-roll. */
export interface PunchWindow {
  readonly from: SampleCount;
  readonly length: SampleCount;
}

/** The window `punch` records over, the pre-roll and post-roll around its range. */
export function punchWindow(punch: Extract<ArmedPurpose, { kind: 'punch' }>): PunchWindow {
  return {
    from: derivedSampleCount(punch.start - punch.preRoll),
    length: derivedSampleCount(punch.preRoll + punch.length + punch.postRoll),
  };
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}
