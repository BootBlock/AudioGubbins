/**
 * A keyboard layout store over storage nothing else uses, for testing.
 *
 * The store takes the storage it keeps the layout in and the logger it reports
 * an unreadable one through, as every other store does, and neither is optional
 * here either: an optional one would be a knob production does not have, a test
 * that left the storage out would prove nothing about what is kept between
 * visits, and nothing would check the warning.
 */

import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type LogStore,
} from '@audiogubbins/diagnostics';

import {
  createKeyboardLayoutStore,
  type KeyboardLayoutStore,
} from '../state/keyboard-layout-store.js';
import {
  createStateStorage,
  type KeyValueStorage,
  type StateStorage,
} from '../state/state-storage.js';
import { ephemeralStorage } from './ephemeral-storage.js';
import { KeyboardConvention } from '@audiogubbins/commands';

/** A store, the storage behind it, and the log it wrote to. */
export interface TestLayoutStore {
  readonly store: KeyboardLayoutStore;
  readonly storage: StateStorage;
  readonly raw: KeyValueStorage;
  readonly logs: LogStore;
}

/**
 * Builds a store over `raw`, which a second call can be given to read back
 * what the first visit kept.
 */
export function buildLayoutStore(
  raw: KeyValueStorage = ephemeralStorage(),
  // Apple's, because the Command layer is a macOS arrangement and these tests
  // are where it is read.
  convention: KeyboardConvention = KeyboardConvention.Apple,
): TestLayoutStore {
  const logs = createLogStore();
  const diagnostics = createDiagnosticCentre(
    logs,
    { now: () => 0 },
    { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
  );
  const logger = diagnostics.loggerFor('shell');
  const storage = createStateStorage(raw, logger, () => undefined);

  return { store: createKeyboardLayoutStore(storage, logger, convention), storage, raw, logs };
}
