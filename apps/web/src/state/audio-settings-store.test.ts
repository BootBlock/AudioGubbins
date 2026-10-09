import { describe, expect, it, vi } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  PRESET_SETTINGS,
  PerformanceProfile,
  ProcessingMode,
  SchedulingPolicy,
} from '@audiogubbins/audio-engine';
import {
  MAXIMUM_QUALITY,
  QualityLevel,
  ResamplingGrade,
  namedQualityMode,
} from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import {
  AUDIO_SETTINGS_KEY,
  createAudioSettingsStore,
  previewQualityOf,
} from './audio-settings-store.js';
import { PersistedPart, createStateStorage, type KeyValueStorage } from './state-storage.js';
import { DEFAULT_RECORDING_SETTINGS } from './recording-settings.js';

const BALANCED = PRESET_SETTINGS[PerformanceProfile.Balanced];
const DRAFT = namedQualityMode(QualityLevel.Draft);
const HIGH = namedQualityMode(QualityLevel.High);
const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');

function stored(fields: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSIONS.audioSettings, ...fields });
}

function storeOver(raw: KeyValueStorage = ephemeralStorage()) {
  const storage = createStateStorage(raw, logger, () => undefined);
  return { store: createAudioSettingsStore(storage, logger), storage, raw };
}

/** The settings a store reads from `text` stored under its key, or from nothing. */
function readAudioSettings(text: string | null) {
  const raw = ephemeralStorage();
  if (text !== null) raw.write(AUDIO_SETTINGS_KEY, text);
  return storeOver(raw).store.get();
}

describe('reading stored audio settings', () => {
  it('starts Balanced, interactive work first, choosing render modes automatically, rendering at the highest quality and previewing at the profile’s', () => {
    expect(readAudioSettings(null)).toEqual({
      chosen: { profile: PerformanceProfile.Balanced, settings: BALANCED },
      custom: BALANCED,
      priorityPolicy: SchedulingPolicy.InteractiveFirst,
      renderMode: undefined,
      renderQuality: MAXIMUM_QUALITY,
      previewQuality: undefined,
      recording: DEFAULT_RECORDING_SETTINGS,
    });
  });

  it('reads back a Custom profile in force, with its settings', () => {
    const custom = {
      latencyHint: 'playback',
      feedAheadMilliseconds: 600,
      backgroundConcurrencyWhileInteractive: 4,
      renderChunkMilliseconds: 50,
    };
    const read = readAudioSettings(
      stored({
        profile: 'custom',
        custom,
        priorityPolicy: 'throughput',
        renderMode: 'background-offline',
        renderQuality: DRAFT.settings,
        previewQuality: HIGH.settings,
      }),
    );
    expect(read).toEqual({
      chosen: { profile: PerformanceProfile.Custom, settings: custom },
      custom,
      priorityPolicy: SchedulingPolicy.Throughput,
      renderMode: ProcessingMode.BackgroundOffline,
      renderQuality: DRAFT,
      previewQuality: HIGH,
      recording: DEFAULT_RECORDING_SETTINGS,
    });
  });

  it('keeps each valid quality setting, and takes only a spoiled one from the default', () => {
    const read = readAudioSettings(
      stored({
        profile: 'low-latency',
        // A setting no build reads any longer is left aside, not a spoiled record.
        renderQuality: {
          resampling: ResamplingGrade.Draft,
          oversampling: 3,
          spectralOverlap: 2,
          inference: 'pinned',
        },
        previewQuality: { ...HIGH.settings, spectralOverlap: 'many' },
      }),
    );
    // The render's spoiled oversampling is the highest quality's, and the
    // preview's spoiled settings are those the profile previews at.
    expect(read.renderQuality).toEqual({
      level: QualityLevel.Custom,
      settings: {
        resampling: ResamplingGrade.Draft,
        oversampling: 8,
        spectralOverlap: 2,
      },
    });
    expect(read.previewQuality).toEqual({
      level: QualityLevel.Custom,
      settings: { ...HIGH.settings, spectralOverlap: 2 },
    });
  });

  it('follows the profile where no preview quality was stored, or what was is not settings', () => {
    expect(readAudioSettings(stored({})).previewQuality).toBeUndefined();
    expect(readAudioSettings(stored({ previewQuality: 'high' })).previewQuality).toBeUndefined();
    expect(readAudioSettings(stored({ renderQuality: 'draft' })).renderQuality).toBe(
      MAXIMUM_QUALITY,
    );
  });

  it('keeps each valid field and replaces only the invalid ones with the default', () => {
    const read = readAudioSettings(
      stored({
        profile: 'custom',
        custom: {
          latencyHint: 'instant',
          feedAheadMilliseconds: 300,
          backgroundConcurrencyWhileInteractive: 0.5,
          renderChunkMilliseconds: -10,
        },
        priorityPolicy: 'whenever',
        renderMode: 'real-time',
      }),
    );
    expect(read.custom).toEqual({ ...BALANCED, feedAheadMilliseconds: 300 });
    expect(read.priorityPolicy).toBe(SchedulingPolicy.InteractiveFirst);
    // A final render never runs live, so a stored real-time mode is not taken.
    expect(read.renderMode).toBeUndefined();
  });

  it('takes a latency in seconds only where it is usable', () => {
    const at = (latencyHint: unknown) =>
      readAudioSettings(stored({ custom: { latencyHint } })).custom.latencyHint;
    expect(at(0.015)).toBe(0.015);
    expect(at(0)).toBe(BALANCED.latencyHint);
    expect(at('0.015')).toBe(BALANCED.latencyHint);
  });

  it.each([
    ['text that is not JSON', '{"schemaVersion":'],
    ['JSON that is not settings', '[1, 2]'],
    ['settings of another version', JSON.stringify({ schemaVersion: 99, profile: 'custom' })],
    // Before 1.0 a stored format of another version is not migrated (REQ-STOR-052).
    [
      'settings from before the quality modes',
      JSON.stringify({ schemaVersion: 1, profile: 'custom' }),
    ],
    ['an unknown profile', stored({ profile: 'turbo' })],
  ])('falls back to the defaults for %s', (_case, text) => {
    const read = readAudioSettings(text);
    expect(read.chosen.profile).toBe(PerformanceProfile.Balanced);
  });
});

