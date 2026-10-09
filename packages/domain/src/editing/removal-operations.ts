/**
 * Taking frames out of an asset's timeline by the existing edits (ADR-0051):
 * what a recommendation to remove silence becomes when a person applies it.
 *
 * A span at the timeline's start or end is cut away by one trim, which keeps
 * what lies between, and a span within it by a delete, which closes the gap.
 * Each operation's range is on the timeline as the operations before it left
 * it, so the deletes come last first, leaving every earlier position where it
 * was, and the trim follows them, its end moved back by what they took out.
 */

import { derivedSampleCount } from '../time/sample-time.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import type { EditRange } from './operations.js';

/** One edit that takes frames out: a trim, which keeps its range, or a delete, which removes it. */
export interface RemovalEdit {
  readonly kind: 'trim' | 'delete';
  readonly range: EditRange;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`editing.${code}`, FailureKind.Rejected, summary));
}

/**
 * The edits that take `removals` out of a timeline of `length` frames, in the
 * order they are applied, or why they cannot: a span outside the timeline,
 * empty, out of order or touching another, or spans that would leave nothing.
 */
export function removalEdits(
  removals: readonly EditRange[],
  length: number,
): DomainResult<readonly RemovalEdit[]> {
  let previous = -1;
  for (const { start, end } of removals) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > length) {
      return refused('removal-outside', 'A span to take out lies outside the audio.');
    }
    if (end <= start) return refused('removal-empty', 'A span to take out covers no audio.');
    if (start <= previous) {
      return refused('removal-order', 'The spans to take out are not in order and apart.');
    }
    previous = end;
  }
  const first = removals[0];
  const last = removals.at(-1);
  const leading = first?.start === 0 ? first : undefined;
  const trailing = last?.end === length ? last : undefined;
  const within = removals.filter((one) => one !== leading && one !== trailing);
  const removed = within.reduce((total, one) => total + (one.end - one.start), 0);
  const kept = { start: leading?.end ?? 0, end: (trailing?.start ?? length) - removed };
  if (kept.end <= kept.start) {
    return refused('removal-leaves-nothing', 'Taking out these spans would leave no audio.');
  }
  const edits: RemovalEdit[] = within
    .toReversed()
    .map((range): RemovalEdit => ({ kind: 'delete', range }));
  if (leading !== undefined || trailing !== undefined) {
    edits.push({
      kind: 'trim',
      range: { start: derivedSampleCount(kept.start), end: derivedSampleCount(kept.end) },
    });
  }
  return succeed(edits);
}
