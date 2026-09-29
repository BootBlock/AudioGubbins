/**
 * Moving through the open project's history and keeping points in it: undo and
 * redo, going to any state on any branch, named snapshots and branch names, and
 * the A/B comparison of two states with its promotion (REQ-STOR-193,
 * REQ-STOR-194, REQ-STOR-195, REQ-STOR-196, REQ-EDIT-073).
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
  type CommandInvocation,
} from '@audiogubbins/commands';
import { redoTarget, undoTarget, type SideName } from '@audiogubbins/history';
import type { ProjectSession } from '@audiogubbins/storage';

import { quoted } from '../wording.js';
import { idArgument, sayWhenSettled, sessionAvailability, sessionOf } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Available where the session has a change for `target` to find. */
function historyAvailability(
  context: ShellContext,
  target: (session: ProjectSession) => unknown,
  nothing: string,
): CommandAvailability {
  const session = sessionOf(context);
  if (typeof session === 'string') return unavailable(session);
  return target(session) === undefined ? unavailable(nothing) : AVAILABLE;
}

const undoOf = (session: ProjectSession) => undoTarget(session.getSnapshot().model.history);
const redoOf = (session: ProjectSession) => redoTarget(session.getSnapshot().model.history);

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

/** Which side an argument names, if it names one, or why it names neither. */
function sideNamed(invocation: CommandInvocation): { readonly side?: SideName } | string {
  const side = textArgument(invocation, 'side');
  if (side === undefined) return {};
  return side === 'a' || side === 'b' ? { side } : 'Choose side A or side B.';
}

/** Why there is no comparison to act on. */
function comparisonAvailability(context: ShellContext): CommandAvailability {
  const session = sessionOf(context);
  if (typeof session === 'string') return unavailable(session);
  return session.getSnapshot().model.comparison === undefined
    ? unavailable('No comparison is open.')
    : AVAILABLE;
}

function compareCommand(): Command<ShellContext> {
  return shellCommand(
    'history.compare',
    'Compare with the current state',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      const review = context.projects?.review;
      if (typeof session === 'string' || review === undefined) return 'No project is open.';
      const node = idArgument<'HistoryNodeId'>(invocation, 'node', 'point of the history');
      if ('refused' in node) return node.refused;
      const current = session.getSnapshot().model.history.cursor;
      const work = review.compare({ kind: 'node', node: current }, { kind: 'node', node: node.id });
      sayWhenSettled(
        context,
        work,
        () => 'Comparing. Side A is the current state, and it is the one being heard.',
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function switchSideCommand(): Command<ShellContext> {
  return shellCommand(
    'history.switch-side',
    'Switch sides of the comparison',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const named = sideNamed(invocation);
      if (typeof named === 'string') return named;
      sayWhenSettled(context, session.switchSide(named.side), () => {
        const listening = session.getSnapshot().model.comparison?.listening;
        return listening === undefined ? undefined : `Side ${listening.toUpperCase()} is heard.`;
      });
      return undefined;
    },
    { keywords: ['compare', 'a/b', 'switch', 'side'], availability: comparisonAvailability },
  );
}

function promoteCommand(): Command<ShellContext> {
  return shellCommand(
    'history.promote',
    'Keep a side of the comparison',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const named = sideNamed(invocation);
      const side = typeof named === 'string' ? undefined : named.side;
      if (side === undefined) return 'Choose side A or side B.';
      sayWhenSettled(
        context,
        session.promote(side),
        () => `Side ${side.toUpperCase()} is the current state. The other stays in the history.`,
      );
      return undefined;
    },
    { discoverable: false, availability: comparisonAvailability },
  );
}

function closeComparisonCommand(): Command<ShellContext> {
  return shellCommand(
    'history.close-comparison',
    'Stop comparing',
    CommandCategory.Edit,
    (context) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      sayWhenSettled(context, session.closeComparison(), () => 'The comparison is closed.');
      return undefined;
    },
    { keywords: ['compare', 'a/b', 'close', 'stop'], availability: comparisonAvailability },
  );
}

/** The A/B comparison. */
function comparisonCommands(): readonly Command<ShellContext>[] {
  return [compareCommand(), switchSideCommand(), promoteCommand(), closeComparisonCommand()];
}

/** Every command that moves through the history or keeps points in it. */
export function historyCommands(): readonly Command<ShellContext>[] {
  return [...stepCommands(), ...pointCommands(), ...comparisonCommands()];
}
