import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { ContrastLevel, Density, ThemeMode } from '@audiogubbins/design-system';
import { defaultExportSettings, type ExportSettings } from '@audiogubbins/import-export';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import { sampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { exportContextOver, rateOf } from '../testing/export-contexts.js';
import { PREFERENCES_KEY, createPreferencesStore } from './preferences-store.js';
import { createStateStorage, type KeyValueStorage } from './state-storage.js';
import { MOST_EXPORT_PRESETS, presetSettings } from './stored-export-presets.js';

const context = exportContextOver();

/** FLAC at 44.1 kHz, folded to mono, its range a region: what a person might save. */
const EDITED: ExportSettings = {
  ...defaultExportSettings('flac', context),
  sampleRate: rateOf(44_100),
  encoding: { bits: 24, compressionLevel: 8 },
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
  const logger = createDiagnosticCentre(logs, { now: () => 0 }).loggerFor('preferences');
  const storage = createStateStorage(raw, logger, () => undefined);
  return { store: createPreferencesStore(storage, logger), raw, logs };
}

/** A store reading `record` as the preferences stored before it started. */
function reading(record: unknown) {
  const raw = ephemeralStorage();
  raw.write(PREFERENCES_KEY, JSON.stringify(record));
  return over(raw);
}

/** A record of the first version, which kept no presets, with every appearance field chosen. */
const VERSION_ONE = {
  schemaVersion: 1,
  mode: ThemeMode.Light,
  accent: 'green',
  brightness: 0.25,
  density: Density.Compact,
  contrast: ContrastLevel.High,
};

describe('the preferences record', () => {
  it('reads a record of the version before export presets with its appearance unchanged', () => {
    const { store } = reading(VERSION_ONE);

    expect(store.get()).toEqual({
      ...VERSION_ONE,
      schemaVersion: SCHEMA_VERSIONS.userPreferences,
      exportPresets: [],
    });
  });

  it('writes the brought-up record back as this version, keeping its appearance', () => {
    const { store, raw } = reading(VERSION_ONE);
    store.keepExportPreset('Master', EDITED);

    const again = over(raw).store.get();
    expect(again.accent).toBe('green');
    expect(again.density).toBe(Density.Compact);
    expect(again.exportPresets.map((preset) => preset.name)).toEqual(['Master']);
  });

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

  it('reads a record of a later version as the defaults', () => {
    const { store } = reading({ ...VERSION_ONE, schemaVersion: 99 });
    expect(store.get().accent).toBe('blue');
    expect(store.get().exportPresets).toEqual([]);
  });
});
