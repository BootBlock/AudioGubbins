/**
 * The person's recording settings, a part of their audio settings (`ADR-0070`):
 * the capture profiles, the profile in use, the input they chose, the
 * retrospective buffer, the count-in, where they had monitoring on, and the
 * latency calibrations they measured or set.
 *
 * Each change is a revision of the whole value that either answers the next
 * value or says why it is refused, so the audio settings store keeps one value
 * and one write, and a command that refuses has changed nothing. A revision
 * that changes nothing answers the value it was given, so the store keeps the
 * same object and writes nothing.
 *
 * A device is remembered by its identifier, then its group and label
 * (`isSameDevice`): the label is personal data, kept in the person's own
 * storage beside the rest of these settings and never written to a log.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  CaptureProfileKind,
  PROCESSING_CONTROLS,
  RAW_STUDIO_PROFILE,
  RETROSPECTIVE_OFF,
  VOICE_PROFILE,
  isSameDevice,
  manualCalibration,
  pathChanges,
  withHeadphones,
  withManualOffset,
  type CalibrationPath,
  type CaptureProfile,
  type DeviceIdentity,
  type LatencyCalibration,
  type RetrospectiveSetting,
} from '@audiogubbins/recording';
import { holderOf } from '@audiogubbins/text';

/** Whether the person had monitoring on with one input and one profile. */
export interface MonitoringPreference {
  readonly device: DeviceIdentity;
  /** The profile's name. */
  readonly profile: string;
  readonly on: boolean;
}

/** The person's recording settings. */
export interface RecordingSettings {
  /** Raw/Studio and Voice, as the person marked them, then their Custom profiles in the order made. */
  readonly profiles: readonly CaptureProfile[];

  /** The name of the profile an input is opened with. */
  readonly chosenProfile: string;

  /** The input the person chose, found again by `isSameDevice`; none until they choose one. */
  readonly input: DeviceIdentity | undefined;

  readonly retrospective: RetrospectiveSetting;

  /** Seconds counted in before a controlled recording begins; zero for none. */
  readonly countInSeconds: number;

  /** Seconds a punch records, and plays, before its range and after it (`REQ-REC-093`). */
  readonly punchPreRollSeconds: number;
  readonly punchPostRollSeconds: number;

  /** Seconds after which a recording stops by itself; zero for none. */
  readonly stopAfterSeconds: number;

  /** Where the person had monitoring on or off, by input and profile. */
  readonly monitoring: readonly MonitoringPreference[];

  /** The latency calibrations kept, each for one input, output and rate. */
  readonly calibrations: readonly LatencyCalibration[];
}

/** The longest count-in: long enough to walk to an instrument, short enough to be a count-in. */
export const LONGEST_COUNT_IN_SECONDS = 10;

/** The longest pre-roll or post-roll of a punch: a verse of context, not a second take. */
export const LONGEST_PUNCH_ROLL_SECONDS = 30;

/** The longest timed recording: a day, which no storage a browser gives would hold at full rate. */
export const LONGEST_TIMED_SECONDS = 86_400;

/**
 * A punch's pre-roll and post-roll unless the person says otherwise: two
 * seconds to find the performance before the range, one to land it after.
 */
export const DEFAULT_PUNCH_PRE_ROLL_SECONDS = 2;
export const DEFAULT_PUNCH_POST_ROLL_SECONDS = 1;

/**
 * How many monitoring preferences and calibrations are kept, the most recent
 * first: enough for every input and output a person moves between, and a
 * bound on what the settings take in storage.
 */
export const KEPT_PER_LIST = 32;

/** The settings a person starts with: Raw/Studio, no input chosen, no buffer, no count-in. */
export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  profiles: [RAW_STUDIO_PROFILE, VOICE_PROFILE],
  chosenProfile: RAW_STUDIO_PROFILE.name,
  input: undefined,
  retrospective: RETROSPECTIVE_OFF,
  countInSeconds: 0,
  punchPreRollSeconds: DEFAULT_PUNCH_PRE_ROLL_SECONDS,
  punchPostRollSeconds: DEFAULT_PUNCH_POST_ROLL_SECONDS,
  stopAfterSeconds: 0,
  monitoring: [],
  calibrations: [],
};

/** A revision of the settings: the next value, or why it is refused. */
export type RecordingRevision = (current: RecordingSettings) => DomainResult<RecordingSettings>;

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`recording-settings.${code}`, FailureKind.Rejected, summary));
}

/** The profile called `name`, where one is. */
export function profileNamed(
  settings: RecordingSettings,
  name: string,
): CaptureProfile | undefined {
  return settings.profiles.find((profile) => profile.name === name);
}

