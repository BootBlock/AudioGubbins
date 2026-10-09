/**
 * Creating, naming, branching, consolidating and removing take stacks
 * (ADR-0072, REQ-REC-089, REQ-REC-093).
 *
 * A stack enters given whole, as a recording that finishes makes it with its
 * first take, and leaves whole, only while no punch names it, so its inverse
 * gives it back exactly. Branching starts a new stack from one take, keeping
 * the original's punch range so the branch can be punched with too.
 * Consolidating keeps only the chosen take active, marking every other
 * removed, so nothing is deleted and one undo gives them all back.
 *
 * Setting a stack whole is how each in-place change is undone. It sets the
 * names, notes, states, compensations and choice, never which takes the stack
 * holds or its punch range, so no invocation of it can delete a take.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import { TakeState, chosenTake, stackUsers, type TakeStack } from '@audiogubbins/domain';
import {
  canonicalJson,
  givenName,
  writePunchRange,
  writeTakeStack,
  type ProjectState,
} from '@audiogubbins/project-format';
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
import { stackArgument, targetStack, targetTake } from './take-arguments.js';
import { StackWords } from './take-descriptions.js';
import {
  createTakeStackInvocation,
  removeTakeStackInvocation,
  setTakeStackInvocation,
} from './take-invocations.js';
import { standing, withNewStack, withTakeStack, withoutTakeStack } from './take-state.js';

/** A command that acts on a whole take stack, by `run`. */
function stackCommand(
  id: ProjectCommand['id'],
  label: string,
  description: string,
  run: (state: ProjectState, invocation: CommandInvocation) => CommandOutcome<ProjectState>,
): ProjectCommand {
  return projectCommand({
    id,
    label,
    category: CommandCategory.Edit,
    description,
    run,
    provenance: NO_PROVENANCE,
  });
}

/** The commands that create, change and remove whole take stacks. */
export function stackCommands(): readonly ProjectCommand[] {
  return [
    stackCommand(
      ProjectCommandId.CreateTakeStack,
      'Create a take stack',
      'Adds a take stack, given whole with its takes. The storage worker runs this when a recording finishes.',
      createStack,
    ),
    stackCommand(
      ProjectCommandId.RemoveTakeStack,
      'Remove a take stack',
      'Removes a take stack no punch plays.',
      removeStack,
    ),
    stackCommand(
      ProjectCommandId.RenameTakeStack,
      'Rename a take stack',
      'Gives a take stack a new name.',
      renameStack,
    ),
    stackCommand(
      ProjectCommandId.SetTakeStack,
      'Change a take stack',
      'Sets a take stack’s names, notes, states and choice as given, which is how undo restores them.',
      setStack,
    ),
    stackCommand(
      ProjectCommandId.BranchTakeStack,
      'Branch a take stack',
      'Starts a new take stack from one take of another.',
      branchStack,
    ),
    stackCommand(
      ProjectCommandId.ConsolidateTakeStack,
      'Keep only the chosen take',
      'Removes every take of a stack but the chosen one from the active stack, recoverably.',
      consolidateStack,
    ),
  ];
}

function createStack(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const stack = stackArgument(invocation);
  if (!stack.ok) return refusedBy(stack);
  const next = withNewStack(state, stack.value);
  if (!next.ok) return refusedBy(next);
  return applied(
    next.value,
    removeTakeStackInvocation(stack.value),
    StackWords.create(stack.value),
  );
}

function removeStack(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const stack = targetStack(state, invocation);
  if (!stack.ok) return refusedBy(stack);
  const punches = stackUsers(state.project, stack.value.id).length;
  if (punches > 0) {
    return refusal(
      'take-stack.in-use',
      `${quoted(stack.value.name)} is played by ${punches === 1 ? 'a punch' : `${String(punches)} punches`}; withdraw ${punches === 1 ? 'it' : 'them'} first.`,
    );
  }
  return applied(
    withoutTakeStack(state, stack.value.id),
    createTakeStackInvocation(stack.value),
    StackWords.remove(stack.value),
  );
}

