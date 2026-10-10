/**
 * A decoded import sent to the storage worker over its channel (ADR-0090):
 * the description, then each block as it is decoded, its planes moved rather
 * than copied, then the end with the frames decoded, each message under the
 * storage worker's credit.
 *
 * A decode that fails part way sends the failure, so the storage worker keeps
 * nothing; a cancelled one sends the cancellation the same way. The worker
 * gives its other work a turn before each block, so a cancellation sent while
 * a block decoded is heard before the next. Nothing of the stream is held but
 * the block in hand.
 */

import {
  FailureKind,
  failure,
  sampleCount,
  type CancellationSignal,
  type DomainFailure,
  type SampleCount,
} from '@audiogubbins/domain';
import type { DecodedStreamDescription, DecodedStreamMessage } from '@audiogubbins/import-export';

import type { CreditedSender } from '../streams/credited-sender.js';
import { WORK_CANCELLED } from '../work-cancelled.js';
import type { DecodedBlocks } from './decoded-blocks.js';

/** How a decoded stream ended. */
export type DecodeOutcome =
  | { readonly kind: 'decoded'; readonly frames: SampleCount }
  | { readonly kind: 'failed'; readonly failure: DomainFailure }
  | { readonly kind: 'cancelled' };

/** What sending a stream is given besides the stream. */
export interface DecodeStreamContext {
  readonly signal: CancellationSignal;
  /** Resolves after the events already queued for the worker have run. */
  readonly yieldToHost: () => Promise<void>;
  /** Hears the frames decoded so far, after each block. */
  readonly progress: (frames: number) => void;
}

/** The failure of a stream longer than any count of frames. */
const TOO_LONG: DomainFailure = failure(
  'codec-runtime.stream-too-long',
  FailureKind.Rejected,
  'The stream holds more frames than AudioGubbins can count.',
);

/**
 * Ends the stream with `reason`, unless the receiver ended it first, and
 * answers how it ended.
 */
async function endWith(
  sender: CreditedSender<DecodedStreamMessage>,
  reason: DomainFailure,
  outcome: DecodeOutcome,
): Promise<DecodeOutcome> {
  if (sender.refusal === undefined) await sender.send({ kind: 'failed', failure: reason }, []);
  return outcome;
}

/** Sends `blocks`, described by `description`, through `sender`, answering how the stream ended. */
export async function sendDecodedStream(
  blocks: DecodedBlocks,
  description: DecodedStreamDescription,
  sender: CreditedSender<DecodedStreamMessage>,
  context: DecodeStreamContext,
): Promise<DecodeOutcome> {
  const described = await sender.send({ kind: 'description', description }, []);
  if (!described.ok) return { kind: 'failed', failure: described.failures[0] };
  let frames = 0;
  for (;;) {
    await context.yieldToHost();
    if (context.signal.aborted) return await endWith(sender, WORK_CANCELLED, { kind: 'cancelled' });
    const block = await blocks.next();
    if (!block.ok) {
      const reason = block.failures[0];
      return await endWith(sender, reason, { kind: 'failed', failure: reason });
    }
    if (block.value === undefined) {
      const total = sampleCount(frames);
      if (!total.ok) return await endWith(sender, TOO_LONG, { kind: 'failed', failure: TOO_LONG });
      const ended = await sender.send({ kind: 'end', frames: total.value }, []);
      return ended.ok
        ? { kind: 'decoded', frames: total.value }
        : { kind: 'failed', failure: ended.failures[0] };
    }
    const { channels } = block.value;
    const sent = await sender.send(
      { kind: 'block', channels, frames: block.value.frames },
      channels.map((plane) => plane.buffer),
    );
    if (!sent.ok) return { kind: 'failed', failure: sent.failures[0] };
    frames += block.value.frames;
    context.progress(frames);
  }
}
