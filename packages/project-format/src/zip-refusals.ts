/**
 * The refusals reading a ZIP archive shares between its records, each with a
 * stable `zip.*` code (REQ-STOR-026, REQ-EXEC-136.15).
 *
 * The central directory and the local header both say how an entry is stored,
 * and both are refused in the same words, so a caller decides by code whichever
 * record was found wanting first.
 */

import {
  FailureKind,
  fail,
  failure,
  type DomainFailure,
  type DomainFailureResult,
} from '@audiogubbins/domain';

import { ENCRYPTION_FLAGS, STORED } from './zip-records.js';

/** A refusal of the archive, with a stable `zip.*` code. */
export function refuse(
  code: string,
  kind: FailureKind,
  summary: string,
  details?: Readonly<Record<string, string | number | boolean>>,
  cause?: DomainFailure,
): DomainFailureResult {
  return fail(
    failure(code, kind, summary, {
      ...(details === undefined ? {} : { details }),
      ...(cause === undefined ? {} : { cause }),
    }),
  );
}

/** The refusal of a read that returned other than the bytes asked for. */
export function shortRead(offset: number): DomainFailureResult {
  return refuse(
    'zip.short-read',
    FailureKind.IntegrityViolation,
    'The archive returned other than the bytes asked for, so it changed while it was read.',
    { offset },
  );
}

/** The refusal of an entry stored in a way no stored entry is read in. */
export function refuseMethod(flags: number, method: number): DomainFailureResult | undefined {
  if ((flags & ENCRYPTION_FLAGS) !== 0) {
    return refuse(
      'zip.encrypted',
      FailureKind.Rejected,
      'An entry is encrypted, and AudioGubbins reads no encrypted archive.',
    );
  }
  if (method !== STORED) {
    return refuse(
      'zip.compressed',
      FailureKind.Rejected,
      `An entry was compressed by another tool, with method ${String(method)}; AudioGubbins reads stored (uncompressed) entries alone, the form it writes, since audio does not compress.`,
      { method },
    );
  }
  return undefined;
}
