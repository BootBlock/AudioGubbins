/**
 * Writing and reading how an asset was recorded (`recorded-provenance.ts`),
 * by one rule wherever it is kept: on an asset's provenance, and the part
 * known at its start in a recovery manifest. A recording's rate, layout and
 * length are held to agree with the asset made of it, as an imported file's
 * audio shape is.
 */

import { AssetOrigin, MAXIMUM_CHANNEL_COUNT, layoutsMatch, type Asset } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import {
  objectOf,
  optional,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers } from './document-writing.js';
import {
  CaptureProfileKind,
  RecordingEnding,
  type CaptureSettings,
  type RecordedDevice,
  type RecordedProfile,
  type RecordedProvenance,
  type RecordingStart,
} from './recorded-provenance.js';
import {
  asBoolean,
  integerConverter,
  numberConverter,
  oneOfConverter,
  textConverter,
} from './scalar-reading.js';
import { writeLayout } from './value-writing.js';
import {
  asChannelLayout,
  asName,
  asSampleCount,
  asSampleRate,
  asWholeQuantity,
} from './value-reading.js';

const START_MEMBERS = [
  'recordedAt',
  'device',
  'profile',
  'requested',
  'granted',
  'sampleRate',
  'layout',
] as const;
const START_MEMBER_SET: ReadonlySet<string> = new Set(START_MEMBERS);
const RECORDING_MEMBERS: ReadonlySet<string> = new Set([...START_MEMBERS, 'length', 'ending']);
const DEVICE_MEMBERS: ReadonlySet<string> = new Set(['label', 'group', 'channelCount']);
const PROFILE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'name']);
const SETTINGS_MEMBERS: ReadonlySet<string> = new Set([
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
  'voiceIsolation',
  'channelCount',
  'sampleRate',
  'sampleSize',
  'latency',
]);

/** A browser's group of a device: an opaque token of its own. */
const asDeviceGroup = textConverter({ maximumLength: 256 });
const asChannelCount = integerConverter(1, MAXIMUM_CHANNEL_COUNT);
const asSampleSize = integerConverter(1, 64);

/** A latency in seconds, which no input has of a minute. */
const asLatency = numberConverter(0, 60);
const asProfileKind = oneOfConverter(Object.values(CaptureProfileKind));
const asEnding = oneOfConverter(Object.values(RecordingEnding));

/** Writes capture settings, each where it is present. */
function writeSettings(settings: CaptureSettings): JsonObject {
  return presentMembers({
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    voiceIsolation: settings.voiceIsolation,
    channelCount: settings.channelCount,
    sampleRate: settings.sampleRate,
    sampleSize: settings.sampleSize,
    latency: settings.latency,
  });
}

/** Writes what is known of a recording as it starts. */
export function writeRecordingStart(start: RecordingStart): JsonObject {
  return {
    recordedAt: start.recordedAt,
    device: presentMembers({
      label: start.device.label,
      group: start.device.group,
      channelCount: start.device.channelCount,
    }),
    profile: { kind: start.profile.kind, name: start.profile.name },
    requested: writeSettings(start.requested),
    granted: writeSettings(start.granted),
    sampleRate: start.sampleRate,
    layout: writeLayout(start.layout),
  };
}

/** Writes how an asset was recorded. */
export function writeRecordedProvenance(recording: RecordedProvenance): JsonObject {
  return { ...writeRecordingStart(recording), length: recording.length, ending: recording.ending };
}

const readDevice: Converter<RecordedDevice> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, DEVICE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const label = optional(reading, object, at, 'label', asName);
  const group = optional(reading, object, at, 'group', asDeviceGroup);
  const channelCount = optional(reading, object, at, 'channelCount', asChannelCount);
  return {
    ...(label === undefined ? {} : { label }),
    ...(group === undefined ? {} : { group }),
    ...(channelCount === undefined ? {} : { channelCount }),
  };
};

const readProfile: Converter<RecordedProfile> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, PROFILE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asProfileKind);
  const name = required(reading, object, at, 'name', asName);
  return kind === undefined || name === undefined ? undefined : { kind, name };
};

