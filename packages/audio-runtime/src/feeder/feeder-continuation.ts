/**
 * A request's edited sounds going on into plans that continue theirs, in the
 * feeder, without the feeds stopping (ADR-0104).
 *
 * Every source named is held between two reads first, so the frame each would
 * go on from, the first it has not read, is known before any goes on; then
 * either all go on or none does. They go on only at or before the frame the
 * main thread allowed, where the new plans may first differ, and only before
 * a source has given its last frame, after which its feed has ended. The
 * answer says the frame they went on from, the latest of theirs, or every
 * reason they did not and, where it is known, the frame, so the main thread
 * can make the continuation again from there.
 */

import {
  PcmDescriptionKind,
  type EditedSource,
  type HeldContinuation,
  type MediaEntry,
} from '@audiogubbins/audio-engine';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type EditPlan,
  type FailureSummary,
} from '@audiogubbins/domain';

import {
  FromFeederKind,
  type FromFeeder,
  type ToFeeder,
  type ToFeederKind,
} from '../protocol/feeder-messages.js';
import type { RequestSources } from './feeder-sources.js';

type ContinueMessage = Extract<ToFeeder, { readonly kind: typeof ToFeederKind.Continue }>;

type Failures = readonly [DomainFailure, ...DomainFailure[]];

/** An edited sound and the plan it goes on into. */
interface Continuing {
  readonly source: EditedSource;
  readonly plan: EditPlan;
  readonly media: readonly MediaEntry[];
}

function refusal(code: string, summary: string): Failures {
  return [failure(code, FailureKind.Rejected, summary)];
}

/** The code and summary alone: a failure's details and cause may hold what a structured clone cannot carry. */
function summarised({ code, summary }: DomainFailure): FailureSummary {
  return { code, summary };
}

function refused(message: ContinueMessage, failures: Failures, frame?: number): FromFeeder {
  const [first, ...rest] = failures;
  return {
    kind: FromFeederKind.ContinuationRefused,
    continuation: message.continuation,
    frame,
    failures: [summarised(first), ...rest.map(summarised)],
  };
}

/** Each source the message names, with the plan it goes on into, or why one cannot go on. */
function continuingOf(
  message: ContinueMessage,
  request: RequestSources,
): DomainResult<readonly Continuing[]> {
  const continuing: Continuing[] = [];
  for (const description of message.sources) {
    const source = request.edited.get(description.node);
    if (source === undefined || description.kind !== PcmDescriptionKind.Edited) {
      return fail(
        ...refusal(
          'playback.continuation-unmatched',
          `Only an edited sound goes on into a new plan, and ${description.node} does not play one.`,
        ),
      );
    }
    continuing.push({ source, plan: description.plan, media: description.media });
  }
  return succeed(continuing);
}

/** Why the continuations held cannot be taken, or `undefined` where they can. */
function heldRefusal(
  message: ContinueMessage,
  held: readonly HeldContinuation[],
  frame: number,
): Failures | undefined {
  if (held.some((one) => one.ended)) {
    return refusal(
      'playback.continuation-ended',
      'The sound it continues has played to its end, so it is loaded again to go on.',
    );
  }
  if (frame > message.from) {
    return refusal(
      'playback.continuation-too-late',
      `The feeder had read to frame ${String(frame)}, past frame ${String(message.from)}, where the new plan may differ.`,
    );
  }
  return undefined;
}

/**
 * Goes on with the edited sounds of `request` into the plans `message` gives,
 * or refuses, answering how it went; `current` says whether the request is
 * still loaded once every source is held.
 */
export async function continueSources(
  message: ContinueMessage,
  request: RequestSources,
  current: () => boolean,
): Promise<FromFeeder> {
  const continuing = continuingOf(message, request);
  if (!continuing.ok) return refused(message, continuing.failures);
  // Bounded by the graph's inputs; each holds its source between two reads.
  const answers = await Promise.all(
    continuing.value.map(({ source, plan, media }) => source.continueWith(plan, media)),
  );
  const held: HeldContinuation[] = [];
  const failures: DomainFailure[] = [];
  for (const answer of answers) {
    if (answer.ok) held.push(answer.value);
    else failures.push(...answer.failures);
  }
  const drop = (): void => {
    for (const one of held) one.drop();
  };
  const [firstFailure, ...otherFailures] = failures;
  if (firstFailure !== undefined) {
    drop();
    return refused(message, [firstFailure, ...otherFailures]);
  }
  if (!current()) {
    drop();
    return refused(
      message,
      refusal(
        'playback.continuation-superseded',
        'The sound it continues was replaced while it waited to go on.',
      ),
    );
  }
  const frame = Math.max(0, ...held.map((one) => one.frame));
  const refusedHeld = heldRefusal(message, held, frame);
  if (refusedHeld !== undefined) {
    drop();
    return refused(message, refusedHeld, frame);
  }
  for (const one of held) one.take();
  return { kind: FromFeederKind.Continued, continuation: message.continuation, frame };
}
