/**
 * What the application does with an arrangement the dock reports.
 *
 * A drag is a gesture, so it goes through the command bus like every other
 * action rather than into the store (REQ-EDIT-073). The engine draws a drag
 * before it reports it, so an arrangement the command refuses is already on
 * screen, and the dock is mounted again from the layout in use: otherwise the
 * screen would keep an arrangement the store had not taken, and the next drag
 * would report it. Here rather than in the command, because only the dock drew
 * what was refused: done in the command, a refused macro or journal entry would
 * rebuild the dock, and every panel's own state with it, for nothing.
 *
 * Built by the composition root and handed to the shell, which passes it to the
 * dock. Built in the shell, it would make `remount` a member every interface
 * file could call, and every call costs each panel its own state. Beside the
 * root rather than among the commands: it is wiring and not a command, and the
 * rule that keeps the interface to the command route leaves the commands out.
 */

import {
  commandId,
  type CommandId,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import type { WorkspaceArrangement } from '@audiogubbins/workspace';

/** Runs a command and answers what happened. */
type Run = (id: CommandId, args?: CommandInvocation['arguments']) => ExecutionResult<unknown>;

/** What the dock reports each arrangement to. */
export function dockRearrangement(
  run: Run,
  remount: () => void,
): (arrangement: WorkspaceArrangement) => void {
  return (arrangement) => {
    const outcome = run(commandId('workspace.rearrange'), {
      arrangement: JSON.stringify(arrangement),
    });
    if (outcome.kind === 'refused') remount();
  };
}
