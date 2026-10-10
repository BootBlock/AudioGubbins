/**
 * How this package refuses: one constructor, so every refusal carries a code
 * under `import-export.` and a sentence the person can read.
 *
 * An export setting is never clamped to something that works (ADR-0092): a
 * value the format or the source cannot take is refused with the reason, and
 * the person changes it. Each code is stable, so the Export dialog can place a
 * refusal beside the control it is about.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** A refusal coded `import-export.<reason>`, saying why in a sentence. */
export function refusal(
  reason: string,
  sentence: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): DomainFailure {
  return failure(
    `import-export.${reason}`,
    FailureKind.Rejected,
    sentence,
    details === undefined ? undefined : { details },
  );
}

/** A step a job cannot take in the state it is in: a conflict, never a fault of the input. */
export function conflict(reason: string, sentence: string): DomainFailure {
  return failure(`import-export.${reason}`, FailureKind.Conflict, sentence);
}
