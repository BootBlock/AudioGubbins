/**
 * The underruns of one audio context, and what the engine makes of them.
 *
 * The verdict is the engine's `assessStability`; this keeps the history it
 * reads, one per context since context frames restart with a new one, and
 * takes the processor's reports, each with the underruns since the last. A
 * starved feed underruns every quantum until it is fed again, so the log
 * says so once, at the report an episode begins with, with the frame it was
 * heard at, and a drop-out a person reports can be found in a diagnostic
 * bundle without the bundle filling with the same line. An assessment is
 * answered only when it differs from the last, so a report that changes
 * nothing publishes nothing.
 */

import type { SampleRate } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  UnderrunHistory,
  assessStability,
  type PerformanceProfile,
  type PerformanceSettings,
  type StabilityAssessment,
} from '@audiogubbins/audio-engine';

/** What a watch assesses against. */
export interface StabilityWatchOptions {
  readonly profile: PerformanceProfile;
  readonly settings: PerformanceSettings;
  readonly logger: Logger;
}

function sameAssessment(one: StabilityAssessment, other: StabilityAssessment): boolean {
  return (
    one.stable === other.stable &&
    one.underrunsInWindow === other.underrunsInWindow &&
    one.recommendation === other.recommendation &&
    one.explanation === other.explanation
  );
}

/** One context's underruns, assessed. */
export class StabilityWatch {
  readonly #options: StabilityWatchOptions;
  readonly #history: UnderrunHistory;
  #assessment: StabilityAssessment | undefined;
  /** Whether the last report had underruns, so the next that has is not a new episode. */
  #starving = false;

  constructor(contextRate: SampleRate, options: StabilityWatchOptions) {
    this.#options = options;
    this.#history = new UnderrunHistory(contextRate);
  }

  /** The assessment as of `contextFrame`. */
  assess(contextFrame: number): StabilityAssessment {
    const { profile, settings } = this.#options;
    this.#assessment = assessStability(this.#history, contextFrame, profile, settings);
    return this.#assessment;
  }

  /**
   * Takes a report at `contextFrame` of `underruns` quanta that ran short,
   * `frames` frames in all, and answers the assessment after it where it
   * changed, or `undefined` where it did not.
   */
  report(contextFrame: number, underruns: number, frames: number): StabilityAssessment | undefined {
    const { logger } = this.#options;
    if (underruns > 0) {
      if (!this.#starving) {
        logger.warning('The audio device ran out of sound to play.', { contextFrame, frames });
      }
      const recorded = this.#history.record(contextFrame, underruns);
      if (!recorded.ok) {
        logger.warning('An underrun could not be recorded.', { code: recorded.failures[0].code });
      }
    }
    this.#starving = underruns > 0;
    const previous = this.#assessment;
    const next = this.assess(contextFrame);
    return previous !== undefined && sameAssessment(previous, next) ? undefined : next;
  }
}
