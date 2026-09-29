/**
 * Audio performance profiles (REQ-ARCH-083).
 *
 * A profile is a trade between how soon a change is heard and how much margin
 * the audio thread has before it runs dry. It sets buffering and scheduling and
 * nothing else: the packet's acceptance criterion is that a profile never
 * changes which features are available, so no field here switches anything on
 * or off. A slow machine on Maximum Stability can do everything a fast one on
 * Low Latency can; it hears it later.
 */

import {
  fail,
  failure,
  FailureKind,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';

/** The profiles a person chooses between. */
export const PerformanceProfile = {
  LowLatency: 'low-latency',
  Balanced: 'balanced',
  MaximumStability: 'maximum-stability',
  /** Settings the person chose themselves, for an expert's manual configuration. */
  Custom: 'custom',
} as const;

/** The profiles a person chooses between. */
export type PerformanceProfile = (typeof PerformanceProfile)[keyof typeof PerformanceProfile];

/** A profile with settings of its own, as opposed to Custom. */
export type PresetProfile = Exclude<PerformanceProfile, typeof PerformanceProfile.Custom>;

/**
 * The audio context's latency hint: one of the Web Audio categories, or a
 * requested output latency in seconds. The engine only carries it; the runtime
 * hands it to the context it creates.
 */
export type LatencyHint = 'interactive' | 'balanced' | 'playback' | number;

/** What a profile sets. Buffering and scheduling only. */
export interface PerformanceSettings {
  readonly latencyHint: LatencyHint;
  /** How far, in milliseconds, the source feed keeps ahead of the play position. */
  readonly feedAheadMilliseconds: number;
  /** How many background jobs may run at once while interactive work is active. */
  readonly backgroundConcurrencyWhileInteractive: number;
  /** The span, in milliseconds, of one chunk of offline or background rendering. */
  readonly renderChunkMilliseconds: number;
}

/**
 * The presets, from least to most margin.
 *
 * Shorter render chunks under Low Latency let a background render hand the
 * processor back sooner; a longer feed under Maximum Stability absorbs a
 * stall of the main thread or the disk without the device running dry.
 */
export const PRESET_SETTINGS: Readonly<Record<PresetProfile, PerformanceSettings>> = {
  [PerformanceProfile.LowLatency]: {
    latencyHint: 'interactive',
    feedAheadMilliseconds: 50,
    backgroundConcurrencyWhileInteractive: 1,
    renderChunkMilliseconds: 100,
  },
  [PerformanceProfile.Balanced]: {
    latencyHint: 'balanced',
    feedAheadMilliseconds: 200,
    backgroundConcurrencyWhileInteractive: 2,
    renderChunkMilliseconds: 500,
  },
  [PerformanceProfile.MaximumStability]: {
    latencyHint: 'playback',
    feedAheadMilliseconds: 1_000,
    backgroundConcurrencyWhileInteractive: 1,
    renderChunkMilliseconds: 1_000,
  },
};

/** The presets in order of increasing stability, for recommending the next one. */
export const PRESETS_BY_STABILITY: readonly PresetProfile[] = [
  PerformanceProfile.LowLatency,
  PerformanceProfile.Balanced,
  PerformanceProfile.MaximumStability,
];

function positiveFinite(
  value: number,
  field: keyof PerformanceSettings,
  meaning: string,
): DomainFailure | undefined {
  if (Number.isFinite(value) && value > 0) return undefined;
  return failure(
    `performance-settings.${field}-not-positive`,
    FailureKind.Rejected,
    `${meaning} must be a finite number greater than zero; ${String(value)} was given.`,
    { details: { field, value: String(value) } },
  );
}

function positiveWhole(
  value: number,
  field: keyof PerformanceSettings,
  meaning: string,
): DomainFailure | undefined {
  if (Number.isSafeInteger(value) && value > 0) return undefined;
  return failure(
    `performance-settings.${field}-not-positive-whole`,
    FailureKind.Rejected,
    `${meaning} must be a whole number of at least one; ${String(value)} was given. ` +
      'Background work needs at least one slot, or it would never finish.',
    { details: { field, value: String(value) } },
  );
}

/**
 * Checks custom settings, reporting every problem at once so a person
 * correcting the settings dialogue fixes them in one pass.
 */
export function validatePerformanceSettings(
  settings: PerformanceSettings,
): DomainResult<PerformanceSettings> {
  const problems = [
    typeof settings.latencyHint === 'number'
      ? positiveFinite(settings.latencyHint, 'latencyHint', 'A latency hint in seconds')
      : undefined,
    positiveFinite(settings.feedAheadMilliseconds, 'feedAheadMilliseconds', 'The feed-ahead time'),
    positiveWhole(
      settings.backgroundConcurrencyWhileInteractive,
      'backgroundConcurrencyWhileInteractive',
      'The background concurrency while interactive',
    ),
    positiveFinite(
      settings.renderChunkMilliseconds,
      'renderChunkMilliseconds',
      'The render chunk length',
    ),
  ].filter((problem) => problem !== undefined);
  const [first, ...rest] = problems;
  return first === undefined ? succeed(settings) : fail(first, ...rest);
}

/** The settings of a preset. */
export function settingsFor(profile: PresetProfile): DomainResult<PerformanceSettings>;
/** Custom settings, once they are valid. */
export function settingsFor(
  profile: typeof PerformanceProfile.Custom,
  custom: PerformanceSettings,
): DomainResult<PerformanceSettings>;
export function settingsFor(
  profile: PerformanceProfile,
  custom?: PerformanceSettings,
): DomainResult<PerformanceSettings> {
  if (profile !== PerformanceProfile.Custom) return succeed(PRESET_SETTINGS[profile]);
  if (custom === undefined) {
    return fail(
      failure(
        'performance-settings.custom-missing',
        FailureKind.Rejected,
        'The Custom profile needs its settings; none were given.',
      ),
    );
  }
  return validatePerformanceSettings(custom);
}
