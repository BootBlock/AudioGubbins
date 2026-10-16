/**
 * What removing a region or an asset does to the group it is in (ADR-0101):
 * its membership leaves with it, and the inverse that adds it back puts the
 * membership back at the place it had in the assignment order, with its
 * processing and overrides, so one undo restores the member and how it
 * belonged. A member a preview scenario plays is not removed: the scenario
 * would play nothing.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { memberKey, type GroupMember } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import { readJoining } from './game-arguments.js';
import { joiningArguments } from './game-invocations.js';
import {
  gameOf,
  heldValid,
  membershipIndex,
  withMembership,
  withoutMembership,
} from './game-state.js';
import { memberName } from './game-words.js';
import { unplayed } from './scenario-players.js';
import { memberOwner } from './value-owners.js';

/** A state a member has left, and the arguments that put its membership back. */
export interface Left {
  readonly state: ProjectState;
  readonly rejoining: Readonly<Record<string, string | number>>;
}

/**
 * `state`, from which `member` has just been removed, without its membership,
 * where it had one, and the arguments of the inverse that adds it back.
 */
export function withoutMember(state: ProjectState, member: GroupMember): DomainResult<Left> {
  const game = gameOf(state);
  const index = membershipIndex(game, member);
  const membership = index === undefined ? undefined : game.memberships[index];
  if (index === undefined || membership === undefined) return succeed({ state, rejoining: {} });
  const played = unplayed(game, { kind: 'member', member }, `the ${member.kind}`, 'removed');
  if (!played.ok) return played;
  const held = heldValid(state, withoutMembership(game, member));
  return held.ok
    ? succeed({ state: held.value, rejoining: joiningArguments(membership, index) })
    : held;
}

/**
 * `state`, to which `member` has just been added, with the membership the
 * invocation gives it, where it gives one, held to the game-audio state as it
 * is: a member added inheriting has the rack it inherits already.
 */
export function rejoined(
  state: ProjectState,
  invocation: CommandInvocation,
  member: GroupMember,
): DomainResult<ProjectState> {
  const game = gameOf(state);
  // The member was just added, so the project names it.
  const name = memberName(state.project, member) ?? memberKey(member);
  const joining = readJoining(invocation, game.memberships.length, memberOwner(member, name));
  if (!joining.ok || joining.value === undefined) return joining.ok ? succeed(state) : joining;
  if (membershipIndex(game, member) !== undefined) {
    return fail(
      failure('game.member-twice', FailureKind.Rejected, 'The member is in a group already.'),
    );
  }
  const { position, ...membership } = joining.value;
  return heldValid(state, withMembership(game, { member, ...membership }, position));
}
