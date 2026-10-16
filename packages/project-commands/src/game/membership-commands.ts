/**
 * Putting a region or an asset in an asset group, moving it between groups,
 * and taking it out (ADR-0101, REQ-GAME-120).
 *
 * A member that joins inheriting is given the rack it inherits in the same
 * command (`game-state.ts`); one that owns its processing keeps the rack it
 * has, or the one the command gives it, which is how an inverse gives back a
 * rack the change replaced. A membership keeps its place in the assignment
 * order as it moves between groups, and an inverse puts it back at the place
 * it had: the order a group's members are chosen and numbered in. A member a
 * preview scenario plays stays in a group until the scenario stops playing it.
 */

import { unchanged, type CommandInvocation, type CommandOutcome } from '@audiogubbins/commands';
import { succeed, type DomainResult } from '@audiogubbins/domain';
import type { GroupMembership } from '@audiogubbins/game-audio';
import {
  canonicalJson,
  writePolicyOverrides,
  type ProjectState,
} from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { refusedBy } from '../invocation-arguments.js';
import { ProjectCommandId, applied, editCommand, type ProjectCommand } from '../project-command.js';
import {
  overridesArgument,
  positionArgument,
  processingArgument,
  rackArgument,
  targetGroup,
  targetMember,
  type RackChange,
  type TargetMember,
} from './game-arguments.js';
import { unassignMemberInvocation } from './game-invocations.js';
import { gameOf, rackOf, withGame, withMembership, withoutMembership } from './game-state.js';
import { groupWords } from './game-words.js';
import { unplayed } from './scenario-players.js';
import { memberOwner } from './value-owners.js';
import {
  inheritedRack,
  joinedMember,
  placed,
  rejoiningInvocation,
  settled,
  withRackChange,
  type Placed,
} from './member-changes.js';

/** What an assignment asks: the member, its membership, its place and its rack. */
interface Assignment {
  readonly target: TargetMember;
  readonly membership: GroupMembership;
  readonly position: number | undefined;
  readonly rack: RackChange;

  /** Where it was, where it was in a group. */
  readonly old: Placed | undefined;
}

/** The assignment the arguments ask, or why it cannot be made. */
function assignmentOf(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<Assignment> {
  const game = gameOf(state);
  const target = targetMember(state, invocation);
  if (!target.ok) return target;
  const group = targetGroup(game, invocation);
  if (!group.ok) return group;
  const processing = processingArgument(invocation);
  if (!processing.ok) return processing;
  const overrides = overridesArgument(
    invocation,
    memberOwner(target.value.member, target.value.name),
  );
  if (!overrides.ok) return overrides;
  const old = placed(game, target.value.member);
  const position = positionArgument(invocation, game.memberships.length - (old ? 1 : 0));
  if (!position.ok) return position;
  const rack = rackArgument(state, invocation);
  if (!rack.ok) return rack;
  if (processing.value === 'inherit' && rack.value.kind === 'set') {
    return inheritedRack(target.value);
  }
  const membership: GroupMembership = {
    member: target.value.member,
    group: group.value.id,
    processing: processing.value,
    overrides: overrides.value,
  };
  return succeed({
    target: target.value,
    membership,
    position: position.value,
    rack: rack.value,
    old,
  });
}

/** Whether the member already stands as `assignment` asks. */
function standsSo(state: ProjectState, { membership, position, rack, old }: Assignment): boolean {
  const written = (one: GroupMembership) => canonicalJson(writePolicyOverrides(one.overrides));
  return (
    old?.membership.group === membership.group &&
    old.membership.processing === membership.processing &&
    written(old.membership) === written(membership) &&
    (position === undefined || position === old.index) &&
    (rack.kind === 'keep' || rack.rack === rackOf(state.project, membership.member))
  );
}

function assignMember(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const assignment = assignmentOf(state, invocation);
  if (!assignment.ok) return refusedBy(assignment);
  const { target, membership, position, rack, old } = assignment.value;
  const game = gameOf(state);
  if (standsSo(state, assignment.value)) {
    return unchanged(
      'game.member-unchanged',
      `${quoted(target.name)} is already in ${groupWords(game, membership.group)} as asked.`,
    );
  }
  const moved = withGame(
    withRackChange(state, target.member, rack),
    withMembership(game, membership, position),
  );
  if (!moved.ok) return refusedBy(moved);
  const next = settled(state, moved.value, target.member);
  const words = groupWords(gameOf(next.state), membership.group);
  if (old === undefined) {
    return applied(
      next.state,
      unassignMemberInvocation(target.member, next.restored),
      `Put ${quoted(target.name)} in ${words}`,
    );
  }
  return applied(
    next.state,
    rejoiningInvocation(target.member, old, next.restored),
    old.membership.group === membership.group
      ? `Change how ${quoted(target.name)} is in ${words}`
      : `Move ${quoted(target.name)} to ${words}`,
  );
}

function unassignMember(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const found = joinedMember(state, invocation);
  if (!found.ok) return refusedBy(found);
  const { target, ...was } = found.value;
  const rack = rackArgument(state, invocation);
  if (!rack.ok) return refusedBy(rack);
  const game = gameOf(state);
  const played = unplayed(
    game,
    { kind: 'member', member: target.member },
    quoted(target.name),
    'taken out of its group',
  );
  if (!played.ok) return refusedBy(played);
  const left = withGame(
    withRackChange(state, target.member, rack.value),
    withoutMembership(game, target.member),
  );
  if (!left.ok) return refusedBy(left);
  const next = settled(state, left.value, target.member);
  return applied(
    next.state,
    rejoiningInvocation(target.member, was, next.restored),
    `Take ${quoted(target.name)} out of ${groupWords(game, was.membership.group)}`,
  );
}

/** The commands that put a member in a group, move it between groups and take it out. */
export function membershipCommands(): readonly ProjectCommand[] {
  return [
    editCommand(
      ProjectCommandId.AssignMember,
      'Put a sound in an asset group',
      'Puts a region or an asset in an asset group, or moves it there from another, inheriting the group’s processing or owning its own.',
      assignMember,
    ),
    editCommand(
      ProjectCommandId.UnassignMember,
      'Take a sound out of its asset group',
      'Takes a region or an asset out of its asset group, keeping its rack.',
      unassignMember,
    ),
  ];
}
