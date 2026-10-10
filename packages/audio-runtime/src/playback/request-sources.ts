/**
 * One playback request's sources, made in the feeder worker and kept there
 * until the request is replaced, which a parameter changed while the request
 * plays is given to, for the chains of its edited sounds to take running
 * (REQ-AUDIO-019).
 *
 * They are made once for a request, not once for each load of it, so a graph
 * loaded again on a new audio context after a loss plays the same sources:
 * recorded audio crosses to the feeder transferred, and the main thread holds
 * no copy to send again. The feeder's answer is waited for a bounded time, as
 * the processor's is, since a worker that never started never answers.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type FailureSummary,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import { type ParameterChange, deliveredAs, type DspDelivery } from '@audiogubbins/audio-engine';

import type { CompiledDspModule } from '../dsp/dsp-delivery.js';
import { FromFeederKind, ToFeederKind, type FromFeeder } from '../protocol/feeder-messages.js';
import { sourceTransferables } from '../protocol/source-descriptions.js';
import type { Schedule } from '../schedule.js';
import type { FeederLink } from './feeder-link.js';
import type { PlaybackRequest } from './playback-preparation.js';
import type { DspStatus } from './playback-status.js';

/** How long the feeder has to answer for a request's sources, or for a change to them. */
const SOURCES_ANSWER_MILLISECONDS = 10_000;

/** What the person is told when the feeder never answers for a parameter change. */
const PARAMETERS_UNANSWERED_PROBLEM =
  'The feeder that reads the audio for playback did not answer for the change, so it is not known to be heard.';

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
  readonly dsp: DspDelivery<CompiledDspModule>;
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
  readonly #schedule: Schedule;
  #changes = 0;
  #settle: (outcome: SourcesOutcome) => void = () => undefined;
  #settled = false;

  /** Sends the request's sources to the feeder to be made. */
  constructor(options: RequestSourcesOptions) {
    const { feeder, request, id, dsp, schedule, logger } = options;
    this.request = request;
    this.id = id;
    this.feeder = feeder;
    this.#schedule = schedule;
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
        quality: request.quality,
        dsp: deliveredAs(dsp, (module) => module.module),
      },
      sourceTransferables(request.sources),
    );
  }

  /**
   * Gives parameters changed while the request plays to its sources, and
   * settles with whether their chains took them running, or every reason
   * they did not.
   */
  changeParameters(changes: readonly ParameterChange[]): Promise<DomainResult<void>> {
    this.#changes += 1;
    const change = this.#changes;
    const { feeder } = this;
    return new Promise((resolve) => {
      const settle = (outcome: DomainResult<void>): void => {
        stopListening();
        cancelWait();
        resolve(outcome);
      };
      const stopListening = feeder.subscribe((reply) => {
        if (reply.kind === FromFeederKind.ParametersTaken && reply.change === change) {
          const [first, ...rest] = reply.refusals.map((one) =>
            failure(one.code, FailureKind.Rejected, one.summary),
          );
          settle(first === undefined ? succeed(undefined) : fail(first, ...rest));
        } else if (reply.kind === FromFeederKind.Fault) {
          settle(fail(failure('playback.feeder-fault', FailureKind.Retryable, reply.message)));
        }
      });
      const cancelWait = this.#schedule(() => {
        settle(
          fail(
            failure(
              'playback.parameters-unanswered',
              FailureKind.Retryable,
              PARAMETERS_UNANSWERED_PROBLEM,
            ),
          ),
        );
      }, SOURCES_ANSWER_MILLISECONDS);
      feeder.send({ kind: ToFeederKind.Parameters, request: this.id, change, changes });
    });
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
      case FromFeederKind.ParametersTaken:
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
