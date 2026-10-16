/**
 * Adding, removing, renaming and moving asset groups, and setting or resetting
 * one field of a group's policy (ADR-0101, REQ-GAME-120).
 *
 * Each result is held to `validateGameAudioState` with every inheriting
 * member's rack re-pointed to what it inherits there (`game-state.ts`), so a
 * group moved, or a processing set, takes every member that inherits it along
 * in the same command, and one undo puts both back. A chain a group's
 * processing names enters with the group or the setting, given whole where
 * the project lacks it, and leaves with the last thing that names it
 * (`chain-naming.ts`). A group is removed only once it holds no group and no
 * member and no preview scenario plays it, so its inverse carries the group
 * alone.
 */

import {
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import type { EffectChainId } from '@audiogubbins/domain';
import {
  withPolicyField,
  type GameAssetGroup,
  type GameAudioState,
  type PolicyField,
  type PolicyValues,
} from '@audiogubbins/game-audio';
import {
  canonicalJson,
  readGameAssetGroup,
  writePolicyValue,
  type ProjectState,
} from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import { jsonArgument, readNested, refusedBy, textArgument } from '../invocation-arguments.js';
import { ProjectCommandId, applied, editCommand, type ProjectCommand } from '../project-command.js';
import { stateNaming, withoutUnnamed } from '../processing/chain-naming.js';
import {
  fieldArgument,
  optionalGroupId,
  policyValueArgument,
  targetGroup,
} from './game-arguments.js';
import {
  addGroupInvocation,
  moveGroupInvocation,
  removeGroupInvocation,
  renameGroupInvocation,
  setGroupPolicyInvocation,
} from './game-invocations.js';
import { gameOf, withGame } from './game-state.js';
import { FIELD_WORDS, groupWords } from './game-words.js';
import { unplayed } from './scenario-players.js';
import { groupOwner, newGroupOwner, ownedBy } from './value-owners.js';

/** The chain a processing setting names, where it names one. */
function chainOf(processing: EffectChainId | 'none' | undefined): EffectChainId | undefined {
  return processing === 'none' ? undefined : processing;
}

/** `game` with `group` added, or put in place of the group of its identifier. */
function withGroup(game: GameAudioState, group: GameAssetGroup): GameAudioState {
  return { ...game, groups: new Map(game.groups).set(group.id, group) };
}

/** Whether two values of `field` are the same, by the document's text of them. */
function sameValue<F extends PolicyField>(
  field: F,
  one: PolicyValues[F] | undefined,
  other: PolicyValues[F] | undefined,
): boolean {
  if (one === undefined || other === undefined) return one === other;
  return (
    canonicalJson(writePolicyValue(field, one)) === canonicalJson(writePolicyValue(field, other))
  );
}

function addGroup(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const game = gameOf(state);
  const value = jsonArgument(invocation, 'group');
  if (!value.ok) return refusedBy(value);
  const read = ownedBy(
    readNested(readGameAssetGroup, value.value, 'group'),
    newGroupOwner(game, value.value),
    'group.policy',
  );
  if (!read.ok) return refusedBy(read);
  const group = read.value;
  if (game.groups.has(group.id)) {
    return refusal(
      'game.group-duplicate-id',
      `The project already has ${groupWords(game, group.id)} with that identifier.`,
    );
  }
  const naming = stateNaming(state, invocation, chainOf(group.policy.processing));
  if (!naming.ok) return refusedBy(naming);
  const added = withGroup(game, group);
  const next = withGame(naming.value, added);
  if (!next.ok) return refusedBy(next);
  return applied(next.value, removeGroupInvocation(group.id), `Add ${groupWords(added, group.id)}`);
}

function removeGroup(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const game = gameOf(state);
  const found = targetGroup(game, invocation);
  if (!found.ok) return refusedBy(found);
  const group = found.value;
  const words = groupWords(game, group.id);
  const children = [...game.groups.values()].filter((one) => one.parent === group.id).length;
  if (children > 0) {
    return refusal(
      'game.group-has-children',
      `${words} still holds ${counted(children, 'group', 'groups')}; move or remove them first.`,
    );
  }
  const members = game.memberships.filter((one) => one.group === group.id).length;
  if (members > 0) {
    return refusal(
      'game.group-has-members',
      `${words} still has ${counted(members, 'member', 'members')}; take them out of it first.`,
    );
  }
  const played = unplayed(game, { kind: 'group', group: group.id }, words, 'removed');
  if (!played.ok) return refusedBy(played);
  const groups = new Map(game.groups);
  groups.delete(group.id);
  const next = withGame(state, { ...game, groups });
  if (!next.ok) return refusedBy(next);
  const unnamed = withoutUnnamed(next.value, chainOf(group.policy.processing));
  return applied(unnamed.state, addGroupInvocation(group, unnamed.removed), `Remove ${words}`);
}

function renameGroup(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const game = gameOf(state);
  const found = targetGroup(game, invocation);
  if (!found.ok) return refusedBy(found);
  const name = textArgument(invocation, 'name');
  if (!name.ok) return refusedBy(name);
  const group = found.value;
  const words = groupWords(game, group.id);
  if (name.value === group.name) {
    return unchanged('game.group-name-unchanged', `${words} is already called that.`);
  }
  const next = withGame(state, withGroup(game, { ...group, name: name.value }));
  if (!next.ok) return refusedBy(next);
  return applied(
    next.value,
    renameGroupInvocation(group.id, group.name),
    `Rename ${words} to ${quoted(name.value)}`,
  );
}

function moveGroup(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const game = gameOf(state);
  const found = targetGroup(game, invocation);
  if (!found.ok) return refusedBy(found);
  const parent = optionalGroupId(invocation, 'parent');
  if (!parent.ok) return refusedBy(parent);
  const group = found.value;
  const words = groupWords(game, group.id);
  if (parent.value === group.parent) {
    return unchanged('game.group-not-moved', `${words} is already there.`);
  }
  const { parent: _previous, ...rest } = group;
  const moved = withGroup(
    game,
    parent.value === undefined ? rest : { ...rest, parent: parent.value },
  );
  const next = withGame(state, moved);
  if (!next.ok) return refusedBy(next);
  return applied(
    next.value,
    moveGroupInvocation(group.id, group.parent),
    parent.value === undefined
      ? `Move ${words} to the top level`
      : `Move ${words} into ${groupWords(game, parent.value)}`,
  );
}

function setGroupPolicy(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const game = gameOf(state);
  const found = targetGroup(game, invocation);
  if (!found.ok) return refusedBy(found);
  const field = fieldArgument(invocation);
  if (!field.ok) return refusedBy(field);
  const group = found.value;
  const value = policyValueArgument(invocation, field.value, groupOwner(game, group.id));
  if (!value.ok) return refusedBy(value);
  const words = groupWords(game, group.id);
  const fieldWords = FIELD_WORDS[field.value];
  const old = group.policy[field.value];
  if (sameValue(field.value, old, value.value)) {
    return unchanged(
      'game.policy-unchanged',
      value.value === undefined
        ? `${words} sets no ${fieldWords}; it inherits it.`
        : `${words} already sets that ${fieldWords}.`,
    );
  }
  const policy = withPolicyField(group.policy, field.value, value.value);
  // Only processing names a chain: one it gives whole enters, and one it leaves may go.
  const processing = field.value === 'processing';
  const naming = stateNaming(
    state,
    invocation,
    processing ? chainOf(policy.processing) : undefined,
  );
  if (!naming.ok) return refusedBy(naming);
  const next = withGame(naming.value, withGroup(game, { ...group, policy }));
  if (!next.ok) return refusedBy(next);
  const unnamed = withoutUnnamed(
    next.value,
    processing ? chainOf(group.policy.processing) : undefined,
  );
  return applied(
    unnamed.state,
    setGroupPolicyInvocation(group.id, field.value, old, unnamed.removed),
    value.value === undefined
      ? `Reset the ${fieldWords} of ${words} to inherited`
      : `Set the ${fieldWords} of ${words}`,
  );
}

/** The commands that change asset groups and their policy. */
export function groupCommands(): readonly ProjectCommand[] {
  return [
    editCommand(
      ProjectCommandId.AddGroup,
      'Add an asset group',
      'Adds an asset group with the policy it sets, at the top level or inside another group.',
      addGroup,
    ),
    editCommand(
      ProjectCommandId.RemoveGroup,
      'Remove an asset group',
      'Removes an asset group that holds no group and no member.',
      removeGroup,
    ),
    editCommand(
      ProjectCommandId.RenameGroup,
      'Rename an asset group',
      'Gives an asset group a new name, unlike its siblings’.',
      renameGroup,
    ),
    editCommand(
      ProjectCommandId.MoveGroup,
      'Move an asset group',
      'Moves an asset group inside another or to the top level, and what it holds with it.',
      moveGroup,
    ),
    editCommand(
      ProjectCommandId.SetGroupPolicy,
      'Set a group’s policy',
      'Sets one field of an asset group’s policy, or resets it so the group inherits it.',
      setGroupPolicy,
    ),
  ];
}
