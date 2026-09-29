/**
 * A plan to let history go, shown before anything goes: what it frees, and
 * every undo, branch and export state it takes away, with the confirmation that
 * carries it out and the choice that keeps everything (REQ-STOR-055,
 * REQ-STOR-106, REQ-STOR-200).
 *
 * Shared by the History panel, which plans removing history before a point or a
 * branch, and the settings, which plan a retention policy. The plan carried out
 * is the one shown, bytes and all, which the storage checks.
 */

import type { ReactNode } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import type { ExportRecord } from '@audiogubbins/project-format';

import type { PendingCompaction } from '../../state/history-review-store.js';
import type { RunCommand } from '../settings/section.js';
import { compactionSentences, describeExport } from './history-words.js';

/** The plan, and the two decisions on it. */
export function CompactionReview({
  pending,
  exports,
  run,
}: {
  readonly pending: PendingCompaction;

  /** The project's exports, to name the one whose state a plan takes away. */
  readonly exports: readonly ExportRecord[];
  readonly run: RunCommand;
}): ReactNode {
  const nameOf = (id: string): string | undefined => {
    const record = exports.find((one) => one.id === id);
    return record === undefined ? undefined : describeExport(record).toLowerCase();
  };
  const removes = pending.plan.removable.length > 0;
  const keeping = pending.policy === undefined ? 'Keep the history' : 'Leave the policy as it is';
  return (
    <div
      role="group"
      className="ag-history-compaction"
      aria-label="What removing history would cost"
    >
      <h3 className="ag-section-heading">
        {pending.policy === undefined ? 'Remove history' : 'Keep less history'}
      </h3>
      <ul>
        {compactionSentences(pending.plan, nameOf).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <div className="ag-settings-row">
        <Button
          compact
          tone={removes ? ButtonTone.Destructive : ButtonTone.Primary}
          onClick={() => run('history.confirm-compaction')}
        >
          {removes ? 'Remove it for good' : 'Apply'}
        </Button>
        <Button compact onClick={() => run('history.cancel-compaction')}>
          {keeping}
        </Button>
      </div>
    </div>
  );
}
