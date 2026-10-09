/**
 * The designed failures of reading an audio file, one constructor each, so a
 * code means one thing wherever it is raised (REQ-EXEC-136.15).
 *
 * The kinds say what a caller can do. A format this package does not read is
 * input the caller may replace with another file. A malformed header is data
 * that breaks the format's own rules, which nothing may repair silently. A file
 * that changed while it was read is a conflict: what was read is not one
 * version of it, though reading it again may succeed.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

import {
  READABLE_FORMATS_SENTENCE,
  formatSentence,
  type ReadableFormat,
  type RecognisedFormat,
} from './recognised-format.js';

/** The failure of a file in a format this package does not read. */
export function unsupportedFormat(
  format: Exclude<RecognisedFormat, ReadableFormat>,
): DomainFailure {
  return failure(
    'codecs.unsupported-format',
    FailureKind.Rejected,
    `${formatSentence(format)} ${READABLE_FORMATS_SENTENCE}`,
    { details: { format: format.kind } },
  );
}

/** The failure of a header that breaks its format's rules, with the sentence that says how. */
export function malformed(problem: string): DomainFailure {
  return failure('codecs.malformed', FailureKind.IntegrityViolation, problem);
}

/**
 * The failure of a sample rate AudioGubbins does not work at, naming the rate:
 * one the domain refuses, which is `cause`, or one that is not a whole number
 * of frames per second.
 */
export function unsupportedSampleRate(rate: string, cause?: DomainFailure): DomainFailure {
  return failure(
    'codecs.unsupported-sample-rate',
    FailureKind.Rejected,
    `This file's sample rate of ${rate} Hz is not one AudioGubbins can work at.`,
    { details: { rate }, ...(cause === undefined ? {} : { cause }) },
  );
}

/**
 * The failure of a read the source answered with fewer bytes than asked for,
 * within its size: the file changed or vanished while it was read.
 */
export function sourceChanged(offset: number, expected: number, received: number): DomainFailure {
  return failure(
    'codecs.source-changed',
    FailureKind.Conflict,
    'The file changed while it was read, so what was read is not one version of it.',
    { details: { offset, expected, received } },
  );
}

/** The failure of a read that starts after the last frame present. */
export function readPastEnd(start: number, frames: number): DomainFailure {
  return failure(
    'codecs.read-past-end',
    FailureKind.Rejected,
    'The read starts after the last frame the file holds.',
    { details: { start, frames } },
  );
}

/** The failure of a read asked for with a range or buffers it cannot be. */
export function readInvalid(problem: string): DomainFailure {
  return failure('codecs.read-invalid', FailureKind.Rejected, problem);
}

/**
 * The failure of a channel layout no WAV header can state so that reading the
 * file back gives the same layout: a recording written with another would
 * come back as audio whose channels mean something else.
 */
export function unwritableLayout(problem: string): DomainFailure {
  return failure('codecs.layout-unwritable', FailureKind.Rejected, problem);
}

/** The failure of a file too long for its byte offsets to be exact numbers. */
export function unwritableLength(frames: number, blockAlign: number): DomainFailure {
  return failure(
    'codecs.length-unwritable',
    FailureKind.Rejected,
    'The recording is too long for its file to be written with exact byte offsets.',
    { details: { frames, blockAlign } },
  );
}
