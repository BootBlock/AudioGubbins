import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { derivedSampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  RAW_STUDIO_PROFILE,
  UNKNOWN_OUTPUT,
  calibrationOf,
  customProfile,
  measuredCalibration,
  retrospectiveOn,
  type CalibrationPath,
} from '@audiogubbins/recording';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { AUDIO_SETTINGS_KEY, createAudioSettingsStore } from './audio-settings-store.js';
import {
  DEFAULT_RECORDING_SETTINGS,
  chooseProfile,
  forgetCalibration,
  keepCalibration,
  keepCustomProfile,
  markHeadphones,
  monitoringRemembered,
  preferMonitoring,
  rememberInput,
  removeCustomProfile,
  setCountIn,
  setManualOffset,
  setRetrospective,
} from './recording-settings.js';
import { createStateStorage, type KeyValueStorage } from './state-storage.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');
const INTERFACE = { id: 'interface', group: 'interface-group', label: 'Studio interface' };
const PATH: CalibrationPath = {
  input: INTERFACE,
  output: { kind: 'known', device: { id: 'speakers', group: 'laptop', label: 'Speakers' } },
  rate: expectSuccess(sampleRate(48_000)),
};
const CLOSE_MIC = expectSuccess(
  customProfile(
    'Close mic',
    {
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
      voiceIsolation: false,
    },
    true,
  ),
);

function storeOver(raw: KeyValueStorage = ephemeralStorage()) {
  return createAudioSettingsStore(
    createStateStorage(raw, logger, () => undefined),
    logger,
  );
}

/** The recording settings read back from `recording` stored as they are. */
function readBack(recording: unknown) {
  const raw = ephemeralStorage();
  raw.write(
    AUDIO_SETTINGS_KEY,
    JSON.stringify({ schemaVersion: SCHEMA_VERSIONS.audioSettings, recording }),
  );
  return storeOver(raw).get().recording;
}

