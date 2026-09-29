/**
 * The A/B comparison a project has open, as it is kept: the node or snapshot
 * each side was chosen by, and the side being listened to (REQ-STOR-195). The
 * choice's form is the format's (`writeComparisonChoice`), so a bundle carries
 * it as a checkpoint keeps it.
 *
 * Only the choice is kept. Each side is found again in the history when the
 * project is read, so a comparison always describes the history it is kept
 * with, and choosing, switching or reloading never touches either state.
 */

import { flatMapResult, mapResult, type DomainResult } from '@audiogubbins/domain';
import {
  comparisonSide,
  startComparison,
  switchSide,
  type Comparison,
  type ComparisonSide,
  type ComparisonSource,
  type History,
} from '@audiogubbins/history';
import type { ComparisonChoiceRecord } from '@audiogubbins/project-format';

/** The source a side was chosen by. */
function sourceOf(side: ComparisonSide): ComparisonSource {
  return side.snapshot === undefined
    ? { kind: 'node', node: side.node }
    : { kind: 'snapshot', snapshot: side.snapshot };
}

/** The choice a comparison holds. */
export function choiceOf(comparison: Comparison): ComparisonChoiceRecord {
  return { a: sourceOf(comparison.a), b: sourceOf(comparison.b), listening: comparison.listening };
}

/** The comparison a choice makes in a history, or why it makes none there. */
export function comparisonFrom(
  history: History,
  choice: ComparisonChoiceRecord,
): DomainResult<Comparison> {
  return flatMapResult(comparisonSide(history, choice.a), (a) =>
    flatMapResult(comparisonSide(history, choice.b), (b) =>
      mapResult(startComparison(a, b), (started) => switchSide(started, choice.listening)),
    ),
  );
}
