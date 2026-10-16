/**
 * The invocations of the game commands (ADR-0101), each built with its values
 * written as the command reads them: canonical JSON in the project document's
 * own shape, so what the interface, a guided workflow or an inverse sends is
 * what the document holds.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { EffectChain, EffectChainId } from '@audiogubbins/domain';
import type {
  GameAssetGroup,
  GameAssetGroupId,
  GroupMember,
  GroupMembership,
  MemberProcessing,
  OverridableField,
  PolicyField,
  PolicyOverrides,
  PolicyValues,
} from '@audiogubbins/game-audio';
import {
  canonicalJson,
  writeGameAssetGroup,
  writeGroupMember,
  writePolicyOverrides,
  writePolicyValue,
} from '@audiogubbins/project-format';

import { ProjectCommandId } from '../project-command.js';
import { namingArguments } from '../processing/chain-naming.js';

/**
 * The rack a member is given as it owns its processing or leaves its group: a
 * chain named by its identifier, or given whole where the project lacks it, or
 * `none` to take its rack away.
 */
export type GivenRack = EffectChainId | EffectChain | 'none';

/** The arguments that give `rack`, or none where the member keeps the rack it has. */
function rackArguments(rack: GivenRack | undefined): Readonly<Record<string, string>> {
  if (rack === undefined) return {};
  return rack === 'none' ? { rack: 'none' } : namingArguments(rack);
}

function memberArgument(member: GroupMember): string {
  return canonicalJson(writeGroupMember(member));
}

/** Adds `group`, with no members; its processing's chain goes with it where `chain` gives it whole. */
export function addGroupInvocation(group: GameAssetGroup, chain?: EffectChain): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddGroup,
    arguments: { group: canonicalJson(writeGameAssetGroup(group)), ...namingArguments(chain) },
  };
}

/** Removes `group`, which holds no group and no member. */
export function removeGroupInvocation(group: GameAssetGroupId): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveGroup, arguments: { group } };
}

/** Renames `group` to `name`, exactly as given. */
export function renameGroupInvocation(group: GameAssetGroupId, name: string): CommandInvocation {
  return { commandId: ProjectCommandId.RenameGroup, arguments: { group, name } };
}

/** Moves `group` inside `parent`, or to the top of the forest where it is absent. */
export function moveGroupInvocation(
  group: GameAssetGroupId,
  parent: GameAssetGroupId | undefined,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.MoveGroup,
    arguments: { group, ...(parent === undefined ? {} : { parent }) },
  };
}

/**
 * Sets `field` of `group`'s policy to `value`, or resets it to inherited where
 * it is absent; a processing chain goes with it where `chain` gives it whole.
 */
export function setGroupPolicyInvocation<F extends PolicyField>(
  group: GameAssetGroupId,
  field: F,
  value: PolicyValues[F] | undefined,
  chain?: EffectChain,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetGroupPolicy,
    arguments: {
      group,
      field,
      ...(value === undefined ? {} : { value: canonicalJson(writePolicyValue(field, value)) }),
      ...namingArguments(chain),
    },
  };
}

/** How a member joins a group beside its group and processing. */
export interface Joined {
  /** What it sets over the group; none where absent. */
  readonly overrides?: PolicyOverrides;

  /** Its place in the assignment order; where absent, the place it has, or after every other. */
  readonly position?: number;

  /** The rack it is given where it owns its processing; where absent, it keeps the one it has. */
  readonly rack?: GivenRack;
}

/** The arguments of a membership joining at `position`, as an added region or asset rejoins. */
export function joiningArguments(
  membership: GroupMembership,
  position: number,
): Readonly<Record<string, string | number>> {
  return {
    group: membership.group,
    processing: membership.processing,
    overrides: canonicalJson(writePolicyOverrides(membership.overrides)),
    position,
  };
}

/**
 * Puts `member` in `group`, or moves it there from the group it is in, with
 * `processing`: `inherit` gives it the rack it inherits, `own` keeps its rack
 * or gives it `joined.rack`.
 */
export function assignMemberInvocation(
  member: GroupMember,
  group: GameAssetGroupId,
  processing: MemberProcessing,
  joined: Joined = {},
): CommandInvocation {
  return {
    commandId: ProjectCommandId.AssignMember,
    arguments: {
      member: memberArgument(member),
      group,
      processing,
      ...(joined.overrides === undefined
        ? {}
        : { overrides: canonicalJson(writePolicyOverrides(joined.overrides)) }),
      ...(joined.position === undefined ? {} : { position: joined.position }),
      ...rackArguments(joined.rack),
    },
  };
}

/** Takes `member` out of its group, keeping its rack or giving it `rack`. */
export function unassignMemberInvocation(member: GroupMember, rack?: GivenRack): CommandInvocation {
  return {
    commandId: ProjectCommandId.UnassignMember,
    arguments: { member: memberArgument(member), ...rackArguments(rack) },
  };
}

/** Sets `field` of `member`'s overrides to `value`. */
export function setMemberOverrideInvocation<F extends OverridableField>(
  member: GroupMember,
  field: F,
  value: PolicyValues[F],
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetMemberOverride,
    arguments: {
      member: memberArgument(member),
      field,
      value: canonicalJson(writePolicyValue(field, value)),
    },
  };
}

/** Removes `member`'s override of `field`, so it inherits the field from its group. */
export function resetMemberOverrideInvocation(
  member: GroupMember,
  field: OverridableField,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.ResetMemberOverride,
    arguments: { member: memberArgument(member), field },
  };
}

/**
 * Makes `member` inherit its group's processing, which gives it the rack it
 * inherits, or own its own, keeping its rack or giving it `rack`.
 */
export function setMemberProcessingInvocation(
  member: GroupMember,
  processing: MemberProcessing,
  rack?: GivenRack,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetMemberProcessing,
    arguments: { member: memberArgument(member), processing, ...rackArguments(rack) },
  };
}