describe('the audio settings store', () => {
  it('writes every change back under its own key and part, and reads it back', () => {
    const { store, raw } = storeOver();
    store.chooseProfile(PerformanceProfile.LowLatency);
    store.choosePriorityPolicy(SchedulingPolicy.Throughput);
    expect(store.chooseRenderMode(ProcessingMode.FinalOffline)).toBeUndefined();

    const again = storeOver(raw).store.get();
    expect(again.chosen.profile).toBe(PerformanceProfile.LowLatency);
    expect(again.priorityPolicy).toBe(SchedulingPolicy.Throughput);
    expect(again.renderMode).toBe(ProcessingMode.FinalOffline);
  });

  it('writes the quality modes as their settings, and reads them back', () => {
    const { store, raw } = storeOver();
    const custom = {
      level: QualityLevel.Custom,
      settings: { ...HIGH.settings, oversampling: 8 as const },
    };
    store.chooseRenderQuality(DRAFT);
    store.choosePreviewQuality(custom);

    const again = storeOver(raw).store.get();
    expect(again.renderQuality).toEqual(DRAFT);
    expect(again.previewQuality).toEqual(custom);
    expect(raw.read(AUDIO_SETTINGS_KEY)).toContain(
      '"previewQuality":{"resampling":"high","oversampling":8,"spectralOverlap":4}',
    );
    expect(raw.read(AUDIO_SETTINGS_KEY)).toContain(
      `"schemaVersion":${String(SCHEMA_VERSIONS.audioSettings)}`,
    );
  });

  it('previews at the profile’s quality until one is chosen, and at the one chosen after', () => {
    const { store } = storeOver();
    expect(previewQualityOf(store.get()).level).toBe(QualityLevel.Standard);
    store.chooseProfile(PerformanceProfile.LowLatency);
    expect(previewQualityOf(store.get()).level).toBe(QualityLevel.Draft);

    store.choosePreviewQuality(HIGH);
    store.chooseProfile(PerformanceProfile.MaximumStability);
    expect(previewQualityOf(store.get()).level).toBe(QualityLevel.High);

    store.choosePreviewQuality(undefined);
    expect(previewQualityOf(store.get()).level).toBe(QualityLevel.High);
    expect(store.get().previewQuality).toBeUndefined();
  });

  it('makes a new quality mode only when its settings change', () => {
    const { store } = storeOver();
    store.choosePreviewQuality(HIGH);
    const render = store.get().renderQuality;
    const preview = store.get().previewQuality;
    const automatic = previewQualityOf({ ...store.get(), previewQuality: undefined });

    store.chooseRenderQuality(namedQualityMode(QualityLevel.Maximum));
    store.choosePreviewQuality(namedQualityMode(QualityLevel.High));
    expect(store.get().renderQuality).toBe(render);
    expect(store.get().previewQuality).toBe(preview);

    store.choosePreviewQuality(undefined);
    expect(previewQualityOf(store.get())).toBe(automatic);
  });

  it('keeps the Custom settings while a preset is in force, and restores them with Custom', () => {
    const { store } = storeOver();
    const custom = { ...BALANCED, feedAheadMilliseconds: 900 };
    expect(store.setCustom(custom)).toBeUndefined();
    expect(store.get().chosen.profile).toBe(PerformanceProfile.Balanced);

    store.chooseProfile(PerformanceProfile.Custom);

    expect(store.get().chosen).toEqual({ profile: PerformanceProfile.Custom, settings: custom });
  });

  it('makes a new chosen profile only when the profile or its settings change', () => {
    const { store } = storeOver();
    const balanced = store.get().chosen;
    store.chooseProfile(PerformanceProfile.LowLatency);
    store.chooseProfile(PerformanceProfile.Balanced);
    expect(store.get().chosen).toBe(balanced);

    store.chooseProfile(PerformanceProfile.Custom);
    const custom = store.get().chosen;
    store.choosePriorityPolicy(SchedulingPolicy.Throughput);
    store.setCustom({ ...BALANCED });
    expect(store.get().chosen).toBe(custom);

    store.setCustom({ ...BALANCED, renderChunkMilliseconds: 20 });
    expect(store.get().chosen).not.toBe(custom);
  });

  it('refuses invalid Custom settings with every reason, and keeps what it had', () => {
    const { store } = storeOver();
    const refused = store.setCustom({
      latencyHint: -1,
      feedAheadMilliseconds: Number.NaN,
      backgroundConcurrencyWhileInteractive: 0,
      renderChunkMilliseconds: 10,
    });
    expect(refused).toHaveLength(3);
    expect(store.get().custom).toBe(BALANCED);
  });

  it('refuses a render mode a render cannot run in', () => {
    const { store } = storeOver();
    expect(store.chooseRenderMode(ProcessingMode.CachedPreview)).toEqual([
      'A render always runs offline, in the foreground or in the background.',
    ]);
    expect(store.get().renderMode).toBeUndefined();
  });

  it('tells nobody, and writes nothing, when a choice changes nothing', () => {
    const { store, raw } = storeOver();
    const write = vi.spyOn(raw, 'write');
    const heard = vi.fn();
    store.subscribe(heard);

    store.chooseProfile(PerformanceProfile.Balanced);
    store.choosePriorityPolicy(SchedulingPolicy.InteractiveFirst);
    store.chooseRenderMode(undefined);
    store.setCustom({ ...BALANCED });
    store.chooseRenderQuality(namedQualityMode(QualityLevel.Maximum));
    store.choosePreviewQuality(undefined);

    expect(heard).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps working, and says the settings are not being saved, when storage refuses', () => {
    const raw = ephemeralStorage();
    const { store, storage } = storeOver({
      ...raw,
      write: () => {
        throw new Error('Quota exceeded.');
      },
    });

    store.chooseProfile(PerformanceProfile.MaximumStability);

    expect(store.get().chosen.profile).toBe(PerformanceProfile.MaximumStability);
    expect(storage.get().unsaved).toEqual([PersistedPart.AudioSettings]);
    expect(raw.read(AUDIO_SETTINGS_KEY)).toBeNull();
  });
});
