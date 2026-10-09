/**
 * Adding a take to a stack, duplicating one, and withdrawing the last
 * (ADR-0072): the only commands that change which takes a stack holds.
 *
 * A take joins the end of its stack, as takes are kept in the order they were
 * made; a recorded take names the asset its recording became, which the storage
 * worker adds in the same change, and may be chosen as it joins. A duplicate
 * names the same recording under its own name. Nothing deletes a take but
 * withdrawing the last, which is the inverse of adding it, so a take a person
 * made leaves the stack only by being undone.
 */

import {
  CommandCategory,
  refusal,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  FailureKind,
  TakeState,
  fail,
  failure,
  type DomainResult,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import { givenName, type ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { idArgument } from '../editing/editing-arguments.js';
import { refusedBy, textArgument } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import {
  flagArgument,
  takeArgument,
  takeIdTaken,
  targetStack,
  targetTake,
} from './take-arguments.js';
import { TakeWords } from './take-descriptions.js';
import { addTakeInvocation, withdrawTakeInvocation } from './take-invocations.js';
import { standing, withTakeStack } from './take-state.js';

/** The commands that add, duplicate and withdraw a stack's takes. */
export function takeMembershipCommands(): readonly ProjectCommand[] {
  const declare = (
    id: ProjectCommand['id'],
    label: string,
    description: string,
    run: (state: ProjectState, invocation: CommandInvocation) => CommandOutcome<ProjectState>,
  ): ProjectCommand =>
    projectCommand({
      id,
      label,
      category: CommandCategory.Edit,
      description,
      run,
      provenance: NO_PROVENANCE,
    });
  return [
    declare(
      ProjectCommandId.AddTake,
      'Add a take',
      'Adds a recorded take to the end of a stack, chosen where asked. The storage worker runs this when a recording finishes.',
      addTake,
    ),
    declare(
      ProjectCommandId.WithdrawTake,
      'Withdraw a take',
      'Withdraws the last take of a stack, which is how adding one is undone.',
      withdrawTake,
    ),
    declare(
      ProjectCommandId.DuplicateTake,
      'Duplicate a take',
      'Adds a take naming the same recording under its own name.',
      duplicateTake,
    ),
  ];
}

/** The state with `take` joining `stack`, or why it cannot. */
function joined(
  state: ProjectState,
  stack: TakeStack,
  take: Take,
  choose: boolean,
): DomainResult<TakeStack> {
  if (takeIdTaken(state, take.id)) {
    return rejected('take.duplicate-id', 'The project already has a take with that identifier.');
  }
  if (choose && take.state !== TakeState.Kept) {
    return rejected('take.not-kept', 'Only a kept take can be chosen.');
  }
  return standing(state, {
    ...stack,
    takes: [...stack.takes, take],
    ...(choose ? { chosen: take.id } : {}),
  });
}

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

function addTake(state: ProjectState, invocation: CommandInvocation): CommandOutcome<ProjectState> {
  const stack = targetStack(state, invocation);
  if (!stack.ok) return refusedBy(stack);
  const take = takeArgument(invocation);
  if (!take.ok) return refusedBy(take);
  const choose = flagArgument(invocation, 'choose');
  if (!choose.ok) return refusedBy(choose);
  const next = joined(state, stack.value, take.value, choose.value);
  if (!next.ok) return refusedBy(next);
  return applied(
    withTakeStack(state, next.value),
    withdrawTakeInvocation(stack.value, take.value, choose.value ? stack.value.chosen : undefined),
    TakeWords.add(stack.value, take.value),
  );
}

function duplicateTake(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const named = targetTake(state, invocation);
  if (!named.ok) return refusedBy(named);
  const copyId = idArgument<'TakeId'>(invocation, 'copyId');
  if (!copyId.ok) return refusedBy(copyId);
  const text = textArgument(invocation, 'name');
  const name = text.ok ? givenName('take', text.value) : text;
  if (!name.ok) return refusedBy(name);
  const { stack, take } = named.value;
  const copy: Take = { ...take, id: copyId.value, name: name.value, state: TakeState.Kept };
  const next = joined(state, stack, copy, false);
  if (!next.ok) return refusedBy(next);
  return applied(
    withTakeStack(state, next.value),
    withdrawTakeInvocation(stack, copy, undefined),
    TakeWords.duplicate(take, copy),
  );
}

function withdrawTake(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const named = targetTake(state, invocation);
  if (!named.ok) return refusedBy(named);
  const { stack, take } = named.value;
  if (stack.takes.at(-1)?.id !== take.id) {
    return refusal(
      'take.not-last',
      `Only the last take of ${quoted(stack.name)} can be withdrawn.`,
    );
  }
  const given = invocation.arguments?.['chosen'];
  const chosen = given === undefined ? undefined : idArgument<'TakeId'>(invocation, 'chosen');
  if (chosen !== undefined && !chosen.ok) return refusedBy(chosen);
  const wasChosen = stack.chosen === take.id;
  if (chosen !== undefined && !wasChosen) {
    return refusal(
      'take.choice-not-moved',
      'A choice is given back only when the take withdrawn is the chosen one.',
    );
  }
  const { chosen: _chosen, ...unchosen } = stack;
  const takes = stack.takes.slice(0, -1);
  const restored = chosen === undefined ? undefined : chosen.value;
  const next = standing(
    state,
    wasChosen
      ? { ...unchosen, takes, ...(restored === undefined ? {} : { chosen: restored }) }
      : { ...stack, takes },
  );
  if (!next.ok) return refusedBy(next);
  return applied(
    withTakeStack(state, next.value),
    addTakeInvocation(stack, take, wasChosen),
    TakeWords.withdraw(stack, take),
  );
}
