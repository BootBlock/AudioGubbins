/**
 * The designed failures of importing audio (ADR-0090, REQ-EXEC-136.15), one
 * constructor each, so a code means one thing wherever it is raised.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

import type { WavReadBackDifference } from './stored-wav.js';

/** A file the storage cannot hold with what the import needs, refused before anything is stored. */
export function importNeedsRoom(needed: number, available: number): DomainFailure {
  return failure(
    'import.no-room',
    FailureKind.Rejected,
    'The storage has too little room left for this file, so nothing of it was stored. Make room in Storage, or link the file rather than copying it.',
    { details: { needed, available } },
  );
}

/** A decoded stream that broke the order its messages come in, with what it did. */
export function streamOutOfOrder(problem: string): DomainFailure {
  return failure(
    'import.stream-out-of-order',
    FailureKind.IntegrityViolation,
    `The decoded audio arrived out of order (${problem}), so nothing of the file was kept.`,
  );
}

/** A decoded stream whose description cannot be an asset's audio. */
export function streamUndescribable(cause: DomainFailure): DomainFailure {
  return failure(
    'import.stream-undescribable',
    FailureKind.IntegrityViolation,
    `The decoder described audio AudioGubbins cannot hold: ${cause.summary}`,
    { details: { cause: cause.code } },
  );
}

/** A decoded stream that ended with no frame. */
export function streamEmpty(): DomainFailure {
  return failure(
    'import.stream-empty',
    FailureKind.Rejected,
    'The file decoded to no audio at all, so nothing of it was kept.',
  );
}

/** A rendition that did not read back as the audio decoded into it. */
export function renditionReadBackDiffers(found: WavReadBackDifference): DomainFailure {
  return failure(
    'import.rendition-read-back-differs',
    FailureKind.IntegrityViolation,
    'The decoded audio did not read back as it was written, so nothing of the file was kept.',
    { details: { found } },
  );
}

/** What the codec worker is told of an import the person cancelled. */
export function importCancelled(): DomainFailure {
  return failure('import.cancelled', FailureKind.Conflict, 'The import was cancelled.');
}

/** A file that needs decoding, where the window has no codec worker to decode it. */
export function decodingUnavailable(): DomainFailure {
  return failure(
    'import.decoding-unavailable',
    FailureKind.Rejected,
    'This file is compressed and needs decoding, and this window has no codec worker that can decode it.',
  );
}
