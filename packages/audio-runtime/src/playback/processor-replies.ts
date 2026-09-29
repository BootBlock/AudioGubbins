/**
 * What each reply from a loaded processor, and from the feeder feeding it,
 * means for the transport and the status.
 *
 * A reply about a run counts only if the run is still the current one: a
 * `started`, a report or an end posted just before a halt reached the
 * processor arrives after the main thread has moved on, and the run it names is
 * how it is told apart. The processor's count is the transport's: a start
 * anchors it, a report moves the anchor without publishing anything, a halt
 * after a pause settles where it paused, and the end stops it where the audio
 * ended. The load's own answer is the loaded processor's to take, and a fault
 * is handed back to the session, which owns what a fault ends.
 */

import { sampleCount, type SampleCount } from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { TransportEvent } from '@audiogubbins/audio-engine';

import { FromFeederKind, type FromFeeder } from '../protocol/feeder-messages.js';
import {
  FromProcessorKind,
  type FromProcessor,
  type MeterReport,
} from '../protocol/processor-messages.js';
import type { PlaybackState } from './playback-state.js';
import { withProblem, type MeterLevels } from './playback-status.js';
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
  /** Hears that a source could not be read while feeding the current run. */
  readonly feedFailed: (node: NodeId, reason: string) => void;
}

/** Each meter's levels after a report: the last levels, with those the report has replaced. */
function metersAfter(
  before: ReadonlyMap<NodeId, MeterLevels>,
  reports: readonly MeterReport[],
): ReadonlyMap<NodeId, MeterLevels> {
  const meters = new Map(before);
  for (const { node, peak, rms, correlation } of reports)
    meters.set(node, { peak, rms, correlation });
  return meters;
}

/** Applies a loaded processor's replies. */
export class ProcessorReplies {
  readonly #options: ProcessorRepliesOptions;

  constructor(options: ProcessorRepliesOptions) {
    this.#options = options;
  }

  /** Applies `reply` to the transport and the status. */
  readonly apply = (reply: FromProcessor): void => {
    const { runs, state, logger } = this.#options;
    switch (reply.kind) {
      case FromProcessorKind.Started:
        if (!runs.started(reply.run)) return;
        this.#follow(reply.position, (position) => ({
          kind: 'play',
          contextFrame: reply.contextFrame,
          position,
        }));
        return;
      case FromProcessorKind.Report:
        // A run halted since is audio no longer playing, whatever it reports.
        if (runs.isRunning(reply.run)) this.#report(reply);
        return;
      case FromProcessorKind.Halted:
        if (!runs.halted(reply.run)) return;
        this.#follow(reply.position, (position) => ({ kind: 'halted', position }));
        return;
      case FromProcessorKind.FeedsEnded:
        // An end of a run halted since, by a pause or a seek, is not the end of what plays now.
        if (!runs.isRunning(reply.run)) return;
        runs.stop();
        this.#follow(reply.position, (position) => ({ kind: 'reached-end', position }));
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

  /**
   * Takes a report of the run playing: its count anchors the clock and its
   * meters' levels are kept, neither published, and its underruns are
   * assessed, published only where the assessment changed.
   */
  #report(reply: Extract<FromProcessor, { readonly kind: typeof FromProcessorKind.Report }>): void {
    const { state, stability } = this.#options;
    const position = sampleCount(reply.position);
    if (position.ok) state.reanchor(reply.contextFrame, position.value);
    if (reply.meters.length > 0) state.showMeters(metersAfter(state.meters, reply.meters));
    const assessed = stability.report(reply.contextFrame, reply.underruns, reply.underrunFrames);
    if (assessed !== undefined) state.update({ ...state.status, stability: assessed });
  }

  /** Applies what the feeder says of the runs it feeds. */
  readonly applyFeeder = (reply: FromFeeder): void => {
    const { runs, logger } = this.#options;
    switch (reply.kind) {
      case FromFeederKind.Primed:
        runs.primed(reply.run);
        return;
      case FromFeederKind.FeedFailed:
        // A source that failed feeding a run since stopped fed nothing that plays.
        if (runs.isCurrent(reply.run)) this.#options.feedFailed(reply.node, reply.reason);
        return;
      case FromFeederKind.Fault:
        logger.error('The feeder stopped.', { reason: reply.message });
        this.#options.faulted(reply.message);
        return;
      case FromFeederKind.SourcesMade:
      case FromFeederKind.SourcesRefused:
        // A request's sources, which the loader waits on itself.
        return;
    }
  };

  /** Moves the transport by an event at the processor's count, which a count past the largest cannot. */
  #follow(counted: number, event: (position: SampleCount) => TransportEvent): void {
    const position = sampleCount(counted);
    if (position.ok) {
      this.#options.state.follow(event(position.value));
      return;
    }
    this.#options.logger.warning('The processor counted a position past the largest.', {
      position: counted,
    });
  }
}