/** The profile an input is opened with: the chosen one, or Raw/Studio where it has gone. */
export function chosenProfileOf(settings: RecordingSettings): CaptureProfile {
  return profileNamed(settings, settings.chosenProfile) ?? RAW_STUDIO_PROFILE;
}

/** Chooses the profile called `name`. */
export function chooseProfile(name: string): RecordingRevision {
  return (current) => {
    if (profileNamed(current, name) === undefined) {
      return refused('profile-unknown', `There is no capture profile called ${name}.`);
    }
    return succeed(current.chosenProfile === name ? current : { ...current, chosenProfile: name });
  };
}

/**
 * Keeps the Custom profile `profile`, replacing the Custom one of its name,
 * and chooses it. A built-in profile's name is refused, since a Custom profile
 * of that name would be mistaken for it.
 */
export function keepCustomProfile(profile: CaptureProfile): RecordingRevision {
  return (current) => {
    if (profile.kind !== CaptureProfileKind.Custom) {
      return refused('profile-not-custom', 'Only a Custom profile is saved; the others are fixed.');
    }
    const holder = holderOf(
      current.profiles.map((one) => ({ id: one.name, displayName: one.name, profile: one })),
      profile.name,
    );
    if (holder !== undefined && holder.profile.kind !== CaptureProfileKind.Custom) {
      return refused(
        'profile-name-built-in',
        `${holder.profile.name} is a built-in profile's name; give the Custom profile another.`,
      );
    }
    if (
      holder !== undefined &&
      sameCustom(holder.profile, profile) &&
      current.chosenProfile === holder.profile.name
    ) {
      return succeed(current);
    }
    const profiles =
      holder === undefined
        ? [...current.profiles, profile]
        : current.profiles.map((one) => (one === holder.profile ? profile : one));
    return succeed({ ...current, profiles, chosenProfile: profile.name });
  };
}

/** Whether two profiles are one Custom profile: one name, one mark and the same processing. */
function sameCustom(one: CaptureProfile, other: CaptureProfile): boolean {
  if (one.kind !== CaptureProfileKind.Custom || other.kind !== CaptureProfileKind.Custom)
    return false;
  return (
    one.name === other.name &&
    one.headphones === other.headphones &&
    PROCESSING_CONTROLS.every((control) => one.processing[control] === other.processing[control])
  );
}

/**
 * Removes the Custom profile called `name`, with where monitoring was
 * remembered for it; Raw/Studio is chosen where it was the one in use.
 */
export function removeCustomProfile(name: string): RecordingRevision {
  return (current) => {
    const profile = profileNamed(current, name);
    if (profile === undefined) {
      return refused('profile-unknown', `There is no capture profile called ${name}.`);
    }
    if (profile.kind !== CaptureProfileKind.Custom) {
      return refused('profile-built-in', `${name} is built in, so it cannot be removed.`);
    }
    return succeed({
      ...current,
      profiles: current.profiles.filter((one) => one !== profile),
      chosenProfile:
        current.chosenProfile === name ? RAW_STUDIO_PROFILE.name : current.chosenProfile,
      monitoring: current.monitoring.filter((preference) => preference.profile !== name),
    });
  };
}

/** Marks the profile called `name` as used with headphones, or not. */
export function markHeadphones(name: string, headphones: boolean): RecordingRevision {
  return (current) => {
    const profile = profileNamed(current, name);
    if (profile === undefined) {
      return refused('profile-unknown', `There is no capture profile called ${name}.`);
    }
    if (profile.headphones === headphones) return succeed(current);
    const marked = withHeadphones(profile, headphones);
    return succeed({
      ...current,
      profiles: current.profiles.map((one) => (one === profile ? marked : one)),
    });
  };
}

/** Sets the retrospective buffer, already checked by `retrospectiveOn`. */
export function setRetrospective(setting: RetrospectiveSetting): RecordingRevision {
  return (current) => {
    const same =
      setting.on === current.retrospective.on &&
      (!setting.on ||
        (current.retrospective.on && setting.seconds === current.retrospective.seconds));
    return succeed(same ? current : { ...current, retrospective: setting });
  };
}

/** Why `seconds` is no count-in, or nothing where it is one. */
export function countInRefusal(seconds: number): string | undefined {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= LONGEST_COUNT_IN_SECONDS
    ? undefined
    : `A count-in lasts from 0 to ${String(LONGEST_COUNT_IN_SECONDS)} seconds.`;
}

/** Sets the count-in to `seconds`, from none to {@link LONGEST_COUNT_IN_SECONDS}. */
export function setCountIn(seconds: number): RecordingRevision {
  return (current) => {
    const refusal = countInRefusal(seconds);
    if (refusal !== undefined) return refused('count-in-out-of-range', refusal);
    return succeed(
      current.countInSeconds === seconds ? current : { ...current, countInSeconds: seconds },
    );
  };
}

