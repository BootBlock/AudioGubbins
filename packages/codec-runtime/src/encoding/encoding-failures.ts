/**
 * The failures of opening and running an export's encoder, each with a code
 * that means one thing wherever it is raised.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/**
 * A setting the export's settings name that the encoder AudioGubbins ships
 * cannot express, refused rather than replaced by one it can.
 */
export function unexpressible(summary: string, setting: string): DomainFailure {
  return failure('codec-runtime.setting-unexpressible', FailureKind.Rejected, summary, {
    details: { setting },
  });
}

/** An encoder the format needs that this worker has not got. */
export function encoderUnavailable(summary: string): DomainFailure {
  return failure('codec-runtime.encoder-unavailable', FailureKind.Rejected, summary);
}

/** A prebuilt encoder's module that is not the build AudioGubbins drives. */
export function prebuiltRefused(summary: string, details?: Record<string, string>): DomainFailure {
  return failure(
    'codec-runtime.prebuilt-encoder-refused',
    FailureKind.Unrecoverable,
    summary,
    details === undefined ? undefined : { details },
  );
}

/** A call a prebuilt encoder refused or trapped in. */
export function prebuiltFailed(call: string, reason: string): DomainFailure {
  return failure(
    'codec-runtime.prebuilt-encoder-failed',
    FailureKind.Unrecoverable,
    `The prebuilt encoder failed in ${call}: ${reason}.`,
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
