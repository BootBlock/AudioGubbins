/**
 * What the History panel says of a point in the history and of what letting
 * history go would cost (REQ-STOR-196, REQ-STOR-197, REQ-STOR-200). What
 * differs between two states is `difference-words.ts`.
 *
 * Plain language and nothing of the journal: a point is a change a person made,
 * the start of the project, a snapshot or a branch, and an export is provenance
 * of the point it was made from, never a change of its own.
 */

import type { CompactionPlan, HistoryNode } from '@audiogubbins/history';
import type { ExportRecord } from '@audiogubbins/project-format';

import { describeBytes, quoted } from '../../wording.js';

/** How a time in the history is written. */
const WHEN = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** When something happened, as the panel writes it. */
export function when(at: number): string {
  return WHEN.format(at);
}

/** What a point of the history is, in a phrase. */
export function describeNode(node: HistoryNode): string {
  if (node.kind === 'change') return node.description;
  switch (node.origin.kind) {
    case 'new':
      return 'The project was made';
    case 'import':
      return 'The project was brought in';
    case 'fork':
      return 'The project was forked from another';
  }
}

/** What an export made from a point was, in a phrase. */
export function describeExport(record: ExportRecord): string {
  const where = record.destination.label ?? record.output.container;
  const status =
    record.status === 'succeeded' ? '' : record.status === 'partial' ? ', in part' : ', and failed';
  return `Exported as ${where} on ${when(record.at)}${status}`;
}

/** How many of something, in words. */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** What a compaction would free and take away, a sentence each. */
export function compactionSentences(
  plan: CompactionPlan,
  exportName: (id: string) => string | undefined,
): readonly string[] {
  if (plan.removable.length === 0) return ['Nothing in the history would be removed.'];
  const said = [
    `This removes ${counted(plan.removable.length, 'point', 'points')} of the history for good, and frees ${describeBytes(plan.reclaimableBytes)}.`,
  ];
  for (const lost of plan.lost) {
    switch (lost.kind) {
      case 'undo-before':
        said.push(
          `You could no longer undo past ${when(lost.at)}, ${counted(lost.changes, 'change', 'changes')} back.`,
        );
        break;
      case 'branch':
        said.push(
          `The branch ${lost.name === undefined ? '' : `${quoted(lost.name)} `}of ${counted(lost.changes, 'change', 'changes')}, last used ${when(lost.latestAt)}, would go.`,
        );
        break;
      case 'export-state':
        said.push(
          `You could no longer go back to the state ${exportName(lost.export) ?? 'an export'} was made from.`,
        );
        break;
    }
  }
  if (!plan.withinBudget)
    said.push('Even so, the history would still be larger than the limit set.');
  return said;
}
