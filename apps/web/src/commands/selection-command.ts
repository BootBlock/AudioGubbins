/**
 * How a selection command is made: the one path by which a selection changes
 * (ADR-0042), which finds the view's asset, makes the change, refuses one
 * that changes nothing, and stores the result for every view of the asset.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import { selectionsEqual, type SelectionSet } from '@audiogubbins/timeline';

import { editorTarget, needsEditor, type EditorTarget } from './editor-target.js';
import { shellCommand, type ShellCommandOptions } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** A change to the selection of a view's asset, or why it cannot be made. */
export type SelectionChange = (
  current: SelectionSet,
  target: EditorTarget,
  context: ShellContext,
  invocation: Parameters<Command<ShellContext>['run']>[1],
) => SelectionSet | string;

/** A command that changes the selection of the asset a view shows, as `change` says. */
export function selectionCommand(
  id: string,
  label: string,
  change: SelectionChange,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Selection,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const current = context.selections.of(target.asset.id);
      const next = change(current, target, context, invocation);
      if (typeof next === 'string') return next;
      if (selectionsEqual(next, current)) {
        return unchanged('editor.selection-unchanged', 'That is already the selection.');
      }
      context.selections.change(target.asset.id, () => next);
      return undefined;
    },
    { availability: needsEditor, ...extra },
  );
}