describe('the recording settings', () => {
  it('start with Raw/Studio, no input chosen, no buffer, no count-in and no calibration', () => {
    expect(storeOver().get().recording).toEqual(DEFAULT_RECORDING_SETTINGS);
    expect(DEFAULT_RECORDING_SETTINGS.chosenProfile).toBe(RAW_STUDIO_PROFILE.name);
  });

  it('are written as they change and read back whole', () => {
    const raw = ephemeralStorage();
    const store = storeOver(raw);
    const calibration = expectSuccess(
      measuredCalibration(
        PATH,
        { roundTrip: derivedSampleCount(2400), peakRatio: 30 },
        0.025,
        1000,
      ),
    );
    for (const revise of [
      keepCustomProfile(CLOSE_MIC),
      markHeadphones('Voice', true),
      setRetrospective(expectSuccess(retrospectiveOn(20))),
      setCountIn(4),
      rememberInput(INTERFACE),
      preferMonitoring(INTERFACE, 'Close mic', true),
      keepCalibration(calibration),
      setManualOffset(PATH, 48),
    ]) {
      expectSuccess(store.reviseRecording(revise));
    }
    expect(storeOver(raw).get().recording).toEqual(store.get().recording);
    expect(store.get().recording.chosenProfile).toBe('Close mic');
    expect(store.get().recording.calibrations[0]?.manualOffset).toBe(48);
  });

  it('keep a calibration of the unknown output apart from one of a named output, and drop an output of no kind', () => {
    const unknown: CalibrationPath = { ...PATH, output: UNKNOWN_OUTPUT };
    const read = readBack({
      calibrations: [
        { ...unknown, manualOffset: 12 },
        { ...PATH, manualOffset: 24 },
        { ...PATH, output: { id: 'default' }, manualOffset: 36 },
      ],
    });
    expect(read.calibrations.map((one) => [one.output.kind, one.manualOffset])).toEqual([
      ['unknown', 12],
      ['known', 24],
    ]);
    expect(calibrationOf(read.calibrations, unknown)?.manualOffset).toBe(12);
    expect(calibrationOf(read.calibrations, PATH)?.manualOffset).toBe(24);
  });

  it('refuse a revision with the reason and change nothing, writing nothing', () => {
    const raw = ephemeralStorage();
    const store = storeOver(raw);
    const before = store.get();
    const builtInName = expectSuccess(
      customProfile(
        'Voice',
        {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          voiceIsolation: false,
        },
        false,
      ),
    );
    for (const [revise, code] of [
      [keepCustomProfile(builtInName), 'recording-settings.profile-name-built-in'],
      [removeCustomProfile('Raw/Studio'), 'recording-settings.profile-built-in'],
      [chooseProfile('Nothing like it'), 'recording-settings.profile-unknown'],
      [setCountIn(11), 'recording-settings.count-in-out-of-range'],
      [forgetCalibration(PATH), 'recording-settings.calibration-missing'],
      [setManualOffset(PATH, 1.5), 'recording.offset-not-whole'],
    ] as const) {
      const refused = store.reviseRecording(revise);
      expect(refused.ok ? undefined : refused.failures[0].code).toBe(code);
    }
    expect(store.get()).toBe(before);
    expect(raw.read(AUDIO_SETTINGS_KEY)).toBeNull();
  });

  it('keep the same object, and write nothing, for a revision that changes nothing', () => {
    const raw = ephemeralStorage();
    const store = storeOver(raw);
    const before = store.get();
    expectSuccess(store.reviseRecording(chooseProfile(RAW_STUDIO_PROFILE.name)));
    expectSuccess(store.reviseRecording(setCountIn(0)));
    expect(store.get()).toBe(before);
    expect(raw.read(AUDIO_SETTINGS_KEY)).toBeNull();
  });

  it('choose Raw/Studio again, and forget its monitoring preference, when the Custom profile in use is removed', () => {
    const store = storeOver();
    expectSuccess(store.reviseRecording(keepCustomProfile(CLOSE_MIC)));
    expectSuccess(store.reviseRecording(preferMonitoring(INTERFACE, 'Close mic', true)));
    expectSuccess(store.reviseRecording(removeCustomProfile('Close mic')));
    const { recording } = store.get();
    expect(recording.chosenProfile).toBe(RAW_STUDIO_PROFILE.name);
    expect(monitoringRemembered(recording, INTERFACE, 'Close mic')).toBe(false);
  });

  it('remember a monitoring preference for a device found again by its group and label', () => {
    const store = storeOver();
    expectSuccess(store.reviseRecording(preferMonitoring(INTERFACE, 'Raw/Studio', true)));
    const renumbered = { ...INTERFACE, id: 'another-identifier' };
    expect(monitoringRemembered(store.get().recording, renumbered, 'Raw/Studio')).toBe(true);
  });

  it('read each field apart, so a spoiled one costs that field and no other', () => {
    const read = readBack({
      profiles: [
        { kind: 'voice', headphones: true },
        {
          kind: 'custom',
          name: 'Close mic',
          headphones: true,
          processing: CLOSE_MIC.kind === 'custom' ? CLOSE_MIC.processing : {},
        },
        { kind: 'custom', name: '', processing: {} },
        { kind: 'custom', name: 'Half made', processing: { echoCancellation: true } },
      ],
      chosenProfile: 'Close mic',
      retrospective: { on: true, seconds: 600 },
      countInSeconds: 'three',
      input: INTERFACE,
      monitoring: [
        { device: INTERFACE, profile: 'Close mic', on: true },
        { device: INTERFACE, profile: 'A profile long gone', on: true },
      ],
      calibrations: [
        { ...PATH, manualOffset: 12 },
        {
          ...PATH,
          manualOffset: 0,
          measured: { roundTrip: 100, output: 90, input: 20, peakRatio: 20, at: 0 },
        },
        { ...PATH, rate: -1, manualOffset: 0 },
      ],
    });
    expect(read.profiles.map((one) => [one.name, one.headphones])).toEqual([
      ['Raw/Studio', false],
      ['Voice', true],
      ['Close mic', true],
    ]);
    expect(read.chosenProfile).toBe('Close mic');
    expect(read.retrospective).toEqual({ on: false });
    expect(read.countInSeconds).toBe(0);
    expect(read.input).toEqual(INTERFACE);
    expect(read.monitoring).toEqual([{ device: INTERFACE, profile: 'Close mic', on: true }]);
    // A measurement whose shares do not add up to its round trip is not trusted.
    expect(read.calibrations.map((one) => one.manualOffset)).toEqual([12]);
  });
});
