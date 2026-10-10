/**
 * How one request to the codec worker ends, and what a job is given to run:
 * each job answers once, and the worker names the request it answers.
 */

import {
  Cancelled,
  FailureKind,
  failure,
  type CancellationSignal,
  type DomainFailure,
  type SampleCount,
} from '@audiogubbins/domain';

import type { DecoderIdentity } from '../decoding/decoder-identity.js';
import { SourceUnreadable } from '../files/async-file-bytes.js';
import type { ImportAnalysis } from './codec-worker-messages.js';

/** How a request ended. */
export type JobEnd =
  | { readonly kind: 'analysed'; readonly analysis: ImportAnalysis }
  | { readonly kind: 'decoded'; readonly frames: SampleCount; readonly decoder: DecoderIdentity }
  | { readonly kind: 'encoded'; readonly frames: SampleCount }
  | { readonly kind: 'failed'; readonly failure: DomainFailure }
  | { readonly kind: 'cancelled' };

/** What a running job is given. */
export interface JobContext {
  readonly signal: CancellationSignal;
  /** Resolves after the events already queued for the worker have run. */
  readonly yieldToHost: () => Promise<void>;
  /** Hears the frames decoded or encoded so far. */
  readonly progress: (frames: number) => void;
}

/**
 * The end a job's thrown error means: cancelled where the job's signal was
 * cancelled and the error is its reason, failed where a read of the file
 * threw, and `undefined` for anything else, a fault in the code.
 */
export function endOfThrown(error: unknown, signal: CancellationSignal): JobEnd | undefined {
  if (signal.aborted && (error === signal.reason || error instanceof Cancelled)) {
    return { kind: 'cancelled' };
  }
  if (error instanceof SourceUnreadable) {
    return {
      kind: 'failed',
      failure: failure(
        'codec-runtime.unreadable',
        FailureKind.Retryable,
        'The file could not be read.',
        {
          details: { cause: error.thrown },
        },
      ),
    };
  }
  return undefined;
}
