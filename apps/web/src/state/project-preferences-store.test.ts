import { describe, expect, it } from 'vitest';

import { LogSeverity, createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { unsafeBrandId } from '@audiogubbins/domain';
import { SourceHandling } from '@audiogubbins/media-store';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { CANNOT_LINK, createProjectPreferencesStore } from './project-preferences-store.js';
import { createStateStorage, type KeyValueStorage } from './state-storage.js';

const PROJECT = unsafeBrandId<'ProjectId'>('0a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');

/** The store over `raw`, in a browser that can link files or cannot. */
function storeOver(raw: KeyValueStorage, canLink: boolean) {
  const logs = createLogStore();
  const everything = { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} };
  const logger = createDiagnosticCentre(logs, { now: () => 0 }, everything).loggerFor('projects');
  const storage = createStateStorage(raw, logger, () => undefined);
  return { store: createProjectPreferencesStore(storage, canLink, logger), logs };
}

describe('the choices about projects outside any one project', () => {
  it('copies files in and remembers no project, where nothing was chosen', () => {
    const { store } = storeOver(ephemeralStorage(), true);

    expect(store.get()).toEqual({ sourceHandling: SourceHandling.Copy, canLink: true });
  });

  it('keeps the choice and the project last open, and reads both back at the next start', () => {
    const raw = ephemeralStorage();
    const { store } = storeOver(raw, true);

    expect(store.setSourceHandling(SourceHandling.Link)).toBeUndefined();
    store.remember(PROJECT);

    expect(storeOver(raw, true).store.get()).toEqual({
      sourceHandling: SourceHandling.Link,
      canLink: true,
      lastProject: PROJECT,
    });
    store.remember(undefined);
    expect(storeOver(raw, true).store.get().lastProject).toBeUndefined();
  });

  it('never links where the browser cannot give a file it finds again, and says why', () => {
    const raw = ephemeralStorage();
    storeOver(raw, true).store.setSourceHandling(SourceHandling.Link);
    const { store } = storeOver(raw, false);

    expect(store.get().sourceHandling).toBe(SourceHandling.Copy);
    expect(store.setSourceHandling(SourceHandling.Link)).toBe(CANNOT_LINK);
    expect(store.get().sourceHandling).toBe(SourceHandling.Copy);
  });

  it('gives a value it does not know, and a project that is no identifier, way to the default', () => {
    const raw = ephemeralStorage();
    raw.write('audiogubbins.source-handling', 'borrow');
    raw.write('audiogubbins.last-project', '../elsewhere');
    const { store, logs } = storeOver(raw, true);

    expect(store.get()).toEqual({ sourceHandling: SourceHandling.Copy, canLink: true });
    expect(logs.snapshot().map((record) => record.message)).toContain(
      'The stored way of bringing files in was not one this build knows.',
    );
  });
});
