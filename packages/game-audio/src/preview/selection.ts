/**
 * Which member of an emitter's pool a trigger plays (ADR-0104, REQ-GAME-122).
 *
 * The pool is the subject's members in membership order. `uniform` takes
 * member ⌊u·n⌋; `avoid-recent(d)` sets aside the last min(d, n − 1) members
 * chosen, most recent first, and takes ⌊u·m⌋ of the m left in pool order, so
 * no member repeats within d choices where the pool leaves another. A choice
 * is `choiceOf` the trigger's selection word, exact in integers. Weighted,
 * sequential, ping-pong and shuffle-bag strategies are Phase 13's, added to
 * the same rule union over the same draws.
 */

import type { SelectionRule } from '../policy/playback-rules.js';
import { choiceOf } from './preview-draws.js';

/** The most choices any rule looks back over: the deepest `avoid-recent`. */
const DEEPEST_RECENT = 16;

/**
 * The index in a pool of `size` (at least 1) members that `rule` chooses by
 * `word`, given the `recent` choices, most recent first.
 */
export function chooseMember(
  rule: SelectionRule,
  size: number,
  recent: readonly number[],
  word: number,
): number {
  if (rule.kind === 'uniform') return choiceOf(word, size);
  const avoided = new Set(recent.slice(0, Math.min(rule.depth, size - 1)));
  let left = choiceOf(word, size - avoided.size);
  for (let index = 0; index < size; index += 1) {
    if (avoided.has(index)) continue;
    if (left === 0) return index;
    left -= 1;
  }
  throw new Error('A choice among the members left is one of them.');
}

/** `recent` with `chosen` as the most recent, holding no more than any rule reads. */
export function withChoice(recent: readonly number[], chosen: number): readonly number[] {
  return [chosen, ...recent.slice(0, DEEPEST_RECENT - 1)];
}
