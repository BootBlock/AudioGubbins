/**
 * One playback request's sources, made in the feeder worker and kept there
 * until the request is replaced.
 *
 * They are made once for a request, not once for each load of it, so a graph
 * loaded again on a new audio context after a loss plays the same sources:
 * recorded audio crosses to the feeder transferred, and the main thread holds
 * no copy to send again. The feeder's answer is waited for a bounded time, as
 * the processor's is, since a worker that never started never answers.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import {
  FromFeederKind,
  ToFeederKind,
  type FailureSummary,
  type FromFeeder,
} from '../protocol/feeder-messages.js';
import { sourceTransferables } from '../protocol/source-descriptions.js';
import type { Schedule } from '../schedule.js';
import type { FeederLink } from './feeder-link.js';
import { PlaybackDspKind, type PlaybackDsp } from './playback-dsp.js';
import type { PlaybackRequest } from './playback-preparation.js';
import type { DspStatus } from './playback-status.js';

/** How long the feeder has to answer for a request's sources. */
const SOURCES_ANSWER_MILLISECONDS = 10_000;

/** How the making of a request's sources ended. */
export type SourcesOutcome =
  | { readonly kind: 'made'; readonly dsp: DspStatus }
  | { readonly kind: 'refused'; readonly failures: readonly [FailureSummary, ...FailureSummary[]] }
  | { readonly kind: 'unanswered' }
  /** Ended from outside: the request was replaced or the session disposed. */
  | { readonly kind: 'abandoned' };

/** What a request's sources are made with. */
export interface RequestSourcesOptions {
  readonly feeder: FeederLink;
  readonly request: PlaybackRequest;
  /** The request's name in the feeder, a whole number raised with each request. */
  readonly id: number;
  readonly dsp: PlaybackDsp;
  readonly schedule: Schedule;
  readonly logger: Logger;
}

/** One request's sources in the feeder. */
export class RequestSources {
  readonly request: PlaybackRequest;
  readonly id: number;
  /** The feeder that holds them. */
  readonly feeder: FeederLink;
  /** Settles once, with how the making ended. */
  readonly made: Promise<SourcesOutcome>;
  readonly #stopListening: () => void;
  readonly #cancelWait: () => void;
  #settle: (outcome: SourcesOutcome) => void = () => undefined;
  #settled = false;

  /** Sends the request's sources to the feeder to be made. */
  constructor(options: RequestSourcesOptions) {
    const { feeder, request, id, dsp, schedule, logger } = options;
    this.request = request;
    this.id = id;
    this.feeder = feeder;
    this.made = new Promise<SourcesOutcome>((resolve) => {
      this.#settle = resolve;
    });
    this.#stopListening = feeder.subscribe(this.#reply);
    this.#cancelWait = schedule(() => {
      logger.error('The feeder did not answer for the sources in time.');
      this.#end({ kind: 'unanswered' });
    }, SOURCES_ANSWER_MILLISECONDS);
    feeder.send(
      {
        kind: ToFeederKind.Sources,
        request: id,
        graph: request.graph,
        sources: request.sources,
        dspModule: dsp.kind === PlaybackDspKind.Compiled ? dsp.module : undefined,
        dspUnavailable: dsp.kind === PlaybackDspKind.Unavailable ? dsp.reason : undefined,
      },
      sourceTransferables(request.sources),
    );
  }

  /** Lets the feeder release the sources, which nothing will play again. */
  release(): void {
    this.#end({ kind: 'abandoned' });
    this.feeder.send({ kind: ToFeederKind.Release, request: this.id });
  }

  /** Stops waiting, without a word to the feeder, which has gone. */
  abandon(): void {
    this.#end({ kind: 'abandoned' });
  }

  readonly #reply = (reply: FromFeeder): void => {
    switch (reply.kind) {
      case FromFeederKind.SourcesMade:
        if (reply.request !== this.id) return;
        this.#end({
          kind: 'made',
          dsp: {
            implementation: reply.dsp,
            fallbackReason: reply.dspFallbackReason,
            inUse: reply.dspInUse,
          },
        });
        return;
      case FromFeederKind.SourcesRefused:
        if (reply.request === this.id) this.#end({ kind: 'refused', failures: reply.failures });
        return;
      case FromFeederKind.Fault:
        // A feeder that cannot act on a message may have dropped this one.
        this.#end({
          kind: 'refused',
          failures: [{ code: 'playback.feeder-fault', summary: reply.message }],
        });
        return;
      case FromFeederKind.Primed:
      case FromFeederKind.FeedFailed:
        return;
    }
  };

  #end(outcome: SourcesOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#cancelWait();
    this.#stopListening();
    this.#settle(outcome);
  }
}
