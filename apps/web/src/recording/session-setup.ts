/**
 * What the recording session is told of the person's settings and of the
 * inputs the browser lists (`ADR-0070`): the setup a session is made ready
 * with, the changes of profile and buffer an armed input follows, and whether
 * the input in use has left the list.
 *
 * Each is a value read from the settings and the list; the input control
 * moves the session by what these answer.
 */

import type { InputDeviceDescriptor } from '@audiogubbins/capabilities';
import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';
import {
  PROCESSING_CONTROLS,
  isSameDevice,
  nextSession,
  type ArmedPurpose,
  type RecordingSession,
  processingOf,
  type CaptureProfile,
  type DeviceIdentity,
  type RetrospectiveSetting,
  type SessionEvent,
  type SessionSetup,
} from '@audiogubbins/recording';

import { chosenProfileOf, type RecordingSettings } from '../state/recording-settings.js';
import { identityOfDevice } from './capture-facts.js';

/** The setup a session is made ready with: the remembered input, found again, the profile and the buffer. */
export function setupOf(
  recording: RecordingSettings,
  devices: readonly InputDeviceDescriptor[],
): SessionSetup {
  const remembered = recording.input;
  const listed =
    remembered === undefined
      ? undefined
      : devices
          .flatMap((one) => identityOfDevice(one) ?? [])
          .find((one) => isSameDevice(remembered, one));
  const device = listed ?? remembered;
  return {
    profile: chosenProfileOf(recording),
    retrospective: recording.retrospective,
    ...(device === undefined ? {} : { device }),
  };
}

/** The profile and the buffer a session last followed. */
export interface Followed {
  readonly profile: CaptureProfile;
  readonly retrospective: RetrospectiveSetting;
}

/** What a session follows of `recording`. */
export function followedOf(recording: RecordingSettings): Followed {
  return { profile: chosenProfileOf(recording), retrospective: recording.retrospective };
}

/** Whether two profiles ask the browser for the same processing. */
function sameProcessing(one: CaptureProfile, other: CaptureProfile): boolean {
  const first = processingOf(one);
  const second = processingOf(other);
  return PROCESSING_CONTROLS.every((control) => first[control] === second[control]);
}

/**
 * The events a session follows a change of the settings from `before` to
 * `after` with. A profile only marked for headphones or not asks the browser
 * for nothing new, so it is no event: an armed input is not opened again for
 * it, and monitoring reads the mark.
 */
export function followingEvents(before: Followed, after: Followed): readonly SessionEvent[] {
  const events: SessionEvent[] = [];
  if (
    before.profile.name !== after.profile.name ||
    !sameProcessing(before.profile, after.profile)
  ) {
    events.push({ kind: 'profile-chosen', profile: after.profile });
  }
  if (before.retrospective !== after.retrospective) {
    events.push({ kind: 'retrospective-set', setting: after.retrospective });
  }
  return events;
}

/**
 * Whether `chosen` has left `devices`. The browser's default is whichever
 * input the browser gives, so it never has, and a list without identifiers,
 * as one before the permission is, says nothing of a device's presence.
 */
export function deviceGone(
  devices: readonly InputDeviceDescriptor[],
  chosen: DeviceIdentity | undefined,
): boolean {
  const listed = devices.flatMap((one) => identityOfDevice(one) ?? []);
  if (chosen === undefined || chosen.id === '' || listed.length === 0) return false;
  return !listed.some((one) => isSameDevice(chosen, one));
}

/** What an arming is for, and whether this tab holds the project's write lease (`REQ-STOR-098`). */
export interface ArmRequest {
  readonly purpose: ArmedPurpose;
  readonly holdsWriteLease: boolean;
}

/**
 * The input the browser chooses where the person chose none, which the
 * session is armed with until the browser says which input it opened.
 */
export const BROWSER_DEFAULT_INPUT: DeviceIdentity = { id: '' };

/**
 * Why `session` cannot be armed for `request` now, or nothing where it can:
 * the session is asked as it would stand once ready with `setup`, so a tab
 * without the write lease, or a purpose the session refuses, is told why
 * before the browser is asked anything.
 */
export function armFailure(
  session: RecordingSession,
  setup: SessionSetup,
  request: ArmRequest,
): DomainFailure | undefined {
  if (session.kind === 'asking') {
    return failure(
      'recording.asking',
      FailureKind.Rejected,
      'The browser is asking for the microphone already.',
    );
  }
  if (session.kind !== 'closed' && session.kind !== 'failed' && session.kind !== 'ready') {
    return failure('recording.armed', FailureKind.Rejected, 'An input is armed already.');
  }
  const asked = nextSession(
    { kind: 'ready', ...setup, device: setup.device ?? BROWSER_DEFAULT_INPUT },
    { kind: 'arm', ...request },
  );
  return asked.ok ? undefined : asked.failures[0];
}
