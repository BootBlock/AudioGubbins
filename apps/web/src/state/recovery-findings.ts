/**
 * What recovery found on opening a project that the person is told of: the one
 * reading of a recovery report's fields. The open project keeps a report only
 * where this finds something, and the shell says a sentence for each finding,
 * so a field is noticed by both or by neither.
 *
 * Every field of the report is either read here or named as unremarkable, and
 * the type checker holds that: a field added to the report fails to compile
 * until it is placed on one side or the other.
 */

import type { ProjectRecoveryReport } from '@audiogubbins/storage';

/** One thing recovery found that the person should hear of. */
export type RecoveryFinding =
  | { readonly kind: 'interrupted-recordings'; readonly recordings: number }
  | { readonly kind: 'fallback' }
  | { readonly kind: 'rebuilt-cursor-state' }
  | { readonly kind: 'journal-break'; readonly discarded: number }
  | { readonly kind: 'fenced'; readonly changes: number }
  | { readonly kind: 'missing-states'; readonly states: number };

/**
 * The report's fields no person needs telling of: which head the project was
 * opened from, and how many records replayed as they should.
 */
type Unremarkable = 'head' | 'replayed';

/** How each remaining field of a report is read for a finding. */
type Finders = Readonly<
  Record<
    Exclude<keyof ProjectRecoveryReport, Unremarkable>,
    (report: ProjectRecoveryReport) => RecoveryFinding | undefined
  >
>;

/** Each field's finding, in the order the person is told of them. */
const FINDERS: Finders = {
  // First: a recording cut short is offered to be recovered or discarded
  // before anything else is said or done with the project (ADR-0071).
  interruptedRecordings: ({ interruptedRecordings }) =>
    interruptedRecordings.length > 0
      ? { kind: 'interrupted-recordings', recordings: interruptedRecordings.length }
      : undefined,
  fallbacks: ({ fallbacks }) => (fallbacks.length > 0 ? { kind: 'fallback' } : undefined),
  rebuiltCursorState: ({ rebuiltCursorState }) =>
    rebuiltCursorState === undefined ? undefined : { kind: 'rebuilt-cursor-state' },
  journalBreak: ({ journalBreak }) =>
    journalBreak === undefined
      ? undefined
      : { kind: 'journal-break', discarded: journalBreak.discarded.length },
  fenced: ({ fenced }) =>
    fenced.length > 0 ? { kind: 'fenced', changes: fenced.length } : undefined,
  missingStates: ({ missingStates }) =>
    missingStates.length > 0 ? { kind: 'missing-states', states: missingStates.length } : undefined,
};

/** What recovery found that the person should hear of, in the order they hear it. */
export function recoveryFindings(report: ProjectRecoveryReport): readonly RecoveryFinding[] {
  return Object.values(FINDERS).flatMap((find) => find(report) ?? []);
}
