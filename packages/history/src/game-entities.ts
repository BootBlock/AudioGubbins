/**
 * A project's asset groups and memberships as the entities a difference
 * compares (ADR-0106, REQ-STOR-195): each group by its identifier and each
 * membership by its member's key, with every field a person may have changed
 * one field of the entity.
 *
 * A group's policy is spread into its fields, so a change of its bus is a
 * change of `bus`, said as such, rather than of a policy compared whole; and
 * a group holds its members in assignment order, which is the order its pool
 * is chosen in and its members numbered by, so a member joining, leaving or
 * moving within a group is a difference of the group as well as of the
 * member. The order of members of different groups among each other means
 * nothing to either group, so it is no difference.
 *
 * A state's entities are made once for each state value, which is never
 * changed, and kept for as long as the state is, so the many differences one
 * state takes part in make them once.
 */

import {
  memberKey,
  type GameAssetGroup,
  type GameAssetGroupId,
  type GameAudioState,
  type GroupMember,
  type InheritedPolicy,
  type MemberProcessing,
  type PolicyOverrides,
} from '@audiogubbins/game-audio';

/** A group as a difference compares it. */
export type GameGroupEntity = Omit<GameAssetGroup, 'policy'> &
  InheritedPolicy & {
    /** The keys of its members, in assignment order. */
    readonly members: readonly string[];
  };

/** A membership as a difference compares it: its member's group, processing and overrides. */
export type GameMemberEntity = {
  readonly member: GroupMember;
  readonly group: GameAssetGroupId;
  readonly processing: MemberProcessing;
} & PolicyOverrides;

/** A state's groups and memberships as entities, the memberships by their member's key. */
export interface GameEntities {
  readonly groups: ReadonlyMap<GameAssetGroupId, GameGroupEntity>;
  readonly members: ReadonlyMap<string, GameMemberEntity>;
}

/** What a project with no game-audio state holds. */
const NO_GAME_ENTITIES: GameEntities = { groups: new Map(), members: new Map() };

const made = new WeakMap<GameAudioState, GameEntities>();

function entitiesOf(state: GameAudioState): GameEntities {
  const membersOf = new Map<GameAssetGroupId, string[]>();
  const members = new Map<string, GameMemberEntity>();
  for (const { member, group, processing, overrides } of state.memberships) {
    const key = memberKey(member);
    members.set(key, { ...overrides, member, group, processing });
    const held = membersOf.get(group);
    if (held === undefined) membersOf.set(group, [key]);
    else held.push(key);
  }
  const groups = new Map<GameAssetGroupId, GameGroupEntity>();
  for (const { policy, ...group } of state.groups.values()) {
    groups.set(group.id, { ...policy, ...group, members: membersOf.get(group.id) ?? [] });
  }
  return { groups, members };
}

/** The entities of `state`, or none where the project has no game-audio state. */
export function gameEntities(state: GameAudioState | undefined): GameEntities {
  if (state === undefined) return NO_GAME_ENTITIES;
  const held = made.get(state);
  if (held !== undefined) return held;
  const entities = entitiesOf(state);
  made.set(state, entities);
  return entities;
}