const readSettings: Converter<CaptureSettings> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SETTINGS_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const flag = (name: string) => optional(reading, object, at, name, asBoolean);
  const echoCancellation = flag('echoCancellation');
  const noiseSuppression = flag('noiseSuppression');
  const autoGainControl = flag('autoGainControl');
  const voiceIsolation = flag('voiceIsolation');
  const channelCount = optional(reading, object, at, 'channelCount', asChannelCount);
  const sampleRate = optional(reading, object, at, 'sampleRate', asSampleRate);
  const sampleSize = optional(reading, object, at, 'sampleSize', asSampleSize);
  const latency = optional(reading, object, at, 'latency', asLatency);
  return {
    ...(echoCancellation === undefined ? {} : { echoCancellation }),
    ...(noiseSuppression === undefined ? {} : { noiseSuppression }),
    ...(autoGainControl === undefined ? {} : { autoGainControl }),
    ...(voiceIsolation === undefined ? {} : { voiceIsolation }),
    ...(channelCount === undefined ? {} : { channelCount }),
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(sampleSize === undefined ? {} : { sampleSize }),
    ...(latency === undefined ? {} : { latency }),
  };
};

/** Reads the members a recording's start holds from `object`, at `at`. */
function startMembers(
  reading: Reading,
  object: JsonObject,
  at: string,
): RecordingStart | undefined {
  const recordedAt = required(reading, object, at, 'recordedAt', asWholeQuantity);
  const device = required(reading, object, at, 'device', readDevice);
  const profile = required(reading, object, at, 'profile', readProfile);
  const requested = required(reading, object, at, 'requested', readSettings);
  const granted = required(reading, object, at, 'granted', readSettings);
  const sampleRate = required(reading, object, at, 'sampleRate', asSampleRate);
  const layout = required(reading, object, at, 'layout', asChannelLayout);
  return recordedAt === undefined ||
    device === undefined ||
    profile === undefined ||
    requested === undefined ||
    granted === undefined ||
    sampleRate === undefined ||
    layout === undefined
    ? undefined
    : { recordedAt, device, profile, requested, granted, sampleRate, layout };
}

/** Reads what is known of a recording as it starts. */
export const readRecordingStart: Converter<RecordingStart> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, START_MEMBER_SET);
  return object === undefined ? undefined : startMembers(reading, object, pathOf(parent, key));
};

/** Reads how an asset was recorded. */
export const readRecordedProvenance: Converter<RecordedProvenance> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, RECORDING_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const start = startMembers(reading, object, at);
  const length = required(reading, object, at, 'length', asSampleCount);
  const ending = required(reading, object, at, 'ending', asEnding);
  return start === undefined || length === undefined || ending === undefined
    ? undefined
    : { ...start, length, ending };
};

/**
 * Checks how an asset was recorded, at `at`, against the asset: it must be a
 * recorded asset, at the rate and in the layout it was recorded in, as long
 * as the recording. True where it agrees.
 */
export function checkRecordingAgainstAsset(
  reading: Reading,
  recording: RecordedProvenance,
  asset: Asset,
  at: string,
): boolean {
  const refuse = (code: string, summary: string, member: string): false => {
    reading.refuse(code, summary, pathOf(at, member), { assetId: asset.id });
    return false;
  };
  if (asset.origin !== AssetOrigin.Recorded) {
    return refuse(
      'source.recording-not-recorded',
      'Only a recorded asset says how it was recorded.',
      'recordedAt',
    );
  }
  if (recording.sampleRate !== asset.sampleRate) {
    return refuse(
      'source.recording-rate-mismatch',
      'The recording’s sample rate is not its asset’s.',
      'sampleRate',
    );
  }
  if (!layoutsMatch(recording.layout, asset.channelLayout)) {
    return refuse(
      'source.recording-layout-mismatch',
      'The recording’s channels are not its asset’s.',
      'layout',
    );
  }
  return recording.length === asset.length
    ? true
    : refuse(
        'source.recording-length-mismatch',
        'The asset is not as long as its recording.',
        'length',
      );
}
