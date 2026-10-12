/**
 * Comparing a spectral edit with the state before it (REQ-STOR-195,
 * ADR-0081): the project's own A/B comparison, opened between the current
 * state, side A, and the state the history held just before the edit was
 * made, side B, as a rack is compared with before its latest change. The
 * person switches and hears the sides with the comparison's own commands and
 * view, and hears either side processed or as its original, spectral edits
 * bypassed with the chains; nothing is held outside the project's history.
 *
 * The edit is the one the invocation names by `operationId`, or the latest
 * spectral edit of the asset or region shown. The change that made it is the
 * one whose inverse withdraws it, found walking back from the current state.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import type { EditOperationId } from '@audiogubbins/domain';
import type { History } from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import type { ProjectOwner } from '../assets/editor-asset.js';
import { editedView } from './edit-target.js';
import { sayWhenSettled } from './project-access.js';
import { needsProjectAsset } from './project-edits.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/**
 * The spectral edits of what `owner` shows, by identifier: its region's own
 * where it shows a region, and its asset's.
 */
function spectralEditIds(owner: ProjectOwner): ReadonlySet<EditOperationId> {
  const ids = new Set<EditOperationId>();
  for (const operation of owner.asset.edits) {
    if (operation.kind === 'process' && operation.edit.kind === 'spectral') ids.add(operation.id);
  }
  for (const operation of owner.region?.operations ?? []) {
    if (operation.edit.kind === 'spectral') ids.add(operation.id);
  }
  return ids;
}

/**
 * The latest change on the line to the current state that made one of
 * `edits`, and the state before it, or why there is none to compare with.
 */
function beforeEdit(
  history: Pick<History, 'cursor' | 'nodes'>,
  edits: ReadonlySet<string>,
): { readonly before: HistoryNodeId; readonly description: string } | string {
  let id: HistoryNodeId | undefined = history.cursor;
  while (id !== undefined) {
    const node = history.nodes.get(id);
    if (node?.kind !== 'change') break;
    const made = node.inverse.some((invocation) => {
      const operation = invocation.arguments?.['operationId'];
      return typeof operation === 'string' && edits.has(operation);
    });
    if (made) {
      return node.parent === undefined
        ? 'The state before that spectral edit is no longer kept in the history.'
        : { before: node.parent, description: node.description };
    }
    id = node.parent;
  }
  return 'The history holds no spectral edit of this sound to compare with.';
}

function compareBeforeEditCommand(): Command<ShellContext> {
  return shellCommand(
    'spectral.compare-before-edit',
    'Compare with before the spectral edit',
    CommandCategory.Edit,
    (context, invocation) => {
      const found = editedView(context, invocation);
      if (typeof found === 'string') return found;
      const { session, owner } = found.project;
      const review = context.projects?.review;
      if (review === undefined) return 'No project is open.';
      const named = textArgument(invocation, 'operationId');
      const all = spectralEditIds(owner);
      if (named !== undefined && ![...all].some((id) => id === named)) {
        return `That is not a spectral edit of ${found.view.asset.name}.`;
      }
      const { history, comparison } = session.getSnapshot().model;
      const edits: ReadonlySet<string> = named === undefined ? all : new Set([named]);
      const before = beforeEdit(history, edits);
      if (typeof before === 'string') return before;
      if (comparison?.a.node === history.cursor && comparison.b.node === before.before) {
        return unchanged(
          'spectral.compared-already',
          'The project is being compared with before that spectral edit already.',
        );
      }
      sayWhenSettled(
        context,
        review.compare(
          { kind: 'node', node: history.cursor },
          { kind: 'node', node: before.before },
        ),
        () =>
          `Comparing the project as it is, side A, with before ${quoted(before.description)}, side B. Side A is heard.`,
      );
      return undefined;
    },
    {
      availability: needsProjectAsset,
      keywords: ['compare', 'a/b', 'before', 'after', 'spectral', 'edit'],
      description:
        'Opens an A/B comparison of the project as it is with the project before a spectral edit of the sound shown, its latest where none is named.',
    },
  );
}

/** The command that compares a spectral edit with the state before it. */
export function spectralComparisonCommands(): readonly Command<ShellContext>[] {
  return [compareBeforeEditCommand()];
}
