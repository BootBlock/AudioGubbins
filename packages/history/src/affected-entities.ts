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

import { gameEntities } from './game-entities.js';
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
 * changed is affected, and so is a chain any of whose processors changed; a
 * change of a membership affects its region or asset and the groups it left
 * and joined, whose members it changed, and a change of a preview scenario
 * affects the project, whose test bench it is (ADR-0106).
 */
export function affectedBy(before: ProjectState, after: ProjectState): AffectedEntities {
  const difference = diffStates(before, after);
  const was = gameEntities(before.gameAudio).members;
  const is = gameEntities(after.gameAudio).members;
  // A membership that changed is in one of the two states, by its member's key.
  const members = touched(difference.gameMembers).flatMap((key) => {
    const entity = is.get(key) ?? was.get(key);
    return entity === undefined ? [] : [entity.member];
  });
  return {
    assets: settled([
      ...touched(difference.assets),
      ...touched(difference.sources),
      ...members.flatMap((member) => (member.kind === 'asset' ? [member.asset] : [])),
    ]),
    tracks: settled(touched(difference.tracks)),
    buses: settled(touched(difference.buses)),
    clips: settled(touched(difference.clips)),
    regions: settled([
      ...touched(difference.regions),
      ...members.flatMap((member) => (member.kind === 'region' ? [member.region] : [])),
    ]),
    markers: settled(touched(difference.markers)),
    effectChains: settled(difference.effectChains.map(({ id }) => id)),
    takeStacks: settled(touched(difference.takeStacks)),
    gameGroups: settled(touched(difference.gameGroups)),
    project: difference.project.length > 0 || touched(difference.gameScenarios).length > 0,
  };
}
