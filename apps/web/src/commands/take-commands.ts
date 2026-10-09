/**
 * The take stacks' commands (`ADR-0072`, `REQ-REC-089`, `REQ-REC-093`): naming,
 * noting and placing a take, choosing, rejecting, keeping, removing and
 * restoring it, duplicating it or branching a stack from it, keeping only the
 * chosen take, renaming or removing a stack, withdrawing a punch, and showing a
 * take or a stack in the Inspector.
 *
 * Each runs the project command of the same name through the project's session,
 * as one change the history keeps and one undo takes back (`REQ-STOR-021`):
 * nothing here writes a take. Hearing a take without changing the project is
 * `take-audition.ts`'s.
 */

import { CommandCategory, type Command, type CommandInvocation } from '@audiogubbins/commands';
import {
  isWellFormedId,
  stackUsers,
  takeOf,
  unsafeBrandId,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import {
  branchTakeStackInvocation,
  chooseTakeInvocation,
  consolidateTakeStackInvocation,
  duplicateTakeInvocation,
  keepTakeInvocation,
  rejectTakeInvocation,
  removePunchInvocation,
  removeTakeInvocation,
  removeTakeStackInvocation,
  renameTakeInvocation,
  renameTakeStackInvocation,
  restoreTakeInvocation,
  setTakeCompensationInvocation,
  setTakeNoteInvocation,
} from '@audiogubbins/project-commands';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';
import { quoted } from '@audiogubbins/text';

import { numberArgument } from './editor-target.js';
import { sessionAvailability, sessionOf } from './project-access.js';
import { changeProject } from './project-edits.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** A stack of the open project, named by a command's `stack` argument, and its session. */
interface NamedStack {
  readonly session: RemoteProjectSession;
  readonly stack: TakeStack;
}

/** A take of a stack, named by a command's `stack` and `take` arguments. */
interface NamedTake extends NamedStack {
  readonly take: Take;
}

/** The stack `invocation` names in the project open to change here, or why there is none. */
function namedStack(context: ShellContext, invocation: CommandInvocation): NamedStack | string {
  const session = sessionOf(context);
  if (typeof session === 'string') return session;
  const id = textArgument(invocation, 'stack');
  if (id === undefined) return 'Say which take stack.';
  const stack = isWellFormedId(id)
    ? session.getSnapshot().model.state.project.takeStacks.get(unsafeBrandId<'TakeStackId'>(id))
    : undefined;
  return stack === undefined ? 'There is no such take stack.' : { session, stack };
}

/** The take `invocation` names, or why there is none. */
export function namedTake(
  context: ShellContext,
  invocation: CommandInvocation,
): NamedTake | string {
  const named = namedStack(context, invocation);
  if (typeof named === 'string') return named;
  const id = textArgument(invocation, 'take');
  if (id === undefined) return 'Say which take.';
  const take = isWellFormedId(id) ? takeOf(named.stack, unsafeBrandId<'TakeId'>(id)) : undefined;
  return take === undefined ? `${quoted(named.stack.name)} has no such take.` : { ...named, take };
}

/** A command acting on one take, running the invocation `make` builds and saying `said`. */
function onTake(
  id: string,
  label: string,
  make: (
    named: NamedTake,
    context: ShellContext,
    invocation: CommandInvocation,
  ) => CommandInvocation | string,
  said: (named: NamedTake) => string,
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Edit,
    (context, invocation) => {
      const named = namedTake(context, invocation);
      if (typeof named === 'string') return named;
      const made = make(named, context, invocation);
      if (typeof made === 'string') return made;
      changeProject(context, named.session, {
        description: label,
        invocations: [made],
        said: said(named),
      });
      return undefined;
    },
    { keywords, discoverable: false, availability: sessionAvailability },
  );
}

