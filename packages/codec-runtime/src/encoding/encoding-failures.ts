/**
 * The failures of opening and running an export's encoder, each with a code
 * that means one thing wherever it is raised.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** An encoder the format needs that this worker has not got. */
export function encoderUnavailable(summary: string): DomainFailure {
  return failure('codec-runtime.encoder-unavailable', FailureKind.Rejected, summary);
}

/** An encoder module that is not one whose interface this runtime speaks. */
export function encoderModuleRefused(
  summary: string,
  details?: Record<string, string>,
): DomainFailure {
  return failure(
    'codec-runtime.encoder-module-refused',
    FailureKind.Unrecoverable,
    summary,
    details === undefined ? undefined : { details },
  );
}

/** A call an encoder module refused or trapped in. */
export function encoderModuleFailed(call: string, reason: string): DomainFailure {
  return failure(
    'codec-runtime.encoder-module-failed',
    FailureKind.Unrecoverable,
    `The encoder module failed in ${call}: ${reason}.`,
    { details: { call } },
  );
}

/** The browser's encoder failed, or answered what an M4A file cannot hold. */
export function browserEncoderFailed(summary: string): DomainFailure {
  return failure('codec-runtime.browser-encoder-failed', FailureKind.Unrecoverable, summary);
}

/** A block an export's writer cannot take. */
export function blockRefused(summary: string): DomainFailure {
  return failure('codec-runtime.block-refused', FailureKind.Rejected, summary);
}

/** A call on a writer that has finished or failed. */
export function writerEnded(): DomainFailure {
  return failure(
    'codec-runtime.writer-ended',
    FailureKind.Rejected,
    'An export writer that has finished or failed takes no more.',
  );
}
