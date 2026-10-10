/**
 * The user's preferences, and how they survive a reload.
 *
 * REQ-ARCH-153 gives preferences their own partition, separate from project
 * state, with their own lifetime. REQ-UX-059 requires that separation to be
 * clear enough that a display choice cannot corrupt the project, and this is
 * where that holds: preferences are written to their own key, in their own
 * format, with their own version, and nothing here can reach project data.
 * They are the interface's appearance and the person's own export presets
 * (ADR-0092).
 *
 * Storage is injected. REQ-EXEC-216 prohibits assuming a browser API is
 * available, and private browsing, a blocked-cookies setting and a quota
 * failure all make `localStorage` throw rather than return nothing. A user
 * whose preferences cannot be stored gets an application that works, forgets,
 * and says that it will forget: `StateStorage` reports the failure.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { ExportSettings } from '@audiogubbins/import-export';
import { isJsonObject, parseJson, type JsonObject } from '@audiogubbins/project-format';
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
import { isMemberOf, versionFound } from './stored-value.js';
import { PersistedPart, type StateStorage } from './state-storage.js';
import {
  MOST_EXPORT_PRESETS,
  ownPresetId,
  presetNameProblem,
  presetSettings,
  readOwnPresets,
  writeOwnPreset,
  type OwnExportPreset,
} from './stored-export-presets.js';

/** The key preferences are stored under. */
export const PREFERENCES_KEY = 'audiogubbins.preferences';

/**
 * The version of the record before it kept export presets. A record of it is
 * read into this version with its appearance unchanged and no presets, so
 * raising the version to keep presets never costs the person their appearance.
 */
const BEFORE_EXPORT_PRESETS = 1;

/**
 * The bounds stored preferences are read within: room for every preset kept
 * and the nesting of a preset's settings, so a damaged record is refused
 * rather than read without end.
 */
const PREFERENCES_LIMITS = { maximumLength: 4 * 1024 * 1024, maximumDepth: 16 } as const;

/** The person's preferences: how the interface looks, and their own export presets. */
export interface UserPreferences extends ThemePreferences {
  /** In the order they were saved. */
  readonly exportPresets: readonly OwnExportPreset[];
}

/** The preferences before a person changes anything. */
const DEFAULT_USER_PREFERENCES: UserPreferences = {
  ...DEFAULT_THEME_PREFERENCES,
  exportPresets: [],
};

/**
 * The appearance a stored record holds, taking each field only if it is usable.
 *
 * Field by field rather than all or nothing. A stored preference file that has
 * gained a field from a newer version, or lost one, should cost the user the
 * fields that are wrong and not the ones that are right. Falling back to the
 * whole default set would silently reset a user's accent because their density
 * was unreadable.
 */
function readTheme(candidate: JsonObject): ThemePreferences {
  const accent = candidate['accent'];
  const contrast = candidate['contrast'];
  const motion = candidate['motion'];
  const brightness = candidate['brightness'];

  return {
    schemaVersion: SCHEMA_VERSIONS.userPreferences,
    mode: isMemberOf(ThemeMode, candidate['mode'])
      ? candidate['mode']
      : DEFAULT_THEME_PREFERENCES.mode,
    accent: isAccentName(accent) ? accent : DEFAULT_THEME_PREFERENCES.accent,
    brightness:
      typeof brightness === 'number'
        ? clampBrightness(brightness)
        : DEFAULT_THEME_PREFERENCES.brightness,
    density: isMemberOf(Density, candidate['density'])
      ? candidate['density']
      : DEFAULT_THEME_PREFERENCES.density,
    // Absent means "no choice made", which is what lets the system's
    // contrast and reduced-motion settings apply. It is not the same as
    // choosing Standard or Full.
    ...(isMemberOf(ContrastLevel, contrast) ? { contrast } : {}),
    ...(isMemberOf(MotionLevel, motion) ? { motion } : {}),
  };
}

/** The export presets a record of this version keeps, saying in the log how many could not be read. */
function readPresets(candidate: JsonObject, logger: Logger): readonly OwnExportPreset[] {
  const { presets, unread } = readOwnPresets(candidate['exportPresets']);
  if (unread > 0) {
    logger.warning('Some stored export presets could not be read and were left out.', { unread });
  }
  return presets;
}