function takeCommands(): readonly Command<ShellContext>[] {
  return [
    onTake(
      'take.rename',
      'Rename a take',
      ({ stack, take }, _context, invocation) => {
        const name = textArgument(invocation, 'name');
        return name === undefined ? 'Say the new name.' : renameTakeInvocation(stack, take, name);
      },
      ({ take }) => `${quoted(take.name)} is renamed.`,
      ['rename', 'name', 'take'],
    ),
    onTake(
      'take.note',
      'Note a take',
      ({ stack, take }, _context, invocation) => {
        const note = invocation.arguments?.['note'];
        return typeof note === 'string'
          ? setTakeNoteInvocation(stack, take, note)
          : 'Say the note.';
      },
      ({ take }) => `The note of ${quoted(take.name)} is changed.`,
      ['note', 'annotate', 'comment', 'take'],
    ),
    onTake(
      'take.set-compensation',
      "Set a take's placement",
      ({ stack, take }, _context, invocation) => {
        const frames = numberArgument(invocation, 'frames');
        return frames === undefined || !Number.isInteger(frames)
          ? 'Say the placement as a whole number of frames.'
          : setTakeCompensationInvocation(stack, take, frames);
      },
      ({ take }) => `${quoted(take.name)} is placed again. Its recording is unchanged.`,
      ['placement', 'latency', 'compensation', 'offset', 'take'],
    ),
    onTake(
      'take.choose',
      'Choose a take',
      ({ stack, take }) => chooseTakeInvocation(stack, take),
      ({ stack, take }) => `${quoted(take.name)} is chosen in ${quoted(stack.name)}.`,
      ['choose', 'promote', 'select', 'prefer', 'take'],
    ),
    onTake(
      'take.reject',
      'Reject a take',
      ({ stack, take }) => rejectTakeInvocation(stack, take),
      ({ take }) => `${quoted(take.name)} is rejected, and kept in its stack.`,
      ['reject', 'take'],
    ),
    onTake(
      'take.keep',
      'Keep a take again',
      ({ stack, take }) => keepTakeInvocation(stack, take),
      ({ take }) => `${quoted(take.name)} is kept again.`,
      ['keep', 'unreject', 'take'],
    ),
    onTake(
      'take.remove',
      'Remove a take from its stack',
      ({ stack, take }) => removeTakeInvocation(stack, take),
      ({ take }) =>
        `${quoted(take.name)} is removed from the active stack. Its recording is kept, and Restore brings it back.`,
      ['remove', 'take', 'hide'],
    ),
    onTake(
      'take.restore',
      'Restore a removed take',
      ({ stack, take }) => restoreTakeInvocation(stack, take),
      ({ take }) => `${quoted(take.name)} is back in its stack.`,
      ['restore', 'take', 'bring back'],
    ),
    onTake(
      'take.duplicate',
      'Duplicate a take',
      ({ stack, take }, context) =>
        duplicateTakeInvocation(stack, take, context.ids.next<'TakeId'>(), `${take.name} (copy)`),
      ({ take }) => `${quoted(take.name)} is duplicated, naming the same recording.`,
      ['duplicate', 'copy', 'take'],
    ),
    onTake(
      'take.branch',
      'Branch a stack from a take',
      ({ stack, take }, context) =>
        branchTakeStackInvocation(
          stack,
          take,
          context.ids.next<'TakeStackId'>(),
          context.ids.next<'TakeId'>(),
          `${stack.name} from ${take.name}`,
        ),
      ({ take }) => `A new take stack starts from ${quoted(take.name)}.`,
      ['branch', 'new stack', 'take'],
    ),
  ];
}

/** A command acting on one stack. */
function onStack(
  id: string,
  label: string,
  make: (named: NamedStack, invocation: CommandInvocation) => CommandInvocation | string,
  said: (named: NamedStack) => string,
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Edit,
    (context, invocation) => {
      const named = namedStack(context, invocation);
      if (typeof named === 'string') return named;
      const made = make(named, invocation);
      if (typeof made === 'string') return made;
      changeProject(context, named.session, {
        description: label,
        invocations: [made],
        said: said(named),
      });
      return undefined;
    },
    { keywords, discoverable: false, availability: sessionAvailability },
  );
}

function stackCommands(): readonly Command<ShellContext>[] {
  return [
    onStack(
      'take-stack.rename',
      'Rename a take stack',
      ({ stack }, invocation) => {
        const name = textArgument(invocation, 'name');
        return name === undefined ? 'Say the new name.' : renameTakeStackInvocation(stack, name);
      },
      ({ stack }) => `${quoted(stack.name)} is renamed.`,
      ['rename', 'stack'],
    ),
    onStack(
      'take-stack.consolidate',
      'Keep only the chosen take',
      ({ stack }) => consolidateTakeStackInvocation(stack),
      ({ stack }) =>
        `Only the chosen take of ${quoted(stack.name)} is in the active stack now. The others are kept, removed, and Undo brings them back.`,
      ['consolidate', 'keep only', 'flatten', 'stack'],
    ),
    onStack(
      'take-stack.remove',
      'Remove a take stack',
      ({ stack }) => removeTakeStackInvocation(stack),
      ({ stack }) => `${quoted(stack.name)} is removed. Undo brings it back.`,
      ['remove', 'delete', 'stack'],
    ),
    onStack(
      'take-stack.remove-punch',
      'Withdraw a punch',
      ({ session, stack }) => {
        const [use] = stackUsers(session.getSnapshot().model.state.project, stack.id);
        return use === undefined
          ? `${quoted(stack.name)} is no punch's stack.`
          : removePunchInvocation({ id: use.asset }, { id: use.operation });
      },
      ({ stack }) =>
        `The punch of ${quoted(stack.name)} is withdrawn: the audio it replaced plays again, and its takes are kept.`,
      ['punch', 'withdraw', 'remove', 'unpunch', 'stack'],
    ),
  ];
}

function inspectCommand(): Command<ShellContext> {
  return shellCommand(
    'take.inspect',
    'Show a take, a stack or the recording configuration in the Inspector',
    CommandCategory.View,
    (context, invocation) => {
      if (textArgument(invocation, 'stack') === undefined) {
        context.recording.inspect(undefined);
        return undefined;
      }
      if (textArgument(invocation, 'take') === undefined) {
        const stack = namedStack(context, invocation);
        if (typeof stack === 'string') return stack;
        context.recording.inspect({ stack: stack.stack.id });
        return undefined;
      }
      const take = namedTake(context, invocation);
      if (typeof take === 'string') return take;
      context.recording.inspect({ stack: take.stack.id, take: take.take.id });
      return undefined;
    },
    { keywords: ['inspect', 'properties', 'take', 'stack'], discoverable: false },
  );
}

/** Every take stack command. */
export function takeStackCommands(): readonly Command<ShellContext>[] {
  return [...takeCommands(), ...stackCommands(), inspectCommand()];
}
