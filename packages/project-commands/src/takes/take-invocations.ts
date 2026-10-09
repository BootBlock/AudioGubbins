/**
 * The invocations of the take commands (ADR-0072), built from the values they
 * act on, for the interface, the storage worker and each command's inverse.
 *
 * A recording that finishes is one change of two steps: the recorded asset
 * added (`addAssetInvocation`), then the take that names it, as the first
 * take of a new stack ({@link createTakeStackInvocation}), the first of a
 * punch's ({@link addPunchInvocation}), or one more in a stack
 * ({@link addTakeInvocation}). Run as one group, one undo takes both away.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type {
  Asset,
  EditOperation,
  Take,
  TakeId,
  TakeStack,
  TakeStackId,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  writeEditOperation,
  writeTake,
  writeTakeStack,
} from '@audiogubbins/project-format';

import { ProjectCommandId } from '../project-command.js';

/** A stack, as the commands that act on one name it. */
type Named = Pick<TakeStack, 'id'>;

/** A take, as the commands that act on one name it. */
type NamedTake = Pick<Take, 'id'>;

/** Creates `stack`, given whole: a new stack, its takes and choice as they are. */
export function createTakeStackInvocation(stack: TakeStack): CommandInvocation {
  return {
    commandId: ProjectCommandId.CreateTakeStack,
    arguments: { stack: canonicalJson(writeTakeStack(stack)) },
  };
}

/** Removes a stack no punch names. */
export function removeTakeStackInvocation(stack: Named): CommandInvocation {
  return { commandId: ProjectCommandId.RemoveTakeStack, arguments: { stackId: stack.id } };
}

/** Gives a stack a new name, trimmed. */
export function renameTakeStackInvocation(stack: Named, name: string): CommandInvocation {
  return { commandId: ProjectCommandId.RenameTakeStack, arguments: { stackId: stack.id, name } };
}

/**
 * Sets a stack as given, its takes the same ones in the same order and its
 * punch the same: how an undo gives back a stack's names, notes, states,
 * compensations and choice.
 */
export function setTakeStackInvocation(stack: TakeStack): CommandInvocation {
  return {
    commandId: ProjectCommandId.SetTakeStack,
    arguments: { stack: canonicalJson(writeTakeStack(stack)) },
  };
}

/** Starts stack `branch`, named `name`, from `take` of `stack`, as its take `copy`. */
export function branchTakeStackInvocation(
  stack: Named,
  take: NamedTake,
  branch: TakeStackId,
  copy: TakeId,
  name: string,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.BranchTakeStack,
    arguments: { stackId: stack.id, takeId: take.id, branchId: branch, copyId: copy, name },
  };
}

/** Keeps only a stack's chosen take, marking every other removed. */
export function consolidateTakeStackInvocation(stack: Named): CommandInvocation {
  return { commandId: ProjectCommandId.ConsolidateTakeStack, arguments: { stackId: stack.id } };
}

/** Adds `take` to the end of `stack`, chosen where `choose` says. */
export function addTakeInvocation(stack: Named, take: Take, choose: boolean): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddTake,
    arguments: { stackId: stack.id, take: canonicalJson(writeTake(take)), choose },
  };
}

/**
 * Withdraws `take`, the last of `stack`, and gives the stack back the choice
 * `chosen`, where it had one: the inverse of adding or duplicating a take.
 */
export function withdrawTakeInvocation(
  stack: Named,
  take: NamedTake,
  chosen: TakeId | undefined,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.WithdrawTake,
    arguments: {
      stackId: stack.id,
      takeId: take.id,
      ...(chosen === undefined ? {} : { chosen }),
    },
  };
}

/** Adds take `copy`, named `name`, naming the same recording as `take`. */
export function duplicateTakeInvocation(
  stack: Named,
  take: NamedTake,
  copy: TakeId,
  name: string,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.DuplicateTake,
    arguments: { stackId: stack.id, takeId: take.id, copyId: copy, name },
  };
}

/** An invocation of `command` naming a take of a stack, with `more` arguments. */
function onTake(
  command: CommandInvocation['commandId'],
  stack: Named,
  take: NamedTake,
  more: Readonly<Record<string, string | number>> = {},
): CommandInvocation {
  return { commandId: command, arguments: { stackId: stack.id, takeId: take.id, ...more } };
}

/** Gives a take a new name, trimmed. */
export function renameTakeInvocation(
  stack: Named,
  take: NamedTake,
  name: string,
): CommandInvocation {
  return onTake(ProjectCommandId.RenameTake, stack, take, { name });
}

/** Sets a take's note. */
export function setTakeNoteInvocation(
  stack: Named,
  take: NamedTake,
  note: string,
): CommandInvocation {
  return onTake(ProjectCommandId.SetTakeNote, stack, take, { note });
}

/** Makes a kept take the stack's chosen one. */
export function chooseTakeInvocation(stack: Named, take: NamedTake): CommandInvocation {
  return onTake(ProjectCommandId.ChooseTake, stack, take);
}

/** Marks a kept take rejected, keeping it in the stack. */
export function rejectTakeInvocation(stack: Named, take: NamedTake): CommandInvocation {
  return onTake(ProjectCommandId.RejectTake, stack, take);
}

/** Keeps a rejected take again. */
export function keepTakeInvocation(stack: Named, take: NamedTake): CommandInvocation {
  return onTake(ProjectCommandId.KeepTake, stack, take);
}

/** Takes a take out of the active stack, recoverably. */
export function removeTakeInvocation(stack: Named, take: NamedTake): CommandInvocation {
  return onTake(ProjectCommandId.RemoveTake, stack, take);
}

/** Brings a removed take back into the active stack, kept. */
export function restoreTakeInvocation(stack: Named, take: NamedTake): CommandInvocation {
  return onTake(ProjectCommandId.RestoreTake, stack, take);
}

/** Sets a take's latency compensation, in frames at its own rate. */
export function setTakeCompensationInvocation(
  stack: Named,
  take: NamedTake,
  compensation: number,
): CommandInvocation {
  return onTake(ProjectCommandId.SetTakeCompensation, stack, take, { compensation });
}

/**
 * Punches in on `asset`: `operation`, a punch edit naming `stack`, joins the
 * end of the asset's chain, and `stack`, a new punch stack given whole, joins
 * the project.
 */
export function addPunchInvocation(
  asset: Pick<Asset, 'id'>,
  operation: EditOperation,
  stack: TakeStack,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.AddPunch,
    arguments: {
      assetId: asset.id,
      operation: canonicalJson(writeEditOperation(operation)),
      stack: canonicalJson(writeTakeStack(stack)),
    },
  };
}

/** Withdraws `operation`, a punch at the end of `asset`'s chain, and its stack with it. */
export function removePunchInvocation(
  asset: Pick<Asset, 'id'>,
  operation: Pick<EditOperation, 'id'>,
): CommandInvocation {
  return {
    commandId: ProjectCommandId.RemovePunch,
    arguments: { assetId: asset.id, operationId: operation.id },
  };
}
