/**
 * Setting and resetting what a member of an asset group overrides of its
 * group's policy, and choosing whether it inherits its group's processing
 * (ADR-0101, REQ-GAME-120).
 *
 * An override is a value set on the member; resetting it removes it, so what
 * the group sets shows through. Turning a member to inherit gives it the rack
 * it inherits in the same command; turning it to own its processing keeps the
 * rack it has, or gives it the one named, and the inverse of a turn to inherit
 * gives back the rack it owned, whole where its chain left with the change.
 */

import {
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import { withOverride, type OverridableField } from '@audiogubbins/game-audio';
import { canonicalJson, writePolicyValue, type ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { refusedBy } from '../invocation-arguments.js';
import { ProjectCommandId, applied, editCommand, type ProjectCommand } from '../project-command.js';
import {
  overridableFieldArgument,
  policyValueArgument,
  processingArgument,
  rackArgument,
} from './game-arguments.js';
import {
  resetMemberOverrideInvocation,
  setMemberOverrideInvocation,
  setMemberProcessingInvocation,
} from './game-invocations.js';
import { gameOf, rackOf, withGame, withMembership } from './game-state.js';
import { FIELD_WORDS, groupWords } from './game-words.js';
import { inheritedRack, joinedMember, settled, withRackChange } from './member-changes.js';
import { memberOwner } from './value-owners.js';

function setMemberOverride(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const found = joinedMember(state, invocation);
  if (!found.ok) return refusedBy(found);
  const { target, membership } = found.value;
  const game = gameOf(state);
  const field = overridableFieldArgument(invocation, game, target, membership.group);
  if (!field.ok) return refusedBy(field);
  const value = policyValueArgument(
    invocation,
    field.value,
    memberOwner(target.member, target.name),
  );
  if (!value.ok) return refusedBy(value);
  const fieldWords = FIELD_WORDS[field.value];
  if (value.value === undefined) {
    return refusal(
      'argument.missing',
      `The command needs the ${fieldWords} to set; resetting it is a command of its own.`,
    );
  }
  const old = membership.overrides[field.value];
  const written = (one: typeof old) =>
    one === undefined ? undefined : canonicalJson(writePolicyValue(field.value, one));
  if (written(old) === written(value.value)) {
    return unchanged(
      'game.override-unchanged',
      `${quoted(target.name)} already sets that ${fieldWords} over its group.`,
    );
  }
  const overrides = withOverride(membership.overrides, field.value, value.value);
  const next = withGame(state, withMembership(game, { ...membership, overrides }, undefined));
  if (!next.ok) return refusedBy(next);
  return applied(
    next.value,
    old === undefined
      ? resetMemberOverrideInvocation(target.member, field.value)
      : setMemberOverrideInvocation(target.member, field.value, old),
    `Set the ${fieldWords} of ${quoted(target.name)} over ${groupWords(game, membership.group)}`,
  );
}

function resetMemberOverride(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const found = joinedMember(state, invocation);
  if (!found.ok) return refusedBy(found);
  const { target, membership } = found.value;
  const game = gameOf(state);
  const field = overridableFieldArgument(invocation, game, target, membership.group);
  if (!field.ok) return refusedBy(field);
  const fieldWords = FIELD_WORDS[field.value];
  const words = groupWords(game, membership.group);
  const old = membership.overrides[field.value];
  if (old === undefined) {
    return unchanged(
      'game.override-unset',
      `${quoted(target.name)} sets no ${fieldWords} over ${words}; it inherits it.`,
    );
  }
  const overrides = withOverride(membership.overrides, field.value, undefined);
  const next = withGame(state, withMembership(game, { ...membership, overrides }, undefined));
  if (!next.ok) return refusedBy(next);
  return applied(
    next.value,
    setMemberOverrideInvocation<OverridableField>(target.member, field.value, old),
    `Reset the ${fieldWords} of ${quoted(target.name)} to that of ${words}`,
  );
}

function setMemberProcessing(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const found = joinedMember(state, invocation);
  if (!found.ok) return refusedBy(found);
  const { target, membership } = found.value;
  const processing = processingArgument(invocation);
  if (!processing.ok) return refusedBy(processing);
  const rack = rackArgument(state, invocation);
  if (!rack.ok) return refusedBy(rack);
  if (processing.value === 'inherit' && rack.value.kind === 'set') {
    return refusedBy(inheritedRack(target));
  }
  if (
    processing.value === membership.processing &&
    (rack.value.kind === 'keep' || rack.value.rack === rackOf(state.project, target.member))
  ) {
    return unchanged(
      'game.processing-unchanged',
      processing.value === 'inherit'
        ? `${quoted(target.name)} already inherits its group’s processing.`
        : `${quoted(target.name)} already has that processing of its own.`,
    );
  }
  const game = gameOf(state);
  const turned = withGame(
    withRackChange(state, target.member, rack.value),
    withMembership(game, { ...membership, processing: processing.value }, undefined),
  );
  if (!turned.ok) return refusedBy(turned);
  const next = settled(state, turned.value, target.member);
  return applied(
    next.state,
    setMemberProcessingInvocation(
      target.member,
      membership.processing,
      membership.processing === 'own' ? next.restored : undefined,
    ),
    processing.value === 'inherit'
      ? `Let ${quoted(target.name)} inherit the processing of ${groupWords(game, membership.group)}`
      : `Give ${quoted(target.name)} processing of its own`,
  );
}

/** The commands that change what a member sets over its group, and whether it inherits its processing. */
export function memberSettingCommands(): readonly ProjectCommand[] {
  return [
    editCommand(
      ProjectCommandId.SetMemberOverride,
      'Override a group’s setting',
      'Sets one field of a group’s policy for one of its members alone.',
      setMemberOverride,
    ),
    editCommand(
      ProjectCommandId.ResetMemberOverride,
      'Reset an override to the group’s',
      'Removes a member’s override of one field, so it inherits the field from its group.',
      resetMemberOverride,
    ),
    editCommand(
      ProjectCommandId.SetMemberProcessing,
      'Inherit or own processing',
      'Makes a member inherit its group’s processing as its rack, or own a rack of its own.',
      setMemberProcessing,
    ),
  ];
}
