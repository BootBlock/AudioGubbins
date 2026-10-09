/**
 * The recording settings as they are written into the audio settings, and read
 * back field by field and entry by entry (`ADR-0070`).
 *
 * Storage is a trust boundary: another version, another tab or a hand edit may
 * have put anything there. So each field is taken only where it reads, and each
 * profile, preference and calibration of a list only where it does, through the
 * recording package's own rules, so a spoiled entry costs the person that entry
 * and not the list. Raw/Studio and Voice are always there, first: only whether
 * the person marked them for headphones is read.
 */

import { sampleCount, sampleRate, type SampleCount } from '@audiogubbins/domain';
import {
  CaptureProfileKind,
  RAW_STUDIO_PROFILE,
  RETROSPECTIVE_OFF,
  VOICE_PROFILE,
  customProfile,
  manualCalibration,
  retrospectiveOn,
  withHeadphones,
  type CaptureProfile,
  type DeviceIdentity,
  type LatencyCalibration,
  type MeasuredLatency,
  type ProcessingChoice,
  type RetrospectiveSetting,
} from '@audiogubbins/recording';

import {
  DEFAULT_RECORDING_SETTINGS,
  KEPT_PER_LIST,
  countInRefusal,
  type MonitoringPreference,
  type RecordingSettings,
} from './recording-settings.js';
import { isRecord } from './stored-value.js';

/** A stored list, or none where the value is not one; at most {@link KEPT_PER_LIST} entries are read. */
function listOf(value: unknown, most: number = Number.POSITIVE_INFINITY): readonly unknown[] {
  return Array.isArray(value) ? value.slice(0, most) : [];
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A stored device identity, where it has an identifier. */
function deviceOf(value: unknown): DeviceIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const id = value['id'];
  if (typeof id !== 'string') return undefined;
  const group = textOf(value['group']);
  const label = textOf(value['label']);
  return {
    id,
    ...(group === undefined ? {} : { group }),
    ...(label === undefined ? {} : { label }),
  };
}

/** Whether a built-in profile is marked for headphones, as stored. */
function builtInMark(profiles: readonly unknown[], kind: CaptureProfileKind): boolean {
  const stored = profiles.find((one) => isRecord(one) && one['kind'] === kind);
  return isRecord(stored) && stored['headphones'] === true;
}

function processingOf(value: unknown): ProcessingChoice | undefined {
  if (!isRecord(value)) return undefined;
  const { echoCancellation, noiseSuppression, autoGainControl, voiceIsolation } = value;
  return typeof echoCancellation === 'boolean' &&
    typeof noiseSuppression === 'boolean' &&
    typeof autoGainControl === 'boolean' &&
    typeof voiceIsolation === 'boolean'
    ? { echoCancellation, noiseSuppression, autoGainControl, voiceIsolation }
    : undefined;
}

/** A stored Custom profile, where its name and every control read. */
function customOf(value: unknown): CaptureProfile | undefined {
  if (!isRecord(value) || value['kind'] !== CaptureProfileKind.Custom) return undefined;
  const processing = processingOf(value['processing']);
  if (processing === undefined) return undefined;
  const made = customProfile(value['name'], processing, value['headphones'] === true);
  return made.ok ? made.value : undefined;
}

/** Raw/Studio and Voice as marked, then each Custom profile that reads and whose name is free. */
function profilesOf(value: unknown): readonly CaptureProfile[] {
  const stored = listOf(value);
  const profiles: CaptureProfile[] = [
    withHeadphones(RAW_STUDIO_PROFILE, builtInMark(stored, CaptureProfileKind.RawStudio)),
    withHeadphones(VOICE_PROFILE, builtInMark(stored, CaptureProfileKind.Voice)),
  ];
  for (const entry of stored) {
    const custom = customOf(entry);
    if (custom !== undefined && !profiles.some((one) => one.name === custom.name)) {
      profiles.push(custom);
    }
  }
  return profiles;
}

function retrospectiveOf(value: unknown): RetrospectiveSetting {
  if (!isRecord(value) || value['on'] !== true) return RETROSPECTIVE_OFF;
  const seconds = value['seconds'];
  if (typeof seconds !== 'number') return RETROSPECTIVE_OFF;
  const setting = retrospectiveOn(seconds);
  return setting.ok ? setting.value : RETROSPECTIVE_OFF;
}

