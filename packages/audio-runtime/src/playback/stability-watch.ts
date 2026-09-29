/**
 * The underruns of one audio context, and what the engine makes of them.
 *
 * The verdict is the engine's `assessStability`; this keeps the history it
 * reads, one per context since context frames restart with a new one, and
 * logs each underrun with the frame it was heard at, so a drop-out a person
 * reports can be found in a diagnostic bundle.
 */

import type { SampleRate } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  assessStability,
  createUnderrunHistory,
  recordUnderruns,
  type PerformanceProfile,
  type PerformanceSettings,
  type StabilityAssessment,
  type UnderrunHistory,
} from '@audiogubbins/audio-engine';

/** What a watch assesses against. */
export interface StabilityWatchOptions {
  readonly profile: PerformanceProfile;
  readonly settings: PerformanceSettings;
  readonly logger: Logger;
}

/** One context's underruns, assessed. */
export class StabilityWatch {
  readonly #options: StabilityWatchOptions;
  #history: UnderrunHistory;

  constructor(contextRate: SampleRate, options: StabilityWatchOptions) {
    this.#options = options;
    this.#history = createUnderrunHistory(contextRate);
  }

  /** The assessment as of `contextFrame`. */
  assess(contextFrame: number): StabilityAssessment {
    const { profile, settings } = this.#options;
    return assessStability(this.#history, contextFrame, profile, settings);
  }

  /**
   * Records an underrun of `frames` frames at `contextFrame`, and answers the
   * assessment after it, or `undefined` where the history refused it.
   */
  underrun(contextFrame: number, frames: number): StabilityAssessment | undefined {
    const { logger } = this.#options;
    logger.warning('The audio device ran out of sound to play.', { contextFrame, frames });
    const recorded = recordUnderruns(this.#history, contextFrame);
    if (!recorded.ok) {
      logger.warning('An underrun could not be recorded.', { code: recorded.failures[0].code });
      return undefined;
    }
    this.#history = recorded.value;
    return this.assess(contextFrame);
  }
}
