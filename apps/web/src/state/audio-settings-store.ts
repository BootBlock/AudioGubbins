/**
 * How the person has set the audio engine up, and how it survives a reload:
 * the performance profile and the Custom profile's settings (REQ-ARCH-083),
 * how background work shares the machine with interactive work
 * (REQ-ARCH-084), and the processing mode renders use over the automatic
 * choice (REQ-ARCH-079).
 *
 * The user's preferences for audio, which REQ-ARCH-153 keeps apart from what
 * the engine is doing now (`audio-view-store.ts`): written to their own key,
 * in their own format, with their own version, and read back field by field,
 * so a stored file that has lost or gained a field costs the person the
 * fields that are wrong and not the ones that are right. Every value is
 * checked by the engine's own rules on the way in, whether it comes from
 * storage or from a command, so there is one statement of what is valid.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import {
  PerformanceProfile,
  PRESET_SETTINGS,
  ProcessingPurpose,
  SchedulingPolicy,
  availableProcessingModes,
  isLatencyHint,
  validatePerformanceSettings,
  type LatencyHint,
  type PerformanceSettings,
  type PresetProfile,
  type ProcessingMode,
} from '@audiogubbins/audio-engine';

import { observable, type Observable } from './observable.js';
import { reasonsOf, type Reasons } from './reasons.js';
import { isMemberOf, isRecord, versionFound } from './stored-value.js';
import { PersistedPart, type StateStorage } from './state-storage.js';

/** The key the audio settings are stored under. */
export const AUDIO_SETTINGS_KEY = 'audiogubbins.audio-settings';

/** A profile, and the buffering and scheduling it sets. */
export interface ChosenProfile {
  readonly profile: PerformanceProfile;
  readonly settings: PerformanceSettings;
}

/** How the person has set the audio engine up. */
export interface AudioSettings {
  /**
   * The profile in force, with its settings. A new object only when the
   * profile or the settings it carries change, so its identity says whether
   * they did: a playback context is closed and made again on a new one.
   */
  readonly chosen: ChosenProfile;

  /**
   * The Custom profile's settings, kept while a preset is in force, so that
   * choosing Custom again restores what the person set.
   */
  readonly custom: PerformanceSettings;

  readonly priorityPolicy: SchedulingPolicy;

  /** The mode renders use over the automatic choice, or `undefined` to choose automatically. */
  readonly renderMode: ProcessingMode | undefined;
}

/** Custom settings start as Balanced's, the default, for the person to adjust from. */
const DEFAULT_CUSTOM: PerformanceSettings = PRESET_SETTINGS[PerformanceProfile.Balanced];

/** Each preset chosen, made once, so choosing a preset again yields the same object. */
const PRESET_CHOICES: Readonly<Record<PresetProfile, ChosenProfile>> = {
  [PerformanceProfile.LowLatency]: {
    profile: PerformanceProfile.LowLatency,
    settings: PRESET_SETTINGS[PerformanceProfile.LowLatency],
  },
  [PerformanceProfile.Balanced]: {
    profile: PerformanceProfile.Balanced,
    settings: PRESET_SETTINGS[PerformanceProfile.Balanced],
  },
  [PerformanceProfile.MaximumStability]: {
    profile: PerformanceProfile.MaximumStability,
    settings: PRESET_SETTINGS[PerformanceProfile.MaximumStability],
  },
};

/** The settings AudioGubbins starts with: Balanced, interactive work first, modes chosen automatically. */
const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  chosen: PRESET_CHOICES[PerformanceProfile.Balanced],
  custom: DEFAULT_CUSTOM,
  priorityPolicy: SchedulingPolicy.InteractiveFirst,
  renderMode: undefined,
};

function chosenFor(profile: PerformanceProfile, custom: PerformanceSettings): ChosenProfile {
  return profile === PerformanceProfile.Custom
    ? { profile, settings: custom }
    : PRESET_CHOICES[profile];
}

/** The modes a render may be set to use: those the engine allows a final render. */
function isRenderMode(value: unknown): value is ProcessingMode {
  return availableProcessingModes(ProcessingPurpose.FinalRender).some((mode) => mode === value);
}

function sameSettings(one: PerformanceSettings, other: PerformanceSettings): boolean {
  return (
    one.latencyHint === other.latencyHint &&
    one.feedAheadMilliseconds === other.feedAheadMilliseconds &&
    one.backgroundConcurrencyWhileInteractive === other.backgroundConcurrencyWhileInteractive &&
    one.renderChunkMilliseconds === other.renderChunkMilliseconds
  );
}

/** Whether `settings` with one field changed is valid, which is whether that field is. */
function validAlone(changed: Partial<PerformanceSettings>): boolean {
  return validatePerformanceSettings({ ...DEFAULT_CUSTOM, ...changed }).ok;
}

/** A stored number field of the custom settings, where it is valid, or the default's. */
function storedNumber(
  stored: Readonly<Record<string, unknown>>,
  field: Exclude<keyof PerformanceSettings, 'latencyHint'>,
): number {
  const value = stored[field];
  return typeof value === 'number' && validAlone({ [field]: value })
    ? value
    : DEFAULT_CUSTOM[field];
}