function renameStack(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const stack = targetStack(state, invocation);
  if (!stack.ok) return refusedBy(stack);
  const text = textArgument(invocation, 'name');
  const name = text.ok ? givenName('take stack', text.value) : text;
  if (!name.ok) return refusedBy(name);
  if (name.value === stack.value.name) {
    return unchanged('take-stack.name-unchanged', 'The take stack already has that name.');
  }
  return applied(
    withTakeStack(state, { ...stack.value, name: name.value }),
    setTakeStackInvocation(stack.value),
    StackWords.rename(stack.value, name.value),
  );
}

/** Whether `next` holds the same takes as `stack`, in its order, of the same recordings, and its punch. */
function sameMembers(stack: TakeStack, next: TakeStack): boolean {
  const punch = (value: TakeStack) =>
    value.punch === undefined ? '' : canonicalJson(writePunchRange(value.punch));
  return (
    stack.takes.length === next.takes.length &&
    stack.takes.every((take, index) => {
      const other = next.takes[index];
      return take.id === other?.id && take.asset === other.asset;
    }) &&
    punch(stack) === punch(next)
  );
}

function setStack(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const given = stackArgument(invocation);
  if (!given.ok) return refusedBy(given);
  const old = state.project.takeStacks.get(given.value.id);
  if (old === undefined) {
    return refusal('take-stack.unknown', 'The project has no take stack with that identifier.');
  }
  if (!sameMembers(old, given.value)) {
    return refusal(
      'take-stack.members-changed',
      'Setting a take stack keeps its takes and its punch; takes are added and withdrawn by their own commands.',
    );
  }
  if (canonicalJson(writeTakeStack(old)) === canonicalJson(writeTakeStack(given.value))) {
    return unchanged('take-stack.unchanged', 'The take stack is already as given.');
  }
  const next = standing(state, given.value);
  if (!next.ok) return refusedBy(next);
  return applied(
    withTakeStack(state, next.value),
    setTakeStackInvocation(old),
    StackWords.set(next.value),
  );
}

function branchStack(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const named = targetTake(state, invocation);
  if (!named.ok) return refusedBy(named);
  const branchId = idArgument<'TakeStackId'>(invocation, 'branchId');
  if (!branchId.ok) return refusedBy(branchId);
  const copyId = idArgument<'TakeId'>(invocation, 'copyId');
  if (!copyId.ok) return refusedBy(copyId);
  const text = textArgument(invocation, 'name');
  const name = text.ok ? givenName('take stack', text.value) : text;
  if (!name.ok) return refusedBy(name);
  const { stack, take } = named.value;
  const branch: TakeStack = {
    id: branchId.value,
    name: name.value,
    takes: [{ ...take, id: copyId.value, state: TakeState.Kept }],
    chosen: copyId.value,
    ...(stack.punch === undefined ? {} : { punch: stack.punch }),
  };
  const next = withNewStack(state, branch);
  if (!next.ok) return refusedBy(next);
  return applied(next.value, removeTakeStackInvocation(branch), StackWords.branch(branch, take));
}

function consolidateStack(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const stack = targetStack(state, invocation);
  if (!stack.ok) return refusedBy(stack);
  const chosen = chosenTake(stack.value);
  if (chosen === undefined) {
    return refusal('take-stack.nothing-chosen', 'Choose the take to keep before keeping only it.');
  }
  const others = stack.value.takes.filter(
    (take) => take.id !== chosen.id && take.state !== TakeState.Removed,
  );
  if (others.length === 0) {
    return unchanged('take-stack.already-consolidated', 'The chosen take is the only one active.');
  }
  const takes = stack.value.takes.map((take) =>
    take.id === chosen.id ? take : { ...take, state: TakeState.Removed },
  );
  return applied(
    withTakeStack(state, { ...stack.value, takes }),
    setTakeStackInvocation(stack.value),
    StackWords.consolidate(stack.value, chosen),
  );
}
