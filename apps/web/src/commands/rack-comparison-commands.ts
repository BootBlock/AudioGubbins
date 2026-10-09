/**
 * Comparing a rack with itself before its latest change (REQ-AUDIO-017,
 * REQ-AUDIO-019, REQ-STOR-195): the project's own A/B comparison, opened
 * between the current state, side A, and the state before the latest change
 * the history records to the rack's chain, side B. The person switches and
 * hears the sides with the comparison's own commands and view; nothing is
 * held outside the project's history.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';
import type { EffectChainId } from '@audiogubbins/domain';
import type { History } from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { sayWhenSettled, sessionOf } from './project-access.js';
import { needsProjectAsset } from './project-edits.js';
import { rackScope, targetChain, targetName } from './rack-target.js';
import { shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/**
 * The latest change on the line to the current state that changed `chain`,
 * and the state before it, or why there is none to compare with.
 */
function beforeLatestChange(
  history: Pick<History, 'cursor' | 'nodes'>,
  chain: EffectChainId,
): { readonly before: HistoryNodeId; readonly description: string } | string {
  let id: HistoryNodeId | undefined = history.cursor;
  while (id !== undefined) {
    const node = history.nodes.get(id);
    if (node?.kind !== 'change') break;
    if (node.affects.effectChains.includes(chain)) {
      return node.parent === undefined
        ? 'The state before its latest change is no longer kept in the history.'
        : { before: node.parent, description: node.description };
    }
    id = node.parent;
  }
  return 'The history holds no change to this rack yet, so there is nothing to compare it with.';
}

function compareBeforeChangeCommand(): Command<ShellContext> {
  return shellCommand(
    'rack.compare-before-change',
    'Compare the rack with before its latest change',
    CommandCategory.Edit,
    (context, invocation) => {
      const scope = rackScope(context, invocation);
      if (typeof scope === 'string') return scope;
      const named = targetChain(scope, invocation);
      if (named === undefined) return `${targetName(scope.target)} has no rack to compare.`;
      if ('refused' in named) return named.refused;
      const session = sessionOf(context);
      const review = context.projects?.review;
      if (typeof session === 'string' || review === undefined) return 'No project is open.';
      const { history, comparison } = session.getSnapshot().model;
      const found = beforeLatestChange(history, named.id);
      if (typeof found === 'string') return found;
      if (comparison?.a.node === history.cursor && comparison.b.node === found.before) {
        return unchanged(
          'rack.compared-already',
          'The rack is being compared with before its latest change already.',
        );
      }
      sayWhenSettled(
        context,
        review.compare(
          { kind: 'node', node: history.cursor },
          { kind: 'node', node: found.before },
        ),
        () =>
          `Comparing the rack as it is, side A, with before ${quoted(found.description)}, side B. Side A is heard.`,
      );
      return undefined;
    },
    {
      availability: needsProjectAsset,
      keywords: ['compare', 'a/b', 'before', 'after', 'rack', 'change'],
      description:
        'Opens an A/B comparison of the project as it is with the project before the latest change to the rack shown.',
    },
  );
}

/** The command that compares a rack with itself before its latest change. */
export function rackComparisonCommands(): readonly Command<ShellContext>[] {
  return [compareBeforeChangeCommand()];
}