function monitoringOf(
  value: unknown,
  profiles: readonly CaptureProfile[],
): readonly MonitoringPreference[] {
  return listOf(value, KEPT_PER_LIST).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const device = deviceOf(entry['device']);
    const profile = entry['profile'];
    const on = entry['on'];
    if (device === undefined || typeof on !== 'boolean') return [];
    if (!profiles.some((one) => one.name === profile) || typeof profile !== 'string') return [];
    return [{ device, profile, on }];
  });
}

function countOf(value: unknown): SampleCount | undefined {
  if (typeof value !== 'number') return undefined;
  const count = sampleCount(value);
  return count.ok ? count.value : undefined;
}

/** A stored measurement, where its counts are whole and its input share is the round trip less the output. */
function measuredOf(value: unknown): MeasuredLatency | undefined {
  if (!isRecord(value)) return undefined;
  const roundTrip = countOf(value['roundTrip']);
  const output = countOf(value['output']);
  const input = countOf(value['input']);
  const peakRatio = value['peakRatio'];
  const at = value['at'];
  if (roundTrip === undefined || output === undefined || input === undefined) return undefined;
  if (typeof peakRatio !== 'number' || !Number.isFinite(peakRatio)) return undefined;
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  return roundTrip === output + input ? { roundTrip, output, input, peakRatio, at } : undefined;
}

function calibrationOf(value: unknown): LatencyCalibration | undefined {
  if (!isRecord(value)) return undefined;
  const input = deviceOf(value['input']);
  const output = deviceOf(value['output']);
  const storedRate = value['rate'];
  const offset = value['manualOffset'];
  if (input === undefined || output === undefined || typeof storedRate !== 'number')
    return undefined;
  const rate = sampleRate(storedRate);
  if (!rate.ok || typeof offset !== 'number') return undefined;
  const calibration = manualCalibration({ input, output, rate: rate.value }, offset);
  if (!calibration.ok) return undefined;
  const stored = value['measured'];
  if (stored === undefined) return calibration.value;
  const measured = measuredOf(stored);
  return measured === undefined ? undefined : { ...calibration.value, measured };
}

/** The recording settings stored in `value`, each field and entry taken only where it reads. */
export function readRecordingSettings(value: unknown): RecordingSettings {
  if (!isRecord(value)) return DEFAULT_RECORDING_SETTINGS;
  const profiles = profilesOf(value['profiles']);
  const chosen = value['chosenProfile'];
  const countIn = value['countInSeconds'];
  const input = deviceOf(value['input']);
  return {
    profiles,
    chosenProfile:
      typeof chosen === 'string' && profiles.some((one) => one.name === chosen)
        ? chosen
        : RAW_STUDIO_PROFILE.name,
    input,
    retrospective: retrospectiveOf(value['retrospective']),
    countInSeconds:
      typeof countIn === 'number' && countInRefusal(countIn) === undefined ? countIn : 0,
    monitoring: monitoringOf(value['monitoring'], profiles),
    calibrations: listOf(value['calibrations'], KEPT_PER_LIST).flatMap((entry) => {
      const calibration = calibrationOf(entry);
      return calibration === undefined ? [] : [calibration];
    }),
  };
}

/** A profile as it is written: a built-in one by its kind and mark alone. */
function storedProfile(profile: CaptureProfile): Readonly<Record<string, unknown>> {
  return profile.kind === CaptureProfileKind.Custom
    ? profile
    : { kind: profile.kind, headphones: profile.headphones };
}

/** The recording settings as they are written into the audio settings. */
export function storedRecordingSettings(
  settings: RecordingSettings,
): Readonly<Record<string, unknown>> {
  return {
    profiles: settings.profiles.map(storedProfile),
    chosenProfile: settings.chosenProfile,
    ...(settings.input === undefined ? {} : { input: settings.input }),
    retrospective: settings.retrospective,
    countInSeconds: settings.countInSeconds,
    monitoring: settings.monitoring,
    calibrations: settings.calibrations,
  };
}
