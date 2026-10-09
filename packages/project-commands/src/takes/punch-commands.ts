/**
 * Punching in on an asset and withdrawing the punch (ADR-0072, REQ-REC-093).
 *
 * A punch is one change: a new punch stack, given whole with the take the
 * recording made, joins the project, and a punch edit naming it joins the end
 * of the asset's chain, replacing its range with the stack's chosen take
 * without changing time. The asset's source is never touched, so withdrawing
 * the punch leaves the earlier audio as it was. Withdrawing takes the stack
 * with the edit where no other punch names it, and its inverse gives both
 * back; otherwise the stack stays, and the inverse applies the edit again.
 */

import {
  CommandCategory,
  refusal,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  punchStackOf,
  succeed,
  shapesOf,
  stackUsers,
  validateOperation,
  type Asset,
  type DomainResult,
  type EditOperation,
  type TakeStack,
} from '@audiogubbins/domain';
import { readEditOperation, type ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { idArgument } from '../editing/editing-arguments.js';
import { applyInvocation, placedOnLast } from '../editing/edit-commands.js';
import { withAssetEdits } from '../editing/editing-state.js';
import { jsonArgument, readNested, refusedBy, targetAsset } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  assetAvailability,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { stackArgument } from './take-arguments.js';
import { StackWords } from './take-descriptions.js';
import { addPunchInvocation, removePunchInvocation } from './take-invocations.js';
import { withNewStack, withoutTakeStack } from './take-state.js';

/** The commands that punch in on an asset and withdraw a punch. */
export function punchCommands(): readonly ProjectCommand[] {
  return [
    projectCommand({
      id: ProjectCommandId.AddPunch,
      label: 'Punch in',
      category: CommandCategory.Edit,
      description:
        'Replaces a range of an asset with the chosen take of a new punch stack, leaving its source unchanged.',
      availability: assetAvailability,
      run: addPunch,
      provenance: NO_PROVENANCE,
    }),
    projectCommand({
      id: ProjectCommandId.RemovePunch,
      label: 'Withdraw a punch',
      category: CommandCategory.Edit,
      description: 'Withdraws a punch at the end of an asset’s edits, and its stack with it.',
      availability: assetAvailability,
      run: removePunch,
      provenance: NO_PROVENANCE,
    }),
  ];
}

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The punch edit the argument `operation` gives, naming `stack`. */
function punchArgument(
  invocation: CommandInvocation,
  stack: TakeStack,
): DomainResult<EditOperation> {
  const value = jsonArgument(invocation, 'operation');
  const operation = value.ok ? readNested(readEditOperation, value.value, '') : value;
  if (!operation.ok) return operation;
  return punchStackOf(operation.value) === stack.id
    ? operation
    : rejected('punch.not-its-stack', 'A punch is made with the punch stack given with it.');
}

function addPunch(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const { asset } = target.value;
  const stack = stackArgument(invocation);
  if (!stack.ok) return refusedBy(stack);
  if (stack.value.punch === undefined) {
    return refusal('punch.not-a-punch-stack', 'A punch is made with a stack recorded for one.');
  }
  const read = punchArgument(invocation, stack.value);
  if (!read.ok) return refusedBy(read);
  const operation = read.value;
  if (asset.edits.some((existing) => existing.id === operation.id)) {
    return refusal(
      'edit.duplicate-id',
      `${quoted(asset.displayName)} already has an edit with that identifier.`,
    );
  }
  const withStack = withNewStack(state, stack.value);
  if (!withStack.ok) return refusedBy(withStack);
  const shape = shapesOf(asset).at(-1);
  if (shape === undefined) throw new Error('A chain always has a shape.');
  const valid = validateOperation(operation, shape, withStack.value.project);
  if (!valid.ok) return refusedBy(valid);
  return applied(
    withAssetEdits(withStack.value, asset, [...asset.edits, operation]),
    removePunchInvocation(asset, operation),
    StackWords.punch(stack.value, asset.displayName),
  );
}

/** The punch `asset`'s chain ends with, named `id`, and its stack, or why there is none. */
function lastPunch(
  state: ProjectState,
  asset: Asset,
  id: EditOperation['id'],
): DomainResult<{ readonly operation: EditOperation; readonly stack: TakeStack }> {
  const last = asset.edits.at(-1);
  const stackId = last === undefined ? undefined : punchStackOf(last);
  if (last?.id !== id || stackId === undefined) {
    return rejected(
      'punch.not-last',
      `Only a punch that is the last edit of ${quoted(asset.displayName)} can be withdrawn.`,
    );
  }
  const stack = state.project.takeStacks.get(stackId);
  if (stack === undefined) throw new Error('A valid chain names only the stacks its project has.');
  return succeed({ operation: last, stack });
}

function removePunch(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const target = targetAsset(state, invocation);
  if (!target.ok) return refusedBy(target);
  const { asset } = target.value;
  const id = idArgument<'EditOperationId'>(invocation, 'operationId');
  if (!id.ok) return refusedBy(id);
  const found = lastPunch(state, asset, id.value);
  if (!found.ok) return refusedBy(found);
  if (placedOnLast(state, asset)) {
    return refusal(
      'edit.placed-after',
      `A marker or region of ${quoted(asset.displayName)} was placed after this punch; remove or move it first.`,
    );
  }
  const { operation, stack } = found.value;
  const withdrawn = withAssetEdits(state, asset, asset.edits.slice(0, -1));
  const shared = stackUsers(withdrawn.project, stack.id).length > 0;
  return applied(
    shared ? withdrawn : withoutTakeStack(withdrawn, stack.id),
    shared ? applyInvocation(asset, operation) : addPunchInvocation(asset, operation, stack),
    StackWords.unpunch(stack, asset.displayName),
  );
}
