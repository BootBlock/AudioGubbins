/**
 * The user's preferences, and how they survive a reload: how the interface
 * looks and moves, and whether a pen's pressure varies a tool (REQ-UX-068,
 * ADR-0082).
 *
 * REQ-ARCH-153 gives preferences their own partition, separate from project
 * state, with their own lifetime. REQ-UX-059 requires that separation to be
 * clear enough that a display choice cannot corrupt the project, and this is
 * where that holds: preferences are written to their own key, in their own
 * format, with their own version, and nothing here can reach project data.
 *
 * Storage is injected. REQ-EXEC-216 prohibits assuming a browser API is
 * available, and private browsing, a blocked-cookies setting and a quota
 * failure all make `localStorage` throw rather than return nothing. A user
 * whose preferences cannot be stored gets an application that works, forgets,
 * and says that it will forget: `StateStorage` reports the failure.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  DEFAULT_PRESSURE_PREFERENCE,
  pressurePreferenceOf,
  type PressurePreference,
} from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import {
  ContrastLevel,
  DEFAULT_THEME_PREFERENCES,
  Density,
  MotionLevel,
  ThemeMode,
  clampBrightness,
  isAccentName,
  type ThemePreferences,
} from '@audiogubbins/design-system';

import { observable, type Observable } from './observable.js';
import { isMemberOf, isRecord, versionFound } from './stored-value.js';
import { PersistedPart, type StateStorage } from './state-storage.js';

/** The key preferences are stored under. */
export const PREFERENCES_KEY = 'audiogubbins.preferences';

/**
 * Everything the person's preferences hold (schema `userPreferences`): the
 * theme's choices and the pressure choice, which the input model owns.
 */
export interface UserPreferences extends ThemePreferences {
  readonly pressure: PressurePreference;
}

/** The preferences before a user changes anything. */
const DEFAULT_USER_PREFERENCES: UserPreferences = {
  ...DEFAULT_THEME_PREFERENCES,
  pressure: DEFAULT_PRESSURE_PREFERENCE,
};

/**
 * Reads stored preferences, taking each field only if it is usable.
 *
 * Field by field rather than all or nothing. A stored preference file that has
 * gained a field from a newer version, or lost one, should cost the user the
 * fields that are wrong and not the ones that are right. Falling back to the
 * whole default set would silently reset a user's accent because their density
 * was unreadable.
 */
function readPreferences(stored: string | null, logger: Logger): UserPreferences {
  if (stored === null) return DEFAULT_USER_PREFERENCES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    logger.warning('Stored preferences could not be read and were replaced with the defaults.');
    return DEFAULT_USER_PREFERENCES;
  }

  if (!isRecord(parsed)) {
    logger.warning('Stored preferences were not preferences and were replaced with the defaults.');
    return DEFAULT_USER_PREFERENCES;
  }

  const candidate = parsed;

  // Another version's preferences are refused, never migrated, before 1.0
  // (REQ-STOR-052): a person whose stored version is older starts from the
  // defaults, and the next change they make writes this version's.
  if (candidate['schemaVersion'] !== SCHEMA_VERSIONS.userPreferences) {
    logger.info('Stored preferences were written for another version and were not used.', {
      found: versionFound(candidate['schemaVersion']),
      expected: SCHEMA_VERSIONS.userPreferences,
    });
    return DEFAULT_USER_PREFERENCES;
  }

  const accent = candidate['accent'];
  const contrast = candidate['contrast'];
  const motion = candidate['motion'];

  return {
    schemaVersion: SCHEMA_VERSIONS.userPreferences,
    mode: isMemberOf(ThemeMode, candidate['mode'])
      ? candidate['mode']
      : DEFAULT_THEME_PREFERENCES.mode,
    accent: isAccentName(accent) ? accent : DEFAULT_THEME_PREFERENCES.accent,
    brightness:
      typeof candidate['brightness'] === 'number'
        ? clampBrightness(candidate['brightness'])
        : DEFAULT_THEME_PREFERENCES.brightness,
    density: isMemberOf(Density, candidate['density'])
      ? candidate['density']
      : DEFAULT_THEME_PREFERENCES.density,
    // Absent means "no choice made", which is what lets the system's
    // contrast and reduced-motion settings apply. It is not the same as
    // choosing Standard or Full.
    ...(isMemberOf(ContrastLevel, contrast) ? { contrast } : {}),
    ...(isMemberOf(MotionLevel, motion) ? { motion } : {}),
    pressure: pressurePreferenceOf(candidate['pressure']),
  };
}

/** Holds the user's preferences and writes them back. */
export interface PreferencesStore extends Observable<UserPreferences> {
  /** Replaces some of the preferences and stores the result. */
  readonly change: (changes: Partial<UserPreferences>) => void;

  /**
   * Removes the user's motion choice, so the system setting applies again.
   *
   * Its own method because "no choice made" is a state a user can ask for, and
   * a partial change cannot express removing a field. Setting Full instead
   * would look identical on a machine with no reduced-motion preference and
   * would ignore the setting on one that has it (REQ-UX-069).
   */
  readonly followSystemMotion: () => void;

  /** Removes the user's contrast choice, so the system setting applies again. */
  readonly followSystemContrast: () => void;

  /** Returns every preference to its default. */
  readonly reset: () => void;
}

/** Creates the preferences store, reading whatever was stored. */
export function createPreferencesStore(storage: StateStorage, logger: Logger): PreferencesStore {
  const state = observable(readPreferences(storage.read(PREFERENCES_KEY), logger));

  const persist = (preferences: UserPreferences): void => {
    storage.save(PersistedPart.Preferences, { [PREFERENCES_KEY]: JSON.stringify(preferences) });
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    change: (changes) => {
      const next: UserPreferences = { ...state.get(), ...changes };
      state.set(next);
      persist(next);
    },

    followSystemMotion: () => {
      const { motion: _chosen, ...rest } = state.get();
      state.set(rest);
      persist(rest);
    },

    followSystemContrast: () => {
      const { contrast: _chosen, ...rest } = state.get();
      state.set(rest);
      persist(rest);
    },

    reset: () => {
      state.set(DEFAULT_USER_PREFERENCES);
      persist(DEFAULT_USER_PREFERENCES);
    },
  };
}
