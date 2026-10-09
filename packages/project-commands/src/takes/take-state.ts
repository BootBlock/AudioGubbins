/**
 * The changes the take commands make to a project state, each giving a new
 * state and leaving the one it was given as it was (REQ-ARCH-153), and the
 * one check every changed stack meets before it stands: the domain's rule for
 * a stack in its project, with every punch that names it (ADR-0072).
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  takeOf,
  validateTakeStackInProject,
  type DomainResult,
  type TakeStack,
  type TakeStackId,
} from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

/** The state with a take stack added or replaced. */
export function withTakeStack(state: ProjectState, stack: TakeStack): ProjectState {
  const takeStacks = new Map(state.project.takeStacks).set(stack.id, stack);
  return { ...state, project: { ...state.project, takeStacks } };
}

/** The state without a take stack. */
export function withoutTakeStack(state: ProjectState, id: TakeStackId): ProjectState {
  const takeStacks = new Map(state.project.takeStacks);
  takeStacks.delete(id);
  return { ...state, project: { ...state.project, takeStacks } };
}

/** The stack, where it may stand in `state` in place of the stack of its identifier. */
export function standing(state: ProjectState, stack: TakeStack): DomainResult<TakeStack> {
  return validateTakeStackInProject(stack, state.project);
}

/**
 * The state with `stack` joining it as a new stack, or why it cannot: its
 * identifier or one of its takes' is the project's already, or it does not
 * stand there.
 */
export function withNewStack(state: ProjectState, stack: TakeStack): DomainResult<ProjectState> {
  if (state.project.takeStacks.has(stack.id)) {
    return fail(
      failure(
        'take-stack.duplicate-id',
        FailureKind.Rejected,
        'The project already has a take stack with that identifier.',
      ),
    );
  }
  for (const other of state.project.takeStacks.values()) {
    if (stack.takes.some((take) => takeOf(other, take.id) !== undefined)) {
      return fail(
        failure(
          'take.duplicate-id',
          FailureKind.Rejected,
          'The project already has a take with that identifier.',
        ),
      );
    }
  }
  const valid = standing(state, stack);
  return valid.ok ? succeed(withTakeStack(state, valid.value)) : valid;
}
