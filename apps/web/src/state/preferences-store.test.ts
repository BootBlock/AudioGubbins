/**
 * The person's preferences across a reload: the pressure choice kept beside
 * the theme's, each field read on its own, and another version's preferences
 * refused rather than migrated (REQ-STOR-052).
 */

import { describe, expect, it } from 'vitest';

import { LogSeverity, createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { DEFAULT_PRESSURE_PREFERENCE } from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import {
  DEFAULT_USER_PREFERENCES,
  PREFERENCES_KEY,
  createPreferencesStore,
} from './preferences-store.js';
import { createStateStorage, type KeyValueStorage } from './state-storage.js';

function storeOver(raw: KeyValueStorage) {
  const logs = createLogStore();
  const everything = { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} };
  const logger = createDiagnosticCentre(logs, { now: () => 0 }, everything).loggerFor(
    'preferences',
  );
  const storage = createStateStorage(raw, logger, () => undefined);
  return { store: createPreferencesStore(storage, logger), logs };
}

/** The store over storage holding `text` under the preferences' key. */
function storeReading(text: string) {
  const raw = ephemeralStorage();
  raw.write(PREFERENCES_KEY, text);
  return storeOver(raw);
}

describe('the pressure choice in the preferences', () => {
  it('starts with pressure used and the default fixed strength', () => {
    expect(storeOver(ephemeralStorage()).store.get().pressure).toEqual(DEFAULT_PRESSURE_PREFERENCE);
  });

  it('is written with the preferences and read back after a reload', () => {
    const raw = ephemeralStorage();
    storeOver(raw).store.change({ pressure: { usePenPressure: false, fixedStrength: 0.4 } });
    const stored: unknown = JSON.parse(raw.read(PREFERENCES_KEY) ?? 'null');
    expect(stored).toMatchObject({
      schemaVersion: SCHEMA_VERSIONS.userPreferences,
      pressure: { usePenPressure: false, fixedStrength: 0.4 },
    });
    expect(storeOver(raw).store.get().pressure).toEqual({
      usePenPressure: false,
      fixedStrength: 0.4,
    });
  });

  it('costs only its own unusable field, keeping the theme’s choices', () => {
    const { store } = storeReading(
      JSON.stringify({
        ...DEFAULT_USER_PREFERENCES,
        accent: 'teal',
        pressure: { usePenPressure: false, fixedStrength: 'firm' },
      }),
    );
    expect(store.get().accent).toBe('teal');
    expect(store.get().pressure).toEqual({
      usePenPressure: false,
      fixedStrength: DEFAULT_PRESSURE_PREFERENCE.fixedStrength,
    });
  });

  it('returns to its default with every other preference', () => {
    const raw = ephemeralStorage();
    const { store } = storeOver(raw);
    store.change({ pressure: { usePenPressure: false, fixedStrength: 0.4 } });
    store.reset();
    expect(store.get()).toEqual(DEFAULT_USER_PREFERENCES);
  });
});

describe('preferences written by another version', () => {
  it('are refused, not migrated, and say so: the first version’s start from the defaults', () => {
    const { store, logs } = storeReading(
      JSON.stringify({
        schemaVersion: 1,
        mode: 'light',
        accent: 'teal',
        brightness: 0.5,
        density: 'compact',
      }),
    );
    expect(store.get()).toEqual(DEFAULT_USER_PREFERENCES);
    expect(logs.snapshot().map((record) => [record.message, record.fields])).toContainEqual([
      'Stored preferences were written for another version and were not used.',
      { found: 1, expected: SCHEMA_VERSIONS.userPreferences },
    ]);
  });
});
