/**
 * Changing one take of a stack in place (ADR-0072, REQ-REC-089): its name,
 * its note, its latency compensation, whether it is chosen, and whether it is
 * kept, rejected or removed from the active stack.
 *
 * No change here deletes a take: removing one marks it removed, and restoring
 * it keeps it again. A take that is rejected or removed is no longer the
 * stack's choice, so rejecting or removing the chosen take leaves a punch
 * stack playing the audio it was punched into. Each change gives back the
 * stack as it was in its inverse (`setTakeStackInvocation`), and is checked by
 * the domain's rule for the stack and every punch that names it, so a choice
 * or a compensation that a punch cannot play is refused with the reason.
 */

import {
  CommandCategory,
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
  type UnchangedOutcome,
  type RefusedOutcome,
} from '@audiogubbins/commands';
import { TakeState, type Take, type TakeStack } from '@audiogubbins/domain';
import { LONGEST_TAKE_NOTE, givenName, type ProjectState } from '@audiogubbins/project-format';

import { refusedBy, textArgument } from '../invocation-arguments.js';
import {
  NO_PROVENANCE,
  ProjectCommandId,
  applied,
  projectCommand,
  type ProjectCommand,
} from '../project-command.js';
import { integerArgument, targetTake, type StackTake } from './take-arguments.js';
import { TakeWords } from './take-descriptions.js';
import { setTakeStackInvocation } from './take-invocations.js';
import { standing, withTakeStack } from './take-state.js';
import { quoted } from '@audiogubbins/text';

/** What a change makes of a take: the stack it leaves and its words, or why it does not. */
type TakeChange =
  | { readonly kind: 'changed'; readonly stack: TakeStack; readonly description: string }
  | RefusedOutcome
  | UnchangedOutcome;

/** The stack with `take` replaced by `changed`, and its choice given up where it is no longer kept. */
function withTake(stack: TakeStack, take: Take, changed: Take): TakeStack {
  const takes = stack.takes.map((each) => (each.id === take.id ? changed : each));
  const { chosen: _chosen, ...rest } = stack;
  const keepsChoice = stack.chosen !== take.id || changed.state === TakeState.Kept;
  return keepsChoice ? { ...stack, takes } : { ...rest, takes };
}

/** A command that changes the take an invocation names, by `change`. */
function takeCommand(
  id: ProjectCommand['id'],
  label: string,
  description: string,
  change: (named: StackTake, invocation: CommandInvocation) => TakeChange,
): ProjectCommand {
  return projectCommand({
    id,
    label,
    category: CommandCategory.Edit,
    description,
    run: (state, invocation) => changeTake(state, invocation, change),
    provenance: NO_PROVENANCE,
  });
}

function changeTake(
  state: ProjectState,
  invocation: CommandInvocation,
  change: (named: StackTake, invocation: CommandInvocation) => TakeChange,
): CommandOutcome<ProjectState> {
  const named = targetTake(state, invocation);
  if (!named.ok) return refusedBy(named);
  const made = change(named.value, invocation);
  if (made.kind !== 'changed') return made;
  const stack = standing(state, made.stack);
  if (!stack.ok) return refusedBy(stack);
  return applied(
    withTakeStack(state, stack.value),
    setTakeStackInvocation(named.value.stack),
    made.description,
  );
}

/** The change to `take`'s state to `to`, from the states `from` allows, in `words`. */
function stateChange(
  { stack, take }: StackTake,
  to: TakeState,
  words: (stack: TakeStack, take: Take) => string,
): TakeChange {
  if (take.state === to) {
    return unchanged('take.state-unchanged', `Take ${quoted(take.name)} is already ${to}.`);
  }
  return {
    kind: 'changed',
    stack: withTake(stack, take, { ...take, state: to }),
    description: words(stack, take),
  };
}

function rename({ stack, take }: StackTake, invocation: CommandInvocation): TakeChange {
  const text = textArgument(invocation, 'name');
  const name = text.ok ? givenName('take', text.value) : text;
  if (!name.ok) return refusedBy(name);
  if (name.value === take.name) {
    return unchanged('take.name-unchanged', 'The take already has that name.');
  }
  return {
    kind: 'changed',
    stack: withTake(stack, take, { ...take, name: name.value }),
    description: TakeWords.rename(take, name.value),
  };
}

