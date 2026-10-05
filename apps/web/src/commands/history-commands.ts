/**
 * Moving through the open project's history and keeping points in it: undo and
 * redo, going to any state on any branch, named snapshots and branch names
 * (REQ-STOR-193, REQ-STOR-194, REQ-STOR-196, REQ-EDIT-073). The A/B comparison
 * of two states is `comparison-commands.ts`.
 *
 * Every one runs through the session of the project open to change, which
 * records it in the history and writes it before it settles, so a reload keeps
 * it. Undo and redo say what they reverse or repeat, as the change described
 * itself. A point of the history is named by its identifier, as the History
 * panel gives it; one it does not hold is refused by the session.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import { redoTarget, undoTarget } from '@audiogubbins/history';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import { idArgument, sayWhenSettled, sessionAvailability, sessionOf } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { quoted } from '@audiogubbins/text';

/** Available where the session has a change for `target` to find. */
function historyAvailability(
  context: ShellContext,
  target: (session: RemoteProjectSession) => unknown,
  nothing: string,
): CommandAvailability {
  const session = sessionOf(context);
  if (typeof session === 'string') return unavailable(session);
  return target(session) === undefined ? unavailable(nothing) : AVAILABLE;
}

const undoOf = (session: RemoteProjectSession) => undoTarget(session.getSnapshot().model.history);
const redoOf = (session: RemoteProjectSession) => redoTarget(session.getSnapshot().model.history);

function undoCommand(): Command<ShellContext> {
  return shellCommand(
    'edit.undo',
    'Undo',
    CommandCategory.Edit,
    (context) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const change = undoOf(session);
      if (change === undefined) return 'There is nothing to undo.';
      sayWhenSettled(context, session.undo(), () => `Undone: ${change.description}.`);
      return undefined;
    },
    {
      keywords: ['undo', 'reverse', 'back', 'history'],
      availability: (context) => historyAvailability(context, undoOf, 'There is nothing to undo.'),
    },
  );
}

function redoCommand(): Command<ShellContext> {
  return shellCommand(
    'edit.redo',
    'Redo',
    CommandCategory.Edit,
    (context) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const change = redoOf(session);
      if (change === undefined) return 'There is nothing to redo.';
      sayWhenSettled(context, session.redo(), () => `Redone: ${change.description}.`);
      return undefined;
    },
    {
      keywords: ['redo', 'repeat', 'forward', 'history'],
      availability: (context) => historyAvailability(context, redoOf, 'There is nothing to redo.'),
    },
  );
}

/** Undo and redo. */
function stepCommands(): readonly Command<ShellContext>[] {
  return [undoCommand(), redoCommand()];
}

function goToCommand(): Command<ShellContext> {
  return shellCommand(
    'history.go-to',
    'Go to a point in the history',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const node = idArgument<'HistoryNodeId'>(invocation, 'node', 'point of the history');
      if ('refused' in node) return node.refused;
      const target = session.getSnapshot().model.history.nodes.get(node.id);
      if (target === undefined) return 'That point is not in the history.';
      const where = target.kind === 'change' ? `after ${target.description}` : 'at its start';
      sayWhenSettled(context, session.goTo(node.id), () => `The project is ${where}.`);
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function snapshotCommand(): Command<ShellContext> {
  return shellCommand(
    'history.snapshot',
    'Keep a snapshot',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const name = textArgument(invocation, 'name')?.trim();
      if (name === undefined || name === '') return 'Type a name for the snapshot.';
      const notes = textArgument(invocation, 'notes');
      const work = session.createSnapshot({ name, ...(notes === undefined ? {} : { notes }) });
      sayWhenSettled(context, work, () => `The snapshot ${quoted(name)} is kept.`);
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function deleteSnapshotCommand(): Command<ShellContext> {
  return shellCommand(
    'history.delete-snapshot',
    'Delete a snapshot',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const snapshot = idArgument<'SnapshotId'>(invocation, 'snapshot', 'snapshot');
      if ('refused' in snapshot) return snapshot.refused;
      const work = session.deleteSnapshot(snapshot.id);
      sayWhenSettled(context, work, () => 'The snapshot is deleted.');
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function nameBranchCommand(): Command<ShellContext> {
  return shellCommand(
    'history.name-branch',
    'Name a branch',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const node = idArgument<'HistoryNodeId'>(invocation, 'node', 'point of the history');
      if ('refused' in node) return node.refused;
      const name = textArgument(invocation, 'name')?.trim();
      const work = session.nameBranch(node.id, name === '' ? undefined : name);
      sayWhenSettled(context, work, () =>
        name === undefined || name === ''
          ? 'The branch has no name now.'
          : `The branch is called ${quoted(name)}.`,
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

/** Going to a point, and keeping and naming points. */
function pointCommands(): readonly Command<ShellContext>[] {
  return [goToCommand(), snapshotCommand(), deleteSnapshotCommand(), nameBranchCommand()];
}

/** Every command that moves through the history or keeps points in it. */
export function historyCommands(): readonly Command<ShellContext>[] {
  return [...stepCommands(), ...pointCommands()];
}
