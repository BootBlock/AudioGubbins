/**
 * The names a person knows the entities of a difference by, so what differs
 * between two states can be said entity by entity rather than counted
 * (REQ-STOR-195).
 *
 * A difference names its entities by identifier, and an entity is named from
 * whichever state holds it: one added from the later state, one removed from
 * the earlier, one changed from the later. An effect chain has no name of its
 * own, so it is named for the track or bus it belongs to. Only the entities
 * the difference holds are looked up, and the tracks and buses once where an
 * effect chain differs, so naming never walks the clips of a large project.
 */

import type { EffectChainId, Project } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EntityDifferences, StateDifference } from './state-diff.js';

/** What an effect chain belongs to, by the kind and name of its owner. */
export interface ChainOwner {
  readonly kind: 'track' | 'bus';
  readonly name: string;
}

/** The name of each entity a difference holds, by identifier. */
export interface DifferenceNames {
  /** Assets, tracks, buses, clips, regions and markers, by identifier. */
  readonly entities: ReadonlyMap<string, string>;

  /** The owner of each effect chain, where one holds it. */
  readonly chains: ReadonlyMap<EffectChainId, ChainOwner>;
}

/** The names of what `difference`, from `before` to `after`, holds. */
export function differenceNames(
  before: ProjectState,
  after: ProjectState,
  difference: StateDifference,
): DifferenceNames {
  const was = before.project;
  const is = after.project;
  const entities = new Map<string, string>();
  const name = (id: string, ...holders: readonly (ReadonlyMap<string, Named> | undefined)[]) => {
    for (const holder of holders) {
      const found = holder?.get(id);
      if (found !== undefined) {
        entities.set(id, found.displayName);
        return;
      }
    }
  };
  const nameAll = <TId extends string, TEntity>(
    differences: EntityDifferences<TId, TEntity>,
    later: ReadonlyMap<TId, Named>,
    earlier: ReadonlyMap<TId, Named>,
  ): void => {
    for (const id of differences.added) name(id, later);
    for (const id of differences.removed) name(id, earlier);
    for (const { id } of differences.changed) name(id, later, earlier);
  };
  nameAll(difference.assets, is.assets, was.assets);
  nameAll(difference.sources, is.assets, was.assets);
  nameAll(difference.tracks, is.tracks, was.tracks);
  nameAll(difference.buses, is.buses, was.buses);
  nameAll(difference.clips, is.clips, was.clips);
  nameAll(difference.regions, is.regions, was.regions);
  nameAll(difference.markers, is.markers, was.markers);
  return { entities, chains: chainOwners(difference, is, was) };
}

/** Anything a person knows by a name. */
interface Named {
  readonly displayName: string;
}

/** The owner of each effect chain that differs, from the later project, then the earlier. */
function chainOwners(
  difference: StateDifference,
  ...projects: readonly Project[]
): ReadonlyMap<EffectChainId, ChainOwner> {
  const wanted = new Set(difference.effectChains.map(({ id }) => id));
  const owners = new Map<EffectChainId, ChainOwner>();
  if (wanted.size === 0) return owners;
  for (const project of projects) {
    for (const track of project.tracks.values()) {
      const chain = track.effectChainId;
      if (chain !== undefined && wanted.has(chain) && !owners.has(chain)) {
        owners.set(chain, { kind: 'track', name: track.displayName });
      }
    }
    for (const bus of project.buses.values()) {
      const chain = bus.effectChainId;
      if (chain !== undefined && wanted.has(chain) && !owners.has(chain)) {
        owners.set(chain, { kind: 'bus', name: bus.displayName });
      }
    }
  }
  return owners;
}
