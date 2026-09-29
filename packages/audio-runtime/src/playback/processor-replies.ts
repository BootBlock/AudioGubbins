/**
 * What each reply from a loaded processor means for the transport and the
 * status.
 *
 * A reply about a run counts only if the run is still the current one: a
 * `started`, an underrun or an end posted just before a halt reached the
 * processor arrives after the main thread has moved on, and the run it names is
 * how it is told apart. The load's own answer is the loaded processor's to
 * take, and a fault is handed back to the session, which owns what a fault
 * ends.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import { FromProcessorKind, type FromProcessor } from '../protocol/processor-messages.js';
import type { PlaybackState } from './playback-state.js';
import { withMeter, withProblem } from './playback-status.js';
import type { ProcessorRuns } from './processor-runs.js';
import type { StabilityWatch } from './stability-watch.js';

/** What a loaded processor's replies are read against. */
export interface ProcessorRepliesOptions {
  readonly runs: ProcessorRuns;
  readonly state: PlaybackState;
  readonly stability: StabilityWatch;
  readonly logger: Logger;
  /** Hears that processing stopped, and why. */
  readonly faulted: (problem: string) => void;
}

/** Applies a loaded processor's replies. */
export class ProcessorReplies {
  readonly #options: ProcessorRepliesOptions;

  constructor(options: ProcessorRepliesOptions) {
    this.#options = options;
  }

  /** Applies `reply` to the transport and the status. */
  readonly apply = (reply: FromProcessor): void => {
    const { runs, state, stability, logger } = this.#options;
    switch (reply.kind) {
      case FromProcessorKind.Started:
        if (runs.started(reply.run, reply.contextFrame)) {
          state.follow({ kind: 'play', contextFrame: reply.contextFrame });
        }
        return;
      case FromProcessorKind.Underrun: {
        // A run halted since is audio no longer playing, whatever it lacked.
        if (!runs.isRunning(reply.run)) return;
        const assessed = stability.underrun(reply.contextFrame, reply.frames);
        if (assessed !== undefined) state.update({ ...state.status, stability: assessed });
        return;
      }
      case FromProcessorKind.FeedsEnded:
        // An end of a run halted since, by a pause or a seek, is not the end of what plays now.
        if (!runs.isRunning(reply.run)) return;
        runs.halt();
        state.follow({ kind: 'reached-end', contextFrame: reply.contextFrame });
        return;
      case FromProcessorKind.Meter:
        state.update(withMeter(state.status, reply.node, { peak: reply.peak, rms: reply.rms }));
        return;
      case FromProcessorKind.ParameterRefused:
        logger.warning('A node refused a parameter, which keeps its value.', {
          node: reply.node,
          parameter: reply.name,
          code: reply.failures[0].code,
        });
        state.update(withProblem(state.status, reply.failures[0].summary));
        return;
      case FromProcessorKind.Fault:
        logger.error('The audio processor stopped.', { reason: reply.message });
        this.#options.faulted(reply.message);
        return;
      case FromProcessorKind.Loaded:
      case FromProcessorKind.Refused:
        // The load's answer, which the loaded processor takes itself.
        return;
    }
  };
}
