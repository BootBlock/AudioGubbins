/**
 * The entities a change affected, from the states before and after it, which a
 * change node records so the History panel can say what each change touched and
 * filter by it (REQ-STOR-196).
 */

import {
  compareCodeUnits,
  type AffectedEntities,
  type ProjectState,
} from '@audiogubbins/project-format';

import { diffStates, type EntityDifferences } from './state-diff.js';

/** Every identifier the entities of one kind added, removed or changed. */
function touched<TId extends string, TEntity>(differences: EntityDifferences<TId, TEntity>): TId[] {
  return [...differences.added, ...differences.removed, ...differences.changed.map(({ id }) => id)];
}

/** Sorted, and each once. */
function settled<TId extends string>(ids: readonly TId[]): readonly TId[] {
  return [...new Set(ids)].sort(compareCodeUnits);
}

/**
 * What a change from `before` to `after` affected. An asset whose source
 * changed is affected, and so is a chain any of whose processors changed.
 */
export function affectedBy(before: ProjectState, after: ProjectState): AffectedEntities {
  const difference = diffStates(before, after);
  return {
    assets: settled([...touched(difference.assets), ...touched(difference.sources)]),
    tracks: settled(touched(difference.tracks)),
    buses: settled(touched(difference.buses)),
    clips: settled(touched(difference.clips)),
    regions: settled(touched(difference.regions)),
    markers: settled(touched(difference.markers)),
    effectChains: settled(difference.effectChains.map(({ id }) => id)),
    project: difference.project.length > 0,
  };
}
