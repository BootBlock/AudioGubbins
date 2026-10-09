/**
 * The names a person knows the entities of a difference by, so what differs
 * between two states can be said entity by entity rather than counted
 * (REQ-STOR-195).
 *
 * A difference names its entities by identifier, and an entity is named from
 * whichever state holds it: one added from the later state, one removed from
 * the earlier, one changed from the later. An effect chain has no name of its
 * own, so it is named for what names it, by the domain's one account of that
 * (`chainUsers`): a track's or a bus's effects, an asset's or a region's rack,
 * or a range of one. Only the entities the difference holds are looked up, and
 * the owners only of an effect chain that differs, so naming never walks the
 * clips of a large project.
 */

import { chainUsers, type EffectChainId, type Project } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import type { EntityDifferences, StateDifference } from './state-diff.js';

/** What names an effect chain, by the kind and name of its owner, and how. */
export interface ChainOwner {
  readonly kind: 'track' | 'bus' | 'asset' | 'region';
  /** Whether the chain processes the whole of its owner, or a range of it. */
  readonly naming: 'whole' | 'range';
  readonly name: string;
}

/**
 * What names the chain `chain` in `project`, the first of its users: a track,
 * a bus, an asset's rack, a region's rack, then a range of an asset or a
 * region; `undefined` where nothing names it.
 */
export function chainOwner(project: Project, chain: EffectChainId): ChainOwner | undefined {
  const users = chainUsers(project, chain);
  const owned = (
    kind: ChainOwner['kind'],
    naming: ChainOwner['naming'],
    ids: readonly string[],
    holder: ReadonlyMap<string, Named>,
  ): ChainOwner | undefined => {
    const [first] = ids;
    const found = first === undefined ? undefined : holder.get(first);
    return found === undefined ? undefined : { kind, naming, name: found.displayName };
  };
  return (
    owned('track', 'whole', users.tracks, project.tracks) ??
    owned('bus', 'whole', users.buses, project.buses) ??
    owned('asset', 'whole', users.assetRacks, project.assets) ??
    owned('region', 'whole', users.regionRacks, project.regions) ??
    owned('asset', 'range', users.assetEdits, project.assets) ??
    owned('region', 'range', users.regionEdits, project.regions)
  );
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
  const owners = new Map<EffectChainId, ChainOwner>();
  for (const { id } of difference.effectChains) {
    for (const project of projects) {
      const owner = chainOwner(project, id);
      if (owner === undefined) continue;
      owners.set(id, owner);
      break;
    }
  }
  return owners;
}