function note({ stack, take }: StackTake, invocation: CommandInvocation): TakeChange {
  const text = textArgument(invocation, 'note');
  if (!text.ok) return refusedBy(text);
  if (text.value.length > LONGEST_TAKE_NOTE) {
    return refusal(
      'take.note-too-long',
      `A take’s note can be at most ${String(LONGEST_TAKE_NOTE)} characters long.`,
    );
  }
  if (text.value === take.note) {
    return unchanged('take.note-unchanged', 'The take already has that note.');
  }
  return {
    kind: 'changed',
    stack: withTake(stack, take, { ...take, note: text.value }),
    description: TakeWords.note(take),
  };
}

function compensate({ stack, take }: StackTake, invocation: CommandInvocation): TakeChange {
  const compensation = integerArgument(invocation, 'compensation');
  if (!compensation.ok) return refusedBy(compensation);
  if (compensation.value === take.compensation) {
    return unchanged('take.compensation-unchanged', 'The take already has that compensation.');
  }
  return {
    kind: 'changed',
    stack: withTake(stack, take, { ...take, compensation: compensation.value }),
    description: TakeWords.compensation(take),
  };
}

function choose({ stack, take }: StackTake): TakeChange {
  if (stack.chosen === take.id) {
    return unchanged('take.already-chosen', 'The take is already the chosen one.');
  }
  if (take.state !== TakeState.Kept) {
    return refusal(
      'take.not-kept',
      take.state === TakeState.Rejected
        ? 'A rejected take is kept again before it is chosen.'
        : 'A removed take is restored before it is chosen.',
    );
  }
  return {
    kind: 'changed',
    stack: { ...stack, chosen: take.id },
    description: TakeWords.choose(stack, take),
  };
}

/** The change of `named`'s state to `to`, refused from a state it cannot be reached from. */
function guarded(
  named: StackTake,
  to: TakeState,
  from: readonly TakeState[],
  refused: string,
  words: (stack: TakeStack, take: Take) => string,
): TakeChange {
  return named.take.state === to || from.includes(named.take.state)
    ? stateChange(named, to, words)
    : refusal('take.state-refused', refused);
}

/** The commands that change one take of a stack in place. */
export function takeChangeCommands(): readonly ProjectCommand[] {
  const { Kept, Rejected, Removed } = TakeState;
  return [
    takeCommand(ProjectCommandId.RenameTake, 'Rename a take', 'Gives a take a new name.', rename),
    takeCommand(ProjectCommandId.SetTakeNote, 'Set a take’s note', 'Sets a take’s note.', note),
    takeCommand(
      ProjectCommandId.SetTakeCompensation,
      'Set a take’s latency compensation',
      'Sets where a take is read from, in frames, leaving its samples unchanged.',
      compensate,
    ),
    takeCommand(
      ProjectCommandId.ChooseTake,
      'Choose a take',
      'Makes a kept take the one its stack plays.',
      choose,
    ),
    takeCommand(
      ProjectCommandId.RejectTake,
      'Reject a take',
      'Marks a take rejected, keeping it in its stack.',
      (named) =>
        guarded(named, Rejected, [Kept], 'A removed take is restored first.', TakeWords.reject),
    ),
    takeCommand(
      ProjectCommandId.KeepTake,
      'Keep a take again',
      'Keeps a rejected take again.',
      (named) =>
        guarded(named, Kept, [Rejected], 'A removed take is restored, not kept.', TakeWords.keep),
    ),
    takeCommand(
      ProjectCommandId.RemoveTake,
      'Remove a take',
      'Takes a take out of the active stack. It stays recoverable from the stack.',
      (named) => stateChange(named, Removed, TakeWords.remove),
    ),
    takeCommand(
      ProjectCommandId.RestoreTake,
      'Restore a take',
      'Brings a removed take back into the active stack, kept.',
      (named) =>
        guarded(named, Kept, [Removed], 'Only a removed take is restored.', TakeWords.restore),
    ),
  ];
}
