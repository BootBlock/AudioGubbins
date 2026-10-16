/**
 * A project's asset groups, memberships and preview scenarios as the entities
 * a difference compares (ADR-0106, REQ-STOR-195): each group by its
 * identifier, each membership by its member's key and each scenario by its
 * identifier, with every field a person may have changed one field of the
 * entity.
 *
 * A group's policy is spread into its fields, so a change of its bus is a
 * change of `bus`, said as such, rather than of a policy compared whole; and
 * a group holds its members in assignment order, which is the order its pool
 * is chosen in and its members numbered by, so a member joining, leaving or
 * moving within a group is a difference of the group as well as of the
 * member. The order of members of different groups among each other means
 * nothing to either group, so it is no difference.
 *
 * A scenario's parts are compared as the project format writes them, each
 * part one field: its emitters, listener and bus levels are values a person
 * edits whole in the preview panel, so a change of any emitter is a change of
 * `emitters`, said as such.
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
  type GamePreviewScenario,
  type GamePreviewScenarioId,
  type GroupMember,
  type InheritedPolicy,
  type MemberProcessing,
  type PolicyOverrides,
} from '@audiogubbins/game-audio';
import { canonicalJson, writePreviewScenario } from '@audiogubbins/project-format';

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

/** A scenario as a difference compares it: each part as the canonical text the project format writes. */
export type GameScenarioEntity = { readonly [K in keyof GamePreviewScenario]-?: string };

/** A state's groups, memberships and scenarios as entities, the memberships by their member's key. */
export interface GameEntities {
  readonly groups: ReadonlyMap<GameAssetGroupId, GameGroupEntity>;
  readonly members: ReadonlyMap<string, GameMemberEntity>;
  readonly scenarios: ReadonlyMap<GamePreviewScenarioId, GameScenarioEntity>;
}

/** What a project with no game-audio state holds. */
const NO_GAME_ENTITIES: GameEntities = {
  groups: new Map(),
  members: new Map(),
  scenarios: new Map(),
};

function scenarioEntity(scenario: GamePreviewScenario): GameScenarioEntity {
  const written = writePreviewScenario(scenario);
  const part = (key: keyof GamePreviewScenario): string => canonicalJson(written[key] ?? null);
  return {
    id: part('id'),
    name: part('name'),
    space: part('space'),
    panWidth: part('panWidth'),
    panningStrength: part('panningStrength'),
    listener: part('listener'),
    emitters: part('emitters'),
    seed: part('seed'),
    busLevels: part('busLevels'),
  };
}

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
  const scenarios = new Map(
    [...state.scenarios].map(([id, scenario]) => [id, scenarioEntity(scenario)] as const),
  );
  return { groups, members, scenarios };
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
