/**
 * The names a person knows the entities of a difference by, so what differs
 * between two states can be said entity by entity rather than counted
 * (REQ-STOR-195).
 *
 * A difference names its entities by identifier, and an entity is named from
 * whichever state holds it: one added from the later state, one removed from
 * the earlier, one changed from the later. A take stack is known by its own
 * name, as every other entity is by its display name; an asset group by its
 * path from its root, as every refusal of its settings names it, a membership
 * by its region's or asset's name, and a preview scenario by its name. An
 * effect chain has no name of its own, so it is named for what names it, by the
 * one account of that which counts the groups (`projectChainUsers`): a track's
 * or a bus's effects, a group's processing, an asset's or a region's rack, or a
 * range of one. Only the entities the difference holds are looked up, and the
 * owners only of an effect chain that differs, so naming never walks the clips
 * of a large project.
 */

import type { EffectChainId, Project, TakeStack } from '@audiogubbins/domain';
import {
  groupPath,
  pathText,
  projectChainUsers,
  type GameAssetGroupId,
  type GamePreviewScenario,
  type GamePreviewScenarioId,
  type GroupMember,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import { gameEntities, type GameMemberEntity } from './game-entities.js';
import type { EntityDifferences, StateDifference } from './state-diff.js';

/** What names an effect chain, by the kind and name of its owner, and how. */
export interface ChainOwner {
  readonly kind: 'track' | 'bus' | 'game-group' | 'asset' | 'region';
  /** Whether the chain processes the whole of its owner, or a range of it. */
  readonly naming: 'whole' | 'range';
  /** The owner's name; a group's is its path from its root. */
  readonly name: string;
}

/** A group's name as a difference says it: its path from its root. */
export function gameGroupName(state: ProjectState, group: GameAssetGroupId): string | undefined {
  const groups = state.gameAudio?.groups;
  return groups?.has(group) === true ? pathText(groupPath(groups, group)) : undefined;
}

/**
 * What names the chain `chain` in `state`, the first of its users: a track, a
 * bus, a group's processing, an asset's rack, a region's rack, then a range of
 * an asset or a region; `undefined` where nothing names it. A group comes
 * before the racks, since the members that inherit its chain have it as their
 * rack because the group names it.
 */
export function chainOwner(state: ProjectState, chain: EffectChainId): ChainOwner | undefined {
  const { project } = state;
  const users = projectChainUsers(project, state.gameAudio, chain);
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
  const [group] = users.groups;
  const grouped = group === undefined ? undefined : gameGroupName(state, group);
  return (
    owned('track', 'whole', users.tracks, project.tracks) ??
    owned('bus', 'whole', users.buses, project.buses) ??
    (grouped === undefined ? undefined : { kind: 'game-group', naming: 'whole', name: grouped }) ??
    owned('asset', 'whole', users.assetRacks, project.assets) ??
    owned('region', 'whole', users.regionRacks, project.regions) ??
    owned('asset', 'range', users.assetEdits, project.assets) ??
    owned('region', 'range', users.regionEdits, project.regions)
  );
}

/** The name of each entity a difference holds, by identifier. */
export interface DifferenceNames {
  /**
   * Assets, tracks, buses, clips, regions, markers, take stacks, asset groups
   * and preview scenarios by identifier, and memberships by their member's key.
   */
  readonly entities: ReadonlyMap<string, string>;

  /** The owner of each effect chain, where one holds it. */
  readonly chains: ReadonlyMap<EffectChainId, ChainOwner>;
}

/**
 * Names in `entities` each entity `differences` holds, from whichever state
 * holds it: one added from the later, one removed from the earlier, one
 * changed from the later. A source differs as its own entity and is named for
 * its asset.
 */
function nameEach<TId extends string, TDiffered, TEntity>(
  entities: Map<string, string>,
  differences: EntityDifferences<TId, TDiffered>,
  later: ReadonlyMap<TId, TEntity>,
  earlier: ReadonlyMap<TId, TEntity>,
  nameOf: (entity: TEntity) => string | undefined,
): void {
  const name = (id: TId, ...holders: readonly ReadonlyMap<TId, TEntity>[]): void => {
    for (const holder of holders) {
      const found = holder.get(id);
      const named = found === undefined ? undefined : nameOf(found);
      if (named === undefined) continue;
      entities.set(id, named);
      return;
    }
  };
  for (const id of differences.added) name(id, later);
  for (const id of differences.removed) name(id, earlier);
  for (const { id } of differences.changed) name(id, later, earlier);
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
  nameEach(entities, difference.assets, is.assets, was.assets, displayed);
  nameEach(entities, difference.sources, is.assets, was.assets, displayed);
  nameEach(entities, difference.tracks, is.tracks, was.tracks, displayed);
  nameEach(entities, difference.buses, is.buses, was.buses, displayed);
  nameEach(entities, difference.clips, is.clips, was.clips, displayed);
  nameEach(entities, difference.regions, is.regions, was.regions, displayed);
  nameEach(entities, difference.markers, is.markers, was.markers, displayed);
  nameEach(entities, difference.takeStacks, is.takeStacks, was.takeStacks, stackName);
  nameEach(
    entities,
    difference.gameGroups,
    gameEntities(after.gameAudio).groups,
    gameEntities(before.gameAudio).groups,
    // A group is named by its path in the state that holds it.
    ({ id }) => gameGroupName(after, id) ?? gameGroupName(before, id),
  );
  nameEach(
    entities,
    difference.gameMembers,
    gameEntities(after.gameAudio).members,
    gameEntities(before.gameAudio).members,
    ({ member }: GameMemberEntity) => memberName(is, member) ?? memberName(was, member),
  );
  nameEach(
    entities,
    difference.gameScenarios,
    after.gameAudio?.scenarios ?? NO_SCENARIOS,
    before.gameAudio?.scenarios ?? NO_SCENARIOS,
    ({ name }: GamePreviewScenario) => name,
  );
  return { entities, chains: chainOwners(difference, after, before) };
}

const NO_SCENARIOS: ReadonlyMap<GamePreviewScenarioId, GamePreviewScenario> = new Map();

/** Anything a person knows by a name. */
interface Named {
  readonly displayName: string;
}

const displayed = ({ displayName }: Named): string => displayName;

const stackName = ({ name }: TakeStack): string => name;

/** A member's name: its region's or asset's, where `project` holds it. */
function memberName(project: Project, member: GroupMember): string | undefined {
  return member.kind === 'region'
    ? project.regions.get(member.region)?.displayName
    : project.assets.get(member.asset)?.displayName;
}

/** The owner of each effect chain that differs, from the later state, then the earlier. */
function chainOwners(
  difference: StateDifference,
  ...states: readonly ProjectState[]
): ReadonlyMap<EffectChainId, ChainOwner> {
  const owners = new Map<EffectChainId, ChainOwner>();
  for (const { id } of difference.effectChains) {
    for (const state of states) {
      const owner = chainOwner(state, id);
      if (owner === undefined) continue;
      owners.set(id, owner);
      break;
    }
  }
  return owners;
}
