/**
 * Whether an edit was made by the version of an engine algorithm this build
 * has (REQ-AUDIO-145, ADR-0061): a stretch, a conversion of rate, a converted
 * insertion and a punch of a take at another rate each name the version they
 * were made by, and one another version made is refused where its plan is
 * built rather than heard as this build's would make it.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';

/**
 * Nothing, where an edit made by version `found` of the engine's `algorithm`
 * is made by the version this build has, `implemented`, or why it is not: an
 * edit another version made would be heard otherwise (REQ-AUDIO-145). An
 * edit that names no version, `found` absent, is refused the same way.
 */
export function versionKnown(
  algorithm: 'stretch' | 'resampler',
  found: number | undefined,
  implemented: number,
): DomainResult<void> {
  if (found === implemented) return succeed(undefined);
  const made =
    found === undefined
      ? `The edit names no version of the ${algorithm} it was made with`
      : `This build does not have version ${String(found)} of the ${algorithm} the edit was made with`;
  return fail(
    failure(
      'edit.algorithm-version-unknown',
      FailureKind.Unrecoverable,
      `${made}, but version ${String(implemented)}.`,
      { details: { algorithm, ...(found === undefined ? {} : { found }), implemented } },
    ),
  );
}
