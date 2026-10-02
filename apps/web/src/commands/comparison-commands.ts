/**
 * The A/B comparison of two states of the open project's history: choosing
 * both sides, each a point or a snapshot, switching between them, keeping one
 * and stopping (REQ-STOR-195).
 *
 * A comparison runs through the session of the project open to change, so it
 * is kept with the project and comes back after a reload, and promoting a side
 * moves the project to it with the other left in the history. A side is named
 * by a point's identifier (`node`) or a snapshot's (`snapshot`); side A by
 * `fromNode` or `fromSnapshot`, or, where neither is given, the current state.
 * The side chosen first is held for the person while they choose the second.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { ComparisonSource, SideName } from '@audiogubbins/history';

import { idArgument, sayWhenSettled, sessionAvailability, sessionOf } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** A side named by a point or a snapshot, none named, or why the one named is not one. */
type NamedSource = ComparisonSource | undefined | { readonly refused: string };

/** The side an invocation names by the point `nodeKey` or the snapshot `snapshotKey`. */
function sourceNamed(
  invocation: CommandInvocation,
  nodeKey: string,
  snapshotKey: string,
): NamedSource {
  if (textArgument(invocation, snapshotKey) !== undefined) {
    const snapshot = idArgument<'SnapshotId'>(invocation, snapshotKey, 'snapshot');
    return 'refused' in snapshot ? snapshot : { kind: 'snapshot', snapshot: snapshot.id };
  }
  if (textArgument(invocation, nodeKey) === undefined) return undefined;
  const node = idArgument<'HistoryNodeId'>(invocation, nodeKey, 'point of the history');
  return 'refused' in node ? node : { kind: 'node', node: node.id };
}

function compareCommand(): Command<ShellContext> {
  return shellCommand(
    'history.compare',
    'Compare two states',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      const review = context.projects?.review;
      if (typeof session === 'string' || review === undefined) return 'No project is open.';
      const b = sourceNamed(invocation, 'node', 'snapshot');
      if (b === undefined) return 'Say which point or snapshot to compare.';
      if ('refused' in b) return b.refused;
      const a = sourceNamed(invocation, 'fromNode', 'fromSnapshot');
      if (a !== undefined && 'refused' in a) return a.refused;
      const current = session.getSnapshot().model.history.cursor;
      const work = review.compare(a ?? { kind: 'node', node: current }, b);
      const first = a === undefined ? 'the current state' : 'the one chosen first';
      sayWhenSettled(
        context,
        work,
        () => `Comparing. Side A is ${first}, and it is the one being heard.`,
      );
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function chooseSideCommand(): Command<ShellContext> {
  return shellCommand(
    'history.choose-side',
    'Choose a state to compare',
    CommandCategory.Edit,
    (context, invocation) => {
      const session = sessionOf(context);
      const review = context.projects?.review;
      if (typeof session === 'string' || review === undefined) return 'No project is open.';
      const side = sourceNamed(invocation, 'node', 'snapshot');
      if (side === undefined) {
        review.choose(undefined);
        context.interaction.announce('No state is chosen to compare.');
        return undefined;
      }
      if ('refused' in side) return side.refused;
      review.choose(side);
      context.interaction.announce('Chosen as side A. Choose another state to compare it with.');
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
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

/** The A/B comparison (see the module comment). */
export function comparisonCommands(): readonly Command<ShellContext>[] {
  return [
    compareCommand(),
    chooseSideCommand(),
    switchSideCommand(),
    promoteCommand(),
    closeComparisonCommand(),
  ];
}
