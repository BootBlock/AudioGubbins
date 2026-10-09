/**
 * Reading the take commands' arguments (ADR-0072): the stack and the take an
 * invocation names, a stack or a take given whole, and the flags and counts
 * the commands take, each refused with a stable code and a reason. A stack or
 * a take given whole is read by the project format's own reader, so a value a
 * command accepts is one the document accepts.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  takeOf,
  type DomainResult,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import { readTake, readTakeStack, type ProjectState } from '@audiogubbins/project-format';

import { idArgument } from '../editing/editing-arguments.js';
import { jsonArgument, readNested } from '../invocation-arguments.js';

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The stack the argument `stackId` names. */
export function targetStack(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<TakeStack> {
  const id = idArgument<'TakeStackId'>(invocation, 'stackId');
  if (!id.ok) return id;
  const stack = state.project.takeStacks.get(id.value);
  return stack === undefined
    ? rejected('take-stack.unknown', 'The project has no take stack with that identifier.')
    : succeed(stack);
}

/** A stack and one of its takes. */
export interface StackTake {
  readonly stack: TakeStack;
  readonly take: Take;
}

/** The stack the argument `stackId` names, and its take the argument `takeId` names. */
export function targetTake(
  state: ProjectState,
  invocation: CommandInvocation,
): DomainResult<StackTake> {
  const stack = targetStack(state, invocation);
  if (!stack.ok) return stack;
  const id = idArgument<'TakeId'>(invocation, 'takeId');
  if (!id.ok) return id;
  const take = takeOf(stack.value, id.value);
  return take === undefined
    ? rejected('take.unknown', 'The take stack has no take with that identifier.')
    : succeed({ stack: stack.value, take });
}

/** The stack the argument `stack` gives whole. */
export function stackArgument(invocation: CommandInvocation): DomainResult<TakeStack> {
  const value = jsonArgument(invocation, 'stack');
  return value.ok ? readNested(readTakeStack, value.value, '') : value;
}

/** The take the argument `take` gives whole. */
export function takeArgument(invocation: CommandInvocation): DomainResult<Take> {
  const value = jsonArgument(invocation, 'take');
  return value.ok ? readNested(readTake, value.value, '') : value;
}

/** The true or false the argument `name` holds. */
export function flagArgument(invocation: CommandInvocation, name: string): DomainResult<boolean> {
  const value = invocation.arguments?.[name];
  return typeof value === 'boolean'
    ? succeed(value)
    : rejected('argument.not-a-flag', `The argument “${name}” must be true or false.`);
}

/** The whole number the argument `name` holds, of either sign. */
export function integerArgument(invocation: CommandInvocation, name: string): DomainResult<number> {
  const value = invocation.arguments?.[name];
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? succeed(value)
    : rejected('argument.not-a-whole-number', `The argument “${name}” must be a whole number.`);
}

/** Whether any stack of the project has a take with identifier `id`. */
export function takeIdTaken(state: ProjectState, id: Take['id']): boolean {
  for (const stack of state.project.takeStacks.values()) {
    if (takeOf(stack, id) !== undefined) return true;
  }
  return false;
}
