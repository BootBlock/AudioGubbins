/**
 * The person's preferences across a reload: the theme's choices, the pressure
 * choice and their own export presets, each field read on its own, and another
 * version's preferences refused rather than migrated (REQ-STOR-052).
 */

import { describe, expect, it } from 'vitest';

import { LogSeverity, createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import {
  ContrastLevel,
  DEFAULT_THEME_PREFERENCES,
  Density,
  ThemeMode,
} from '@audiogubbins/design-system';
import { sampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { defaultExportSettings, type ExportSettings } from '@audiogubbins/import-export';
import { DEFAULT_PRESSURE_PREFERENCE } from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { exportContextOver, rateOf } from '../testing/export-contexts.js';
import { PREFERENCES_KEY, createPreferencesStore } from './preferences-store.js';
import { createStateStorage, type KeyValueStorage } from './state-storage.js';
import { MOST_EXPORT_PRESETS, presetSettings } from './stored-export-presets.js';

const context = exportContextOver();

/** Every preference before a person changes anything, with no presets kept. */
const DEFAULT_USER_PREFERENCES = {
  ...DEFAULT_THEME_PREFERENCES,
  pressure: DEFAULT_PRESSURE_PREFERENCE,
  exportPresets: [],
};

/** FLAC at 44.1 kHz, folded to mono, its range a region: what a person might save. */
const EDITED: ExportSettings = {
  ...defaultExportSettings('flac', context),
  sampleRate: rateOf(44_100),
  encoding: { bits: 24, compressionLevel: 8, keepRiffChunks: false },
  metadata: { policy: 'minimal', edits: [{ kind: 'set', key: 'artist', value: 'Foley' }] },
  fileName: '{project} {date}',
  range: {
    kind: 'selection',
    start: expectSuccess(sampleCount(0)),
    length: expectSuccess(sampleCount(10)),
  },
};

function over(raw: KeyValueStorage = ephemeralStorage()) {
  const logs = createLogStore();
  const everything = { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} };
  const logger = createDiagnosticCentre(logs, { now: () => 0 }, everything).loggerFor(
    'preferences',
  );
  const storage = createStateStorage(raw, logger, () => undefined);
  return { store: createPreferencesStore(storage, logger), raw, logs };
}

/** A store reading `record` as the preferences stored before it started. */
function reading(record: unknown) {
  const raw = ephemeralStorage();
  raw.write(PREFERENCES_KEY, JSON.stringify(record));
  return over(raw);
}

/** What the log says of the version of the record read, as message and fields. */
function versionNotes(logs: ReturnType<typeof createLogStore>) {
  return logs
    .snapshot()
    .filter((record) => record.message.startsWith('Stored preferences were'))
    .map((record) => [record.message, record.fields]);
}

/** A record of the second version, Phase 08's: the theme's choices and the pressure choice. */
const VERSION_TWO = {
  schemaVersion: 2,
  mode: ThemeMode.Light,
  accent: 'green',
  brightness: 0.25,
  density: Density.Compact,
  contrast: ContrastLevel.High,
  pressure: { usePenPressure: false, fixedStrength: 0.4 },
};

describe('the preferences record', () => {
  it('keeps a preset of the person’s through a reload, every value but the range', () => {
    const { store, raw } = over();
    expect(store.keepExportPreset('Master', EDITED)).toBeUndefined();

    const [kept] = over(raw).store.get().exportPresets;
    expect(kept).toEqual({ id: 'own:Master', name: 'Master', settings: presetSettings(EDITED) });
    expect(JSON.parse(raw.read(PREFERENCES_KEY) ?? '{}')).toMatchObject({
      schemaVersion: SCHEMA_VERSIONS.userPreferences,
      exportPresets: [{ id: 'own:Master', name: 'Master' }],
    });
    expect(raw.read(PREFERENCES_KEY)).not.toContain('selection');
  });

  it('replaces a preset saved again under its name, in its place', () => {
    const { store } = over();
    store.keepExportPreset('Master', EDITED);
    store.keepExportPreset('Game', defaultExportSettings('wav', context));
    store.keepExportPreset('Master', defaultExportSettings('opus', context));

    const presets = store.get().exportPresets;
    expect(presets.map((preset) => preset.name)).toEqual(['Master', 'Game']);
    expect(presets[0]?.settings.format).toBe('opus');
  });

  it('refuses a name that cannot name a preset, and a preset past the most kept', () => {
    const { store } = over();
    expect(store.keepExportPreset('  ', EDITED)).toBe('Give the preset a name.');
    expect(store.keepExportPreset(' Master', EDITED)).toBe(
      'A preset name neither starts nor ends with a space.',
    );
    for (let index = 0; index < MOST_EXPORT_PRESETS; index += 1) {
      store.keepExportPreset(`Preset ${String(index)}`, EDITED);
    }
    expect(store.keepExportPreset('One more', EDITED)).toBe(
      `At most ${String(MOST_EXPORT_PRESETS)} presets are kept; remove one first.`,
    );
    expect(store.keepExportPreset('Preset 3', EDITED)).toBeUndefined();
  });

  it('removes a preset of the person’s, and refuses one that is not kept', () => {
    const { store } = over();
    store.keepExportPreset('Master', EDITED);

    expect(store.removeExportPreset('own:Master')).toBeUndefined();
    expect(store.get().exportPresets).toEqual([]);
    expect(store.removeExportPreset('own:Master')).toBe('There is no such preset of yours.');
  });

  it('leaves out a kept preset this build cannot read, keeping the rest and the appearance', () => {
    const { store, raw } = over();
    store.change({ accent: 'green' });
    store.keepExportPreset('Master', EDITED);
    const written = JSON.parse(raw.read(PREFERENCES_KEY) ?? '{}') as {
      exportPresets: { settings: Record<string, unknown> }[];
    };
    const [good] = written.exportPresets;
    const { logs, store: again } = reading({
      ...written,
      exportPresets: [{ ...good, settings: { ...good?.settings, format: 'mod' } }, good, good],
    });

    expect(again.get().exportPresets.map((preset) => preset.name)).toEqual(['Master']);
    expect(again.get().accent).toBe('green');
    const [record] = logs
      .snapshot()
      .filter((one) => one.message.startsWith('Some stored export presets'));
    expect(record?.fields['unread']).toBe(2);
  });

  it('keeps the presets when the appearance is reset', () => {
    const { store } = over();
    store.change({ accent: 'green' });
    store.keepExportPreset('Master', EDITED);
    store.reset();

    expect(store.get().accent).toBe('blue');
    expect(store.get().exportPresets).toHaveLength(1);
  });

  it('refuses a record of a later version, saying so, and starts from the defaults', () => {
    const { store, logs } = reading({ ...VERSION_TWO, schemaVersion: 99 });
    expect(store.get()).toEqual(DEFAULT_USER_PREFERENCES);
    expect(versionNotes(logs)).toEqual([
      [
        'Stored preferences were written for another version and were not used.',
        { found: 99, expected: SCHEMA_VERSIONS.userPreferences },
      ],
    ]);
  });
});

describe('the pressure choice in the preferences', () => {
  it('starts with pressure used and the default fixed strength', () => {
    expect(over().store.get().pressure).toEqual(DEFAULT_PRESSURE_PREFERENCE);
  });

  it('is written with the preferences and read back after a reload', () => {
    const raw = ephemeralStorage();
    over(raw).store.change({ pressure: { usePenPressure: false, fixedStrength: 0.4 } });
    const stored: unknown = JSON.parse(raw.read(PREFERENCES_KEY) ?? 'null');
    expect(stored).toMatchObject({
      schemaVersion: SCHEMA_VERSIONS.userPreferences,
      pressure: { usePenPressure: false, fixedStrength: 0.4 },
    });
    expect(over(raw).store.get().pressure).toEqual({
      usePenPressure: false,
      fixedStrength: 0.4,
    });
  });

  it('costs only its own unusable field, keeping the theme’s choices', () => {
    const { store } = reading({
      ...DEFAULT_USER_PREFERENCES,
      accent: 'teal',
      pressure: { usePenPressure: false, fixedStrength: 'firm' },
    });
    expect(store.get().accent).toBe('teal');
    expect(store.get().pressure).toEqual({
      usePenPressure: false,
      fixedStrength: DEFAULT_PRESSURE_PREFERENCE.fixedStrength,
    });
  });

  it('returns to its default with every other preference', () => {
    const raw = ephemeralStorage();
    const { store } = over(raw);
    store.change({ pressure: { usePenPressure: false, fixedStrength: 0.4 } });
    store.reset();
    expect(store.get()).toEqual(DEFAULT_USER_PREFERENCES);
  });
});

describe('preferences written by another version', () => {
  it('are refused, not migrated, and say so: the first version’s start from the defaults', () => {
    const { store, logs } = reading({
      schemaVersion: 1,
      mode: 'light',
      accent: 'teal',
      brightness: 0.5,
      density: 'compact',
    });
    expect(store.get()).toEqual(DEFAULT_USER_PREFERENCES);
    expect(logs.snapshot().map((record) => [record.message, record.fields])).toContainEqual([
      'Stored preferences were written for another version and were not used.',
      { found: 1, expected: SCHEMA_VERSIONS.userPreferences },
    ]);
  });

  it('are refused, not migrated, and say so: the second version’s start from the defaults', () => {
    const { store, logs } = reading(VERSION_TWO);
    expect(store.get()).toEqual(DEFAULT_USER_PREFERENCES);
    expect(versionNotes(logs)).toEqual([
      [
        'Stored preferences were written for another version and were not used.',
        { found: 2, expected: SCHEMA_VERSIONS.userPreferences },
      ],
    ]);
  });
});
