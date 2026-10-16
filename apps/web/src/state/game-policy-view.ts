/**
 * The project's asset groups as the interface reads them (ADR-0101): the
 * forest in the order it is shown, each group's members in their assignment
 * order, and the effective policy of every member and group with the source of
 * each value.
 *
 * Derived, never kept: the policy is `@audiogubbins/game-audio`'s resolution
 * of the project state, worked out once per state value and dropped with it,
 * so the Asset groups panel, the Inspector and the commands read one answer
 * and none keeps a policy of its own. A state is a value, so an undo that
 * brings back an earlier state brings back its view, worked out again.
 */

import type { Project } from '@audiogubbins/domain';
import {
  groupPath,
  memberKey,
  resolveAll,
  resolveGroupPolicy,
  resolvePolicy,
  type EffectivePolicy,
  type GameAssetGroup,
  type GameAssetGroupId,
  type GameAudioState,
  type GroupEffectivePolicy,
  type GroupMember,
  type GroupMembership,
} from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

/** The game-audio state of a project with no groups. */
const NO_GROUPS: GameAudioState = { groups: new Map(), memberships: [] };

/** Names compared as a person reads a list, the same on every machine. */
const BY_NAME = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true });

/** The project's groups as the interface reads them (see the module comment). */
export interface GamePolicyView {
  readonly game: GameAudioState;

  /** The groups inside `parent`, or the forest's roots where it is absent, by name. */
  childrenOf(parent: GameAssetGroupId | undefined): readonly GameAssetGroup[];

  /** The memberships of `group`, in their assignment order. */
  membersOf(group: GameAssetGroupId): readonly GroupMembership[];

  /** `member`'s membership, or `undefined` where it is in no group. */
  membershipOf(member: GroupMember): GroupMembership | undefined;

  /** The names from the root down to `group`. */
  pathOf(group: GameAssetGroupId): readonly string[];

  /** What `member` resolves every field to, with each value's source. */
  member(member: GroupMember): EffectivePolicy;

  /** What `group`'s members inherit, with each value's source. */
  group(group: GameAssetGroupId): GroupEffectivePolicy;
}

/** The view of `game` over `project`, each answer worked out on first asking. */
function viewOf(project: Project, game: GameAudioState): GamePolicyView {
  let resolved: ReadonlyMap<string, EffectivePolicy> | undefined;
  const groupPolicies = new Map<GameAssetGroupId, GroupEffectivePolicy>();
  const children = new Map<GameAssetGroupId | undefined, GameAssetGroup[]>();
  for (const group of game.groups.values()) {
    const siblings = children.get(group.parent) ?? [];
    siblings.push(group);
    children.set(group.parent, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => BY_NAME.compare(a.name, b.name));
  const members = new Map<GameAssetGroupId, GroupMembership[]>();
  const byKey = new Map<string, GroupMembership>();
  for (const membership of game.memberships) {
    const held = members.get(membership.group) ?? [];
    held.push(membership);
    members.set(membership.group, held);
    byKey.set(memberKey(membership.member), membership);
  }
  return {
    game,
    childrenOf: (parent) => children.get(parent) ?? [],
    membersOf: (group) => members.get(group) ?? [],
    membershipOf: (member) => byKey.get(memberKey(member)),
    pathOf: (group) => groupPath(game.groups, group),
    member: (member) => {
      resolved ??= resolveAll(project, game);
      return resolved.get(memberKey(member)) ?? resolvePolicy(project, game, member);
    },
    group: (group) => {
      const known = groupPolicies.get(group);
      if (known !== undefined) return known;
      const policy = resolveGroupPolicy(game, group);
      groupPolicies.set(group, policy);
      return policy;
    },
  };
}

/** Each state's view, dropped with the state. */
const VIEWS = new WeakMap<ProjectState, GamePolicyView>();

/** The view of `state`'s asset groups, the same value for the same state. */
export function gamePolicyView(state: ProjectState): GamePolicyView {
  const known = VIEWS.get(state);
  if (known !== undefined) return known;
  const view = viewOf(state.project, state.gameAudio ?? NO_GROUPS);
  VIEWS.set(state, view);
  return view;
}
