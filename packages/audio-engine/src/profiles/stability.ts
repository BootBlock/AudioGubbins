/**
 * Whether the selected profile is keeping the audio device fed (REQ-ARCH-083).
 *
 * An underrun is the device asking for samples the feed did not have ready,
 * heard as a click or a drop-out. The runtime counts them on the audio thread
 * and reports them here at the context frame they were seen; this module turns
 * that history into a warning and a recommendation. It is written over values
 * and explicit context frames, with no clock of its own, so a test replays a
 * timeline exactly and the worklet, a worker and Node all read it alike.
 *
 * Only the last {@link STABILITY_WINDOW_SECONDS} matter: a burst an hour ago
 * says nothing about the settings now. Recording drops what has left the
 * window, so the history of a long session stays as small as its worst ten
 * seconds.
 */

import {
  fail,
  failure,
  FailureKind,
  succeed,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import {
  PerformanceProfile,
  PRESET_SETTINGS,
  PRESETS_BY_STABILITY,
  type PerformanceSettings,
} from './performance-profile.js';

/** How far back an assessment looks. */
export const STABILITY_WINDOW_SECONDS = 10;

/** Underruns seen at one context frame, as the feed reports them. */
export interface UnderrunEvent {
  readonly contextFrame: number;
  readonly count: number;
}

/** The underruns still inside the window, oldest first, at one context's rate. */
export interface UnderrunHistory {
  readonly contextRate: SampleRate;
  readonly events: readonly UnderrunEvent[];
}

/** What an assessment found, worded for the person who chose the profile. */
export interface StabilityAssessment {
  readonly stable: boolean;
  readonly underrunsInWindow: number;
  /** The next more stable preset, when there is one and it is needed. */
  readonly recommendation?: PerformanceProfile;
  readonly explanation: string;
}

/** An empty history for a context running at `contextRate`. */
export function createUnderrunHistory(contextRate: SampleRate): UnderrunHistory {
  return { contextRate, events: [] };
}

function windowFrames(history: UnderrunHistory): number {
  return STABILITY_WINDOW_SECONDS * history.contextRate;
}

/** The recorded events inside the window that ends at `contextFrame`. */
function inWindow(history: UnderrunHistory, contextFrame: number): readonly UnderrunEvent[] {
  const earliest = contextFrame - windowFrames(history);
  return history.events.filter(
    (event) => event.contextFrame > earliest && event.contextFrame <= contextFrame,
  );
}

/**
 * Records `count` underruns seen at `contextFrame`.
 *
 * Context frames only move forward within one context, so a frame before the
 * latest one recorded is a report from a context that has since been replaced;
 * the caller starts a new history for the new context rather than mixing two
 * timelines in one.
 */
export function recordUnderruns(
  history: UnderrunHistory,
  contextFrame: number,
  count = 1,
): DomainResult<UnderrunHistory> {
  if (!Number.isSafeInteger(contextFrame) || contextFrame < 0) {
    return fail(
      failure(
        'stability.context-frame-invalid',
        FailureKind.Rejected,
        `An underrun's context frame must be a whole number of at least zero; ${String(contextFrame)} was given.`,
      ),
    );
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return fail(
      failure(
        'stability.count-invalid',
        FailureKind.Rejected,
        `An underrun report must count at least one whole underrun; ${String(count)} was given.`,
      ),
    );
  }
  const latest = history.events.at(-1);
  if (latest !== undefined && contextFrame < latest.contextFrame) {
    return fail(
      failure(
        'stability.context-frame-out-of-order',
        FailureKind.Rejected,
        `An underrun at context frame ${String(contextFrame)} arrived after one at ` +
          `${String(latest.contextFrame)}; a new audio context needs a new history.`,
      ),
    );
  }
  const events = [...inWindow(history, contextFrame), { contextFrame, count }];
  return succeed({ contextRate: history.contextRate, events });
}

/**
 * The next more stable preset after the given settings.
 *
 * Custom settings are placed by how far their feed keeps ahead, which is what
 * buys the device its margin: the recommendation is the first preset that
 * keeps further ahead than they do.
 */
function moreStableThan(
  profile: PerformanceProfile,
  settings: PerformanceSettings,
): PerformanceProfile | undefined {
  if (profile === PerformanceProfile.Custom) {
    return PRESETS_BY_STABILITY.find(
      (preset) => PRESET_SETTINGS[preset].feedAheadMilliseconds > settings.feedAheadMilliseconds,
    );
  }
  return PRESETS_BY_STABILITY[PRESETS_BY_STABILITY.indexOf(profile) + 1];
}

const PROFILE_NAMES: Readonly<Record<PerformanceProfile, string>> = {
  [PerformanceProfile.LowLatency]: 'Low Latency',
  [PerformanceProfile.Balanced]: 'Balanced',
  [PerformanceProfile.MaximumStability]: 'Maximum Stability',
  [PerformanceProfile.Custom]: 'Custom',
};

function describeUnstable(
  underruns: number,
  recommendation: PerformanceProfile | undefined,
): string {
  const heard =
    `${String(underruns)} ${underruns === 1 ? 'underrun' : 'underruns'} in the last ` +
    `${String(STABILITY_WINDOW_SECONDS)} seconds: the audio device ran out of sound to play, ` +
    'which is heard as clicks or drop-outs.';
  if (recommendation === undefined) {
    return (
      `${heard} No preset keeps more audio buffered than these settings. Closing other ` +
      'demanding work, or a Custom profile with a longer feed, may help.'
    );
  }
  return `${heard} The ${PROFILE_NAMES[recommendation]} profile keeps more audio buffered and should play without them.`;
}

/**
 * Whether the device has been kept fed over the window ending at
 * `contextFrame`, and what to change if not.
 *
 * Any underrun is unstable: each one is audible, and REQ-ARCH-083 asks for a
 * warning when the configuration produces them. The recommendation never
 * changes anything itself; the person keeps the final say.
 */
export function assessStability(
  history: UnderrunHistory,
  contextFrame: number,
  profile: PerformanceProfile,
  settings: PerformanceSettings,
): StabilityAssessment {
  const underruns = inWindow(history, contextFrame).reduce((sum, event) => sum + event.count, 0);
  if (underruns === 0) {
    return {
      stable: true,
      underrunsInWindow: 0,
      explanation: `No underruns in the last ${String(STABILITY_WINDOW_SECONDS)} seconds.`,
    };
  }
  const recommendation = moreStableThan(profile, settings);
  return {
    stable: false,
    underrunsInWindow: underruns,
    ...(recommendation === undefined ? {} : { recommendation }),
    explanation: describeUnstable(underruns, recommendation),
  };
}