/**
 * Reads stored preferences: a record of this version as it is, one from before
 * export presets with its appearance and no presets, and anything else as the
 * defaults, said in the log.
 */
function readPreferences(stored: string | null, logger: Logger): UserPreferences {
  if (stored === null) return DEFAULT_USER_PREFERENCES;

  const parsed = parseJson(stored, PREFERENCES_LIMITS);
  if (!parsed.ok) {
    logger.warning('Stored preferences could not be read and were replaced with the defaults.');
    return DEFAULT_USER_PREFERENCES;
  }

  const candidate = parsed.value;
  if (!isJsonObject(candidate)) {
    logger.warning('Stored preferences were not preferences and were replaced with the defaults.');
    return DEFAULT_USER_PREFERENCES;
  }

  const version = candidate['schemaVersion'];
  if (version === BEFORE_EXPORT_PRESETS) {
    logger.info('Stored preferences were brought up to this version, keeping their appearance.', {
      found: BEFORE_EXPORT_PRESETS,
      expected: SCHEMA_VERSIONS.userPreferences,
    });
    return { ...readTheme(candidate), exportPresets: [] };
  }
  if (version !== SCHEMA_VERSIONS.userPreferences) {
    logger.info('Stored preferences were written for another version and were not used.', {
      found: versionFound(version),
      expected: SCHEMA_VERSIONS.userPreferences,
    });
    return DEFAULT_USER_PREFERENCES;
  }

  return { ...readTheme(candidate), exportPresets: readPresets(candidate, logger) };
}

/** The text preferences are stored as. */
function writePreferences(preferences: UserPreferences): string {
  return JSON.stringify({
    ...preferences,
    exportPresets: preferences.exportPresets.map(writeOwnPreset),
  });
}

/** Holds the user's preferences and writes them back. */
export interface PreferencesStore extends Observable<UserPreferences> {
  /** Replaces some of the appearance and stores the result. */
  readonly change: (changes: Partial<ThemePreferences>) => void;

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

  /** Returns the appearance to its default, keeping the person's export presets. */
  readonly reset: () => void;

  /**
   * Keeps every value of `settings` but the range as a preset of the person's
   * named `name`, in place of the one of that name. Answers why not where the
   * name cannot name a preset, or where as many are kept as are allowed.
   */
  readonly keepExportPreset: (name: string, settings: ExportSettings) => string | undefined;

  /** Removes the preset of the person's kept as `id`, or answers why not where none is. */
  readonly removeExportPreset: (id: string) => string | undefined;
}

/** Creates the preferences store, reading whatever was stored. */
export function createPreferencesStore(storage: StateStorage, logger: Logger): PreferencesStore {
  const state = observable(readPreferences(storage.read(PREFERENCES_KEY), logger));

  const put = (preferences: UserPreferences): void => {
    state.set(preferences);
    storage.save(PersistedPart.Preferences, { [PREFERENCES_KEY]: writePreferences(preferences) });
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    change: (changes) => {
      put({ ...state.get(), ...changes });
    },

    followSystemMotion: () => {
      const { motion: _chosen, ...rest } = state.get();
      put(rest);
    },

    followSystemContrast: () => {
      const { contrast: _chosen, ...rest } = state.get();
      put(rest);
    },

    reset: () => {
      put({ ...DEFAULT_THEME_PREFERENCES, exportPresets: state.get().exportPresets });
    },

    keepExportPreset: (name, settings) => {
      const problem = presetNameProblem(name);
      if (problem !== undefined) return problem;
      const id = ownPresetId(name);
      const kept = state.get().exportPresets;
      const at = kept.findIndex((preset) => preset.id === id);
      if (at === -1 && kept.length >= MOST_EXPORT_PRESETS) {
        return `At most ${String(MOST_EXPORT_PRESETS)} presets are kept; remove one first.`;
      }
      const preset: OwnExportPreset = { id, name, settings: presetSettings(settings) };
      put({
        ...state.get(),
        exportPresets: at === -1 ? [...kept, preset] : kept.with(at, preset),
      });
      return undefined;
    },

    removeExportPreset: (id) => {
      const kept = state.get().exportPresets;
      if (!kept.some((preset) => preset.id === id)) return 'There is no such preset of yours.';
      put({ ...state.get(), exportPresets: kept.filter((preset) => preset.id !== id) });
      return undefined;
    },
  };
}