/** Why `seconds` is no pre-roll or post-roll, or nothing where it is one. */
export function punchRollRefusal(seconds: number): string | undefined {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= LONGEST_PUNCH_ROLL_SECONDS
    ? undefined
    : `A punch's pre-roll and post-roll last from 0 to ${String(LONGEST_PUNCH_ROLL_SECONDS)} seconds.`;
}

/** Sets a punch's pre-roll and post-roll, in seconds. */
export function setPunchRolls(preRoll: number, postRoll: number): RecordingRevision {
  return (current) => {
    const refusal = punchRollRefusal(preRoll) ?? punchRollRefusal(postRoll);
    if (refusal !== undefined) return refused('punch-roll-out-of-range', refusal);
    return succeed(
      current.punchPreRollSeconds === preRoll && current.punchPostRollSeconds === postRoll
        ? current
        : { ...current, punchPreRollSeconds: preRoll, punchPostRollSeconds: postRoll },
    );
  };
}

/** Why `seconds` is no timed stop, or nothing where it is one; zero is none. */
export function timedStopRefusal(seconds: number): string | undefined {
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= LONGEST_TIMED_SECONDS
    ? undefined
    : `A timed recording lasts from 0, for no timed stop, to ${String(LONGEST_TIMED_SECONDS)} seconds.`;
}

/** Sets the seconds after which a recording stops by itself, zero for none. */
export function setTimedStop(seconds: number): RecordingRevision {
  return (current) => {
    const refusal = timedStopRefusal(seconds);
    if (refusal !== undefined) return refused('timed-stop-out-of-range', refusal);
    return succeed(
      current.stopAfterSeconds === seconds ? current : { ...current, stopAfterSeconds: seconds },
    );
  };
}

/** Remembers `device` as the input the person chose. */
export function rememberInput(device: DeviceIdentity): RecordingRevision {
  return (current) =>
    succeed(
      current.input?.id === device.id &&
        current.input.group === device.group &&
        current.input.label === device.label
        ? current
        : { ...current, input: device },
    );
}

/** The preference kept for `device` and the profile called `profile`, where one is. */
function preferenceFor(
  settings: RecordingSettings,
  device: DeviceIdentity,
  profile: string,
): MonitoringPreference | undefined {
  return settings.monitoring.find(
    (preference) => preference.profile === profile && isSameDevice(preference.device, device),
  );
}

/** Whether the person had monitoring on with `device` and the profile called `profile`. */
export function monitoringRemembered(
  settings: RecordingSettings,
  device: DeviceIdentity,
  profile: string,
): boolean {
  return preferenceFor(settings, device, profile)?.on ?? false;
}

/** Remembers whether monitoring is on with `device` and the profile called `profile`. */
export function preferMonitoring(
  device: DeviceIdentity,
  profile: string,
  on: boolean,
): RecordingRevision {
  return (current) => {
    const kept = preferenceFor(current, device, profile);
    if (kept?.on === on) return succeed(current);
    const others = current.monitoring.filter((preference) => preference !== kept);
    return succeed({
      ...current,
      monitoring: [{ device, profile, on }, ...others].slice(0, KEPT_PER_LIST),
    });
  };
}

/** The kept calibrations other than `path`'s. */
function othersThan(
  calibrations: readonly LatencyCalibration[],
  path: CalibrationPath,
): readonly LatencyCalibration[] {
  return calibrations.filter((one) => pathChanges(one, path).length > 0);
}

/** Keeps `calibration`, in place of the one of its path. */
export function keepCalibration(calibration: LatencyCalibration): RecordingRevision {
  return (current) =>
    succeed({
      ...current,
      calibrations: [calibration, ...othersThan(current.calibrations, calibration)].slice(
        0,
        KEPT_PER_LIST,
      ),
    });
}

/**
 * Sets the manual offset of `path`'s calibration to `frames`: on its measured
 * calibration where one is kept, or as a calibration of its own.
 */
export function setManualOffset(path: CalibrationPath, frames: number): RecordingRevision {
  return (current) => {
    const kept = current.calibrations.find((one) => pathChanges(one, path).length === 0);
    const next =
      kept === undefined ? manualCalibration(path, frames) : withManualOffset(kept, frames);
    if (!next.ok) return next;
    if (kept?.manualOffset === frames) return succeed(current);
    return keepCalibration(next.value)(current);
  };
}

/** Forgets the calibration of `path`. */
export function forgetCalibration(path: CalibrationPath): RecordingRevision {
  return (current) => {
    const calibrations = othersThan(current.calibrations, path);
    if (calibrations.length === current.calibrations.length) {
      return refused(
        'calibration-missing',
        'No calibration is kept for this input, output and sample rate.',
      );
    }
    return succeed({ ...current, calibrations });
  };
}
