/**
 * What the commands that change a member of an asset group share (ADR-0101):
 * finding its membership, giving it the rack a command names, and settling
 * the rack it had, whose chain leaves where nothing names it any more and is
 * given back whole by the inverse (`chain-naming.ts`).
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import type { GameAudioState, GroupMember, GroupMembership } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { withoutUnnamed } from '../processing/chain-naming.js';
import { targetMember, type RackChange, type TargetMember } from './game-arguments.js';
import { assignMemberInvocation, type GivenRack } from './game-invocations.js';
import { gameOf, membershipIndex, projectWithRack, rackOf } from './game-state.js';

/** A member's membership and its place in the assignment order. */
export interface Placed {
  readonly membership: GroupMembership;
  readonly index: number;
}

/** `member`'s membership in `game` and its place, where it has one. */
export function placed(game: GameAudioState, member: GroupMember): Placed | undefined {
  const index = membershipIndex(game, member);
  const membership = index === undefined ? undefined : game.memberships[index];
  return index === undefined || membership === undefined ? undefined : { membership, index };
}

/** A member of a group, as the arguments name it, with its membership. */
export interface JoinedMember extends Placed {
  readonly target: TargetMember;
}

/** The member the arguments name, with its membership, or why it has none. */
export function joinedMember(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<JoinedMember> {
  const target = targetMember(state, invocation);
  if (!target.ok) return target;
  const found = placed(gameOf(state), target.value.member);
  return found === undefined
    ? fail(
        failure(
          'game.member-not-in-group',
          FailureKind.Rejected,
          `${quoted(target.value.name)} is in no group.`,
        ),
      )
    : succeed({ target: target.value, ...found });
}

/** Why a member that inherits is given no rack: it has the one it inherits. */
export function inheritedRack(target: TargetMember): DomainFailureResult {
  return fail(
    failure(
      'game.rack-inherited',
      FailureKind.Rejected,
      `${quoted(target.name)} inherits its rack from its group, so the command gives it none.`,
    ),
  );
}

/** `state` with the rack `change` gives `member`, where it gives one. */
export function withRackChange(
  state: ProjectState,
  member: GroupMember,
  change: RackChange,
): ProjectState {
  if (change.kind === 'keep') return state;
  return { ...change.state, project: projectWithRack(change.state.project, member, change.rack) };
}

/** A state once a member's rack may have changed, and the rack an inverse gives back. */
export interface Settled {
  readonly state: ProjectState;

  /** The rack it had, whole where its chain left; `undefined` where the rack did not change. */
  readonly restored: GivenRack | undefined;
}

/**
 * `to`, once `member`'s rack in `from` became the one it has in `to`, the old
 * rack's chain removed where nothing names it any more.
 */
export function settled(from: ProjectState, to: ProjectState, member: GroupMember): Settled {
  const before = rackOf(from.project, member);
  if (rackOf(to.project, member) === before) return { state: to, restored: undefined };
  const unnamed = withoutUnnamed(to, before);
  return { state: unnamed.state, restored: unnamed.removed ?? before ?? 'none' };
}

/**
 * The invocation that puts `member` back as `was` placed it, with the rack
 * `restored` gives where it owned its processing; one that inherited is given
 * the rack it inherits again.
 */
export function rejoiningInvocation(
  member: GroupMember,
  { membership, index }: Placed,
  restored: GivenRack | undefined,
): CommandInvocation {
  return assignMemberInvocation(member, membership.group, membership.processing, {
    overrides: membership.overrides,
    position: index,
    ...(membership.processing === 'own' && restored !== undefined ? { rack: restored } : {}),
  });
}
