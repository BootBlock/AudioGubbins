/**
 * How much the diagnostic log records, overall and per subsystem.
 *
 * REQ-PRIV-165 requires user-configurable verbosity and subsystem filtering.
 * The diagnostic centre does both, through `setVerbosity` and category
 * overrides, and this store is the application's caller of them: without one,
 * the verbosity would be fixed at Warning for everyone.
 *
 * Kept under its own key and restored at start-up. A setting that reset itself
 * on every reload would be configurable only for the length of one session,
 * which is not what "user-configurable" means.
 */

import {
  DEFAULT_VERBOSITY,
  type LogSeverity,
  isLogCategory,
  isLogSeverity,
  type DiagnosticCentre,
  type Logger,
  type VerbosityConfiguration,
} from '@audiogubbins/diagnostics';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { observable, type Observable } from './observable.js';
import { isRecord, versionFound } from './stored-value.js';
import { PersistedPart, type KeyValueStorage, type StateStorage } from './state-storage.js';

/** Where the verbosity is kept. */
const STORAGE_KEY = 'audiogubbins.verbosity';

/**
 * How many subsystems may have a level of their own.
 *
 * Far more than this build has. A bound, because the file is kept for as long
 * as the browser keeps it, and nothing that can be written without limit
 * belongs in it.
 */
const MAXIMUM_CATEGORY_OVERRIDES = 32;

/**
 * The stored verbosity, as far as it can be trusted.
 *
 * An override naming a severity this build does not have is dropped on its own
 * rather than discarding the rest: the user keeps every choice that still means
 * something. So is one keyed by something that is not a category name, which no
 * build writes, and anything past the bound.
 */
export function readStoredVerbosity(
  storage: Pick<KeyValueStorage, 'read'>,
  logger: Logger,
): VerbosityConfiguration {
  const text = storage.read(STORAGE_KEY);
  if (text === null) return DEFAULT_VERBOSITY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.warning('The stored log verbosity could not be read, so the default is in force.');
    return DEFAULT_VERBOSITY;
  }
  if (!isRecord(parsed)) return DEFAULT_VERBOSITY;

  // Versioned like every other persisted format (REQ-REPO-187). Unversioned, a
  // later change to the shape of the overrides would have no way to recognise a
  // file written by this build, and would half-read it.
  if (parsed['schemaVersion'] !== SCHEMA_VERSIONS.logVerbosity) {
    logger.warning('The stored log verbosity was written for another version, so it is ignored.', {
      storedVersion: versionFound(parsed['schemaVersion']),
      thisVersion: SCHEMA_VERSIONS.logVerbosity,
    });
    return DEFAULT_VERBOSITY;
  }

  const storedOverrides = parsed['categoryOverrides'];
  const storedDefault = parsed['defaultSeverity'];
  const overrides: Record<string, LogSeverity> = {};
  if (isRecord(storedOverrides)) {
    for (const [category, severity] of Object.entries(storedOverrides)) {
      if (Object.keys(overrides).length >= MAXIMUM_CATEGORY_OVERRIDES) break;
      if (isLogCategory(category) && isLogSeverity(severity)) overrides[category] = severity;
    }
  }

  return {
    defaultSeverity: isLogSeverity(storedDefault)
      ? storedDefault
      : DEFAULT_VERBOSITY.defaultSeverity,
    categoryOverrides: overrides,
  };
}

/** Holds the verbosity the user chose and keeps the diagnostic centre in step. */
export interface VerbosityStore extends Observable<VerbosityConfiguration> {
  /** Sets the level recorded for any subsystem without an override of its own. */
  readonly setDefault: (severity: LogSeverity) => void;

  /**
   * Sets the level recorded for one subsystem, or removes its override.
   * Reports the reason it refused.
   *
   * Per-subsystem is what makes an investigation possible: raising everything
   * to Trace to find one storage problem would bury it in rendering records.
   *
   * Only a category name is kept. The subsystems are listed from the records in
   * the log, and a name built from a value, a path or a token, would otherwise
   * be written to storage verbatim, where no log rotation and no redaction ever
   * reaches it.
   */
  readonly setCategory: (category: string, severity: LogSeverity | undefined) => string | undefined;
}

/**
 * Creates the store.
 *
 * The centre is created with the stored verbosity already in force, so this
 * only has to keep the two in step from here on.
 */
export function createVerbosityStore(
  initial: VerbosityConfiguration,
  centre: DiagnosticCentre,
  storage: StateStorage,
): VerbosityStore {
  const state = observable(initial);

  const adopt = (next: VerbosityConfiguration): void => {
    // Through the centre, which knows that a change made while diagnostic mode
    // is on changes what the user goes back to rather than what is in force.
    centre.setVerbosity(next);
    state.set(next);
    storage.save(PersistedPart.Verbosity, {
      [STORAGE_KEY]: JSON.stringify({ schemaVersion: SCHEMA_VERSIONS.logVerbosity, ...next }),
    });
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    setDefault: (severity) => {
      adopt({ ...state.get(), defaultSeverity: severity });
    },

    setCategory: (category, severity) => {
      if (!isLogCategory(category))
        return 'That is not a part of AudioGubbins that writes to the log.';

      const others = Object.fromEntries(
        Object.entries(state.get().categoryOverrides).filter(([name]) => name !== category),
      );
      if (severity !== undefined && Object.keys(others).length >= MAXIMUM_CATEGORY_OVERRIDES) {
        return `At most ${String(MAXIMUM_CATEGORY_OVERRIDES)} parts can have a level of their own.`;
      }

      adopt({
        ...state.get(),
        categoryOverrides: severity === undefined ? others : { ...others, [category]: severity },
      });
      return undefined;
    },
  };
}
