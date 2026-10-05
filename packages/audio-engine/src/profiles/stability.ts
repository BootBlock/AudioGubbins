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
 * says nothing about the settings now. The history is a ring of the events in
 * the window with their running sum, so recording one and assessing are each
 * a few steps whatever the session's length, and neither copies the history:
 * the runtime records a report's underruns up to thirty times a second while
 * a feed is starved.
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
import { counted } from '@audiogubbins/text';

/** How far back an assessment looks. */
export const STABILITY_WINDOW_SECONDS = 10;

/** What an assessment found, worded for the person who chose the profile. */
export interface StabilityAssessment {
  readonly stable: boolean;
  readonly underrunsInWindow: number;
  /** The next more stable preset, when there is one and it is needed. */
  readonly recommendation?: PerformanceProfile;
  readonly explanation: string;
}

/** The ring's places before it first grows: a few seconds of reports. */
const INITIAL_PLACES = 64;

/**
 * The underruns of one audio context still inside the window, oldest first,
 * at the context's rate.
 */
export class UnderrunHistory {
  readonly contextRate: SampleRate;
  readonly #windowFrames: number;
  #frames = new Float64Array(INITIAL_PLACES);
  #counts = new Float64Array(INITIAL_PLACES);
  #head = 0;
  #size = 0;

  /** The counts of every event held, kept as events come and go. */
  #sum = 0;

  constructor(contextRate: SampleRate) {
    this.contextRate = contextRate;
    this.#windowFrames = STABILITY_WINDOW_SECONDS * contextRate;
  }

  /** How many events it holds: those of the window ending at the latest one. */
  get size(): number {
    return this.#size;
  }

  /**
   * Records `count` underruns seen at `contextFrame`, and lets go of every
   * event that has left the window ending there.
   *
   * Context frames only move forward within one context, so a frame before
   * the latest one recorded is a report from a context that has since been
   * replaced; the caller starts a new history for the new context rather than
   * mixing two timelines in one.
   */
  record(contextFrame: number, count = 1): DomainResult<void> {
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
    const latest = this.#size === 0 ? undefined : this.#frameAt(this.#size - 1);
    if (latest !== undefined && contextFrame < latest) {
      return fail(
        failure(
          'stability.context-frame-out-of-order',
          FailureKind.Rejected,
          `An underrun at context frame ${String(contextFrame)} arrived after one at ` +
            `${String(latest)}; a new audio context needs a new history.`,
        ),
      );
    }
    const earliest = contextFrame - this.#windowFrames;
    while (this.#size > 0 && this.#frameAt(0) <= earliest) {
      this.#sum -= this.#countAt(0);
      this.#head = (this.#head + 1) % this.#frames.length;
      this.#size -= 1;
    }
    if (this.#size === this.#frames.length) this.#grow();
    const place = (this.#head + this.#size) % this.#frames.length;
    this.#frames[place] = contextFrame;
    this.#counts[place] = count;
    this.#size += 1;
    this.#sum += count;
    return succeed(undefined);
  }

  /** The underruns inside the window that ends at `contextFrame`, that frame included. */
  underrunsAt(contextFrame: number): number {
    const earliest = contextFrame - this.#windowFrames;
    let sum = this.#sum;
    // Only the events at either end can fall outside, and each scan stops at
    // the first inside: the history is in frame order.
    let first = 0;
    for (; first < this.#size && this.#frameAt(first) <= earliest; first += 1) {
      sum -= this.#countAt(first);
    }
    for (
      let last = this.#size - 1;
      last >= first && this.#frameAt(last) > contextFrame;
      last -= 1
    ) {
      sum -= this.#countAt(last);
    }
    return sum;
  }

  #frameAt(index: number): number {
    return this.#frames[(this.#head + index) % this.#frames.length] ?? 0;
  }

  #countAt(index: number): number {
    return this.#counts[(this.#head + index) % this.#frames.length] ?? 0;
  }

  /** Doubles the ring's places, the events kept in order from the first place. */
  #grow(): void {
    const frames = new Float64Array(this.#frames.length * 2);
    const counts = new Float64Array(this.#frames.length * 2);
    for (let index = 0; index < this.#size; index += 1) {
      frames[index] = this.#frameAt(index);
      counts[index] = this.#countAt(index);
    }
    this.#frames = frames;
    this.#counts = counts;
    this.#head = 0;
  }
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
    `${counted(underruns, 'underrun', 'underruns')} in the last ` +
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
  const underruns = history.underrunsAt(contextFrame);
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
