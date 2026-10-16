/**
 * The walk from a group up its parents to its root (ADR-0101): the one account
 * of a group's ancestry, read by the validator, which reports where a walk
 * fails, and by resolution and naming, which read a validated forest.
 *
 * A walk visits each group at most once, so it ends on any map of groups, valid
 * or not: at a root, at a group it has already visited (a cycle), or at an
 * identifier the map does not hold.
 */

import type { GameAssetGroup } from './game-asset-group.js';
import type { GameAssetGroupId } from './group-ids.js';

/** Where a walk up the parents ended. */
export type AncestryEnd =
  | { readonly kind: 'root' }
  /** The walk came back to `at`, which is its own ancestor. */
  | { readonly kind: 'cycle'; readonly at: GameAssetGroupId }
  /** The walk reached `id`, a group or parent the forest does not hold. */
  | { readonly kind: 'unknown'; readonly id: GameAssetGroupId };

export interface Ancestry {
  /** The groups walked, the starting group first and each once. */
  readonly line: readonly GameAssetGroup[];
  readonly end: AncestryEnd;
}

/** The walk from `id` up its parents, on any map of groups. */
export function walkAncestry(
  groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>,
  id: GameAssetGroupId,
): Ancestry {
  const line: GameAssetGroup[] = [];
  const visited = new Set<GameAssetGroupId>();
  for (let next: GameAssetGroupId | undefined = id; next !== undefined;) {
    if (visited.has(next)) return { line, end: { kind: 'cycle', at: next } };
    const group = groups.get(next);
    if (group === undefined) return { line, end: { kind: 'unknown', id: next } };
    visited.add(next);
    line.push(group);
    next = group.parent;
  }
  return { line, end: { kind: 'root' } };
}

/**
 * `id` and its ancestors, nearest first, in a forest the validator has passed.
 * Throws where the walk does not reach a root: a caller that reads an
 * unvalidated state has a defect no answer here could hide.
 */
function ancestorsOf(
  groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>,
  id: GameAssetGroupId,
): readonly GameAssetGroup[] {
  const { line, end } = walkAncestry(groups, id);
  if (end.kind === 'cycle') {
    throw new Error(`Group ${end.at} is its own ancestor; only a validated state is resolved.`);
  }
  if (end.kind === 'unknown') {
    throw new Error(`Group ${end.id} is not in the forest; only a validated state is resolved.`);
  }
  return line;
}

/** The names of the groups from the root down to `id`, in a validated forest. */
export function groupPath(
  groups: ReadonlyMap<GameAssetGroupId, GameAssetGroup>,
  id: GameAssetGroupId,
): readonly string[] {
  return ancestorsOf(groups, id)
    .map((group) => group.name)
    .reverse();
}