function storedLatencyHint(stored: Readonly<Record<string, unknown>>): LatencyHint {
  const value = stored['latencyHint'];
  return isLatencyHint(value) && validAlone({ latencyHint: value })
    ? value
    : DEFAULT_CUSTOM.latencyHint;
}

/** The stored custom settings, each field taken only where it is valid. */
function readCustom(stored: unknown): PerformanceSettings {
  if (!isRecord(stored)) return DEFAULT_CUSTOM;
  return {
    latencyHint: storedLatencyHint(stored),
    feedAheadMilliseconds: storedNumber(stored, 'feedAheadMilliseconds'),
    backgroundConcurrencyWhileInteractive: storedNumber(
      stored,
      'backgroundConcurrencyWhileInteractive',
    ),
    renderChunkMilliseconds: storedNumber(stored, 'renderChunkMilliseconds'),
  };
}

/** Reads the stored audio settings, taking each field only if it is usable. */
function readAudioSettings(stored: string | null, logger: Logger): AudioSettings {
  if (stored === null) return DEFAULT_AUDIO_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    logger.warning('The stored audio settings could not be read, so the defaults are in force.');
    return DEFAULT_AUDIO_SETTINGS;
  }
  if (!isRecord(parsed)) return DEFAULT_AUDIO_SETTINGS;

  if (parsed['schemaVersion'] !== SCHEMA_VERSIONS.audioSettings) {
    logger.info('The stored audio settings were written for another version and were not used.', {
      found: versionFound(parsed['schemaVersion']),
      expected: SCHEMA_VERSIONS.audioSettings,
    });
    return DEFAULT_AUDIO_SETTINGS;
  }

  const custom = readCustom(parsed['custom']);
  const profile = parsed['profile'];
  const policy = parsed['priorityPolicy'];
  const renderMode = parsed['renderMode'];
  return {
    chosen: chosenFor(
      isMemberOf(PerformanceProfile, profile) ? profile : PerformanceProfile.Balanced,
      custom,
    ),
    custom,
    priorityPolicy: isMemberOf(SchedulingPolicy, policy)
      ? policy
      : DEFAULT_AUDIO_SETTINGS.priorityPolicy,
    renderMode: isRenderMode(renderMode) ? renderMode : undefined,
  };
}

/** Holds the audio settings and writes them back. */
export interface AudioSettingsStore extends Observable<AudioSettings> {
  readonly chooseProfile: (profile: PerformanceProfile) => void;

  /**
   * Replaces the Custom profile's settings, or refuses them for every reason
   * they are invalid, so a person correcting them fixes them in one pass.
   * They take effect at once where Custom is in force.
   */
  readonly setCustom: (settings: PerformanceSettings) => Reasons | undefined;

  readonly choosePriorityPolicy: (policy: SchedulingPolicy) => void;

  /** Sets the mode renders use, or `undefined` to choose automatically. */
  readonly chooseRenderMode: (mode: ProcessingMode | undefined) => Reasons | undefined;
}

/** The settings as they are written to storage. */
function serialised(settings: AudioSettings): string {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSIONS.audioSettings,
    profile: settings.chosen.profile,
    custom: settings.custom,
    priorityPolicy: settings.priorityPolicy,
    ...(settings.renderMode === undefined ? {} : { renderMode: settings.renderMode }),
  });
}

/**
 * `current` with valid Custom settings, which take effect at once where Custom
 * is in force; `current` itself where they are the settings it has.
 */
function withCustom(current: AudioSettings, custom: PerformanceSettings): AudioSettings {
  if (sameSettings(current.custom, custom)) return current;
  const inForce = current.chosen.profile === PerformanceProfile.Custom;
  return {
    ...current,
    custom,
    chosen: inForce ? chosenFor(PerformanceProfile.Custom, custom) : current.chosen,
  };
}

/** Creates the store, reading whatever was stored. */
export function createAudioSettingsStore(
  storage: StateStorage,
  logger: Logger,
): AudioSettingsStore {
  const state = observable(readAudioSettings(storage.read(AUDIO_SETTINGS_KEY), logger));

  /** Takes and stores `next`, unless it is what is there already. */
  const adopt = (next: AudioSettings): void => {
    if (next === state.get()) return;
    state.set(next);
    storage.save(PersistedPart.AudioSettings, { [AUDIO_SETTINGS_KEY]: serialised(next) });
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    chooseProfile: (profile) => {
      const current = state.get();
      if (current.chosen.profile !== profile) {
        adopt({ ...current, chosen: chosenFor(profile, current.custom) });
      }
    },

    setCustom: (settings) => {
      const checked = validatePerformanceSettings(settings);
      if (!checked.ok) return reasonsOf(checked.failures);
      adopt(withCustom(state.get(), checked.value));
      return undefined;
    },

    choosePriorityPolicy: (priorityPolicy) => {
      const current = state.get();
      if (current.priorityPolicy !== priorityPolicy) adopt({ ...current, priorityPolicy });
    },

    chooseRenderMode: (renderMode) => {
      if (renderMode !== undefined && !isRenderMode(renderMode)) {
        return ['A render always runs offline, in the foreground or in the background.'];
      }
      const current = state.get();
      if (current.renderMode !== renderMode) adopt({ ...current, renderMode });
      return undefined;
    },
  };
}
