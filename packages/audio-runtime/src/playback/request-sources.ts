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
 *
 * The request they were made for may be followed by one that continues it
 * (ADR-0104): its edited sounds' new plans go to the same sources, which go on
 * into them without the feeds stopping, and the sources are then the new
 * request's, as a load of it after a lost context finds them.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleCount,
  succeed,
  type DomainFailure,
  type DomainResult,
  type FailureSummary,
  type SampleCount,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import { type ParameterChange, deliveredAs, type DspDelivery } from '@audiogubbins/audio-engine';

import type { CompiledDspModule } from '../dsp/dsp-delivery.js';
import { FromFeederKind, ToFeederKind, type FromFeeder } from '../protocol/feeder-messages.js';
import { sourceTransferables, type SourceDescription } from '../protocol/source-descriptions.js';
import type { Schedule } from '../schedule.js';
import type { FeederLink } from './feeder-link.js';
import type { PlaybackRequest } from './playback-preparation.js';
import type { DspStatus } from './playback-status.js';

/** How long the feeder has to answer for a request's sources, or for a change to them. */
const SOURCES_ANSWER_MILLISECONDS = 10_000;

/** What the person is told when the feeder never answers for a parameter change. */
const PARAMETERS_UNANSWERED_PROBLEM =
  'The feeder that reads the audio for playback did not answer for the change, so it is not known to be heard.';

/** What the person is told when the feeder never answers for a continued plan. */
const CONTINUATION_UNANSWERED_PROBLEM =
  'The feeder that reads the audio for playback did not answer for the new plan, so it is not known to be heard.';

/** The refusal of a continuation asked for after the feeder read past where the new plan may differ. */
const TOO_LATE = 'playback.continuation-too-late';

/**
 * How a continuation came out, where the feeder answered it: taken, its sounds
 * going on into their new plans from `frame`, or too late, the feeder having
 * read to `frame` already, from where a continuation may be made again.
 */
export type Continuation =
  | { readonly kind: 'continued'; readonly frame: SampleCount }
  | { readonly kind: 'too-late'; readonly frame: SampleCount };

/** The failures a reply carries, as the domain's. */
function failuresOf(
  summaries: readonly [FailureSummary, ...FailureSummary[]],
): readonly [DomainFailure, ...DomainFailure[]] {
  const [first, ...rest] = summaries;
  const rejected = (one: FailureSummary): DomainFailure =>
    failure(one.code, FailureKind.Rejected, one.summary);
  return [rejected(first), ...rest.map(rejected)];
}

/** A frame the feeder named, which its protocol reader has made a whole count. */
function frameOf(frame: number): SampleCount {
  const counted = sampleCount(frame);
  if (!counted.ok) throw new Error(counted.failures[0].summary);
  return counted.value;
}

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
  readonly id: number;
  /** The feeder that holds them. */
  readonly feeder: FeederLink;
  /** Settles once, with how the making ended. */
  readonly made: Promise<SourcesOutcome>;
  readonly #stopListening: () => void;
  readonly #cancelWait: () => void;
  readonly #schedule: Schedule;
  #request: PlaybackRequest;
  #changes = 0;
  #continuations = 0;
  #settle: (outcome: SourcesOutcome) => void = () => undefined;
  #settled = false;

  /** Sends the request's sources to the feeder to be made. */
  constructor(options: RequestSourcesOptions) {
    const { feeder, request, id, dsp, schedule, logger } = options;
    this.#request = request;
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

  /** The request the sources play: the one they were made for, or the last that continued it. */
  get request(): PlaybackRequest {
    return this.#request;
  }

  /**
   * Has the sources' edited sounds go on into the plans `sources` describes,
   * which `request` holds, where they can at or before timeline frame `from`,
   * and settles with how it came out; once taken, the sources are `request`'s.
   */
  continueWith(
    request: PlaybackRequest,
    sources: readonly SourceDescription[],
    from: SampleCount,
  ): Promise<DomainResult<Continuation>> {
    this.#continuations += 1;
    const continuation = this.#continuations;
    const { feeder } = this;
    return new Promise((resolve) => {
      const settle = (outcome: DomainResult<Continuation>): void => {
        stopListening();
        cancelWait();
        if (outcome.ok && outcome.value.kind === 'continued') this.#request = request;
        resolve(outcome);
      };
      const stopListening = feeder.subscribe((reply) => {
        if (reply.kind === FromFeederKind.Continued && reply.continuation === continuation) {
          settle(succeed({ kind: 'continued', frame: frameOf(reply.frame) }));
        } else if (
          reply.kind === FromFeederKind.ContinuationRefused &&
          reply.continuation === continuation
        ) {
          const { frame } = reply;
          settle(
            frame !== undefined && reply.failures.every((one) => one.code === TOO_LATE)
              ? succeed({ kind: 'too-late', frame: frameOf(frame) })
              : fail(...failuresOf(reply.failures)),
          );
        } else if (reply.kind === FromFeederKind.Fault) {
          settle(fail(failure('playback.feeder-fault', FailureKind.Retryable, reply.message)));
        }
      });
      const cancelWait = this.#schedule(() => {
        settle(
          fail(
            failure(
              'playback.continuation-unanswered',
              FailureKind.Retryable,
              CONTINUATION_UNANSWERED_PROBLEM,
            ),
          ),
        );
      }, SOURCES_ANSWER_MILLISECONDS);
      feeder.send(
        { kind: ToFeederKind.Continue, request: this.id, continuation, from, sources },
        sourceTransferables(sources),
      );
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
      case FromFeederKind.Continued:
      case FromFeederKind.ContinuationRefused:
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
