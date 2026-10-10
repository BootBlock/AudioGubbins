/**
 * The designed failures of framing an encoder's output and of reading a
 * compressed file's metadata, one constructor each (REQ-EXEC-136.15).
 *
 * An encoder's frame that breaks its format's rules is an integrity failure:
 * nothing repairs an encoder's output after it (ADR-0091). Settings a format
 * cannot state are the caller's to change. Metadata past a reader's bound is
 * refused rather than cut, so what is kept is never a silently shortened tag.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** The failure of an encoded frame or packet that breaks its format's rules. */
export function invalidEncodedStream(problem: string): DomainFailure {
  return failure('codecs.encoded-stream-invalid', FailureKind.IntegrityViolation, problem);
}

/** The failure of a stream whose settings its container cannot state. */
export function unwritableStream(problem: string): DomainFailure {
  return failure('codecs.stream-unwritable', FailureKind.Rejected, problem);
}

/** The failure of a writer used after it finished or failed, which a writer refuses rather than guesses at. */
export function writerEnded(): DomainFailure {
  return failure(
    'codecs.writer-ended',
    FailureKind.Rejected,
    'The writer has finished or failed, and writes nothing more.',
  );
}

/** The failure of metadata larger than a reader keeps, naming what and the bound. */
export function metadataOverBound(what: string, bound: number): DomainFailure {
  return failure(
    'codecs.metadata-over-bound',
    FailureKind.Rejected,
    `The file's ${what} is larger than the ${String(bound)} AudioGubbins reads.`,
    { details: { what, bound } },
  );
}
