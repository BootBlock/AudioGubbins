/**
 * The History panel: every state the open project has been in, on every branch,
 * with its snapshots, branch names and exports, found by words and filtered by
 * scope, and what can be done at each (REQ-STOR-196, REQ-STOR-193 to
 * REQ-STOR-195, REQ-STOR-197, REQ-STOR-200, REQ-UX-005).
 *
 * The rows are the history package's, so no branching rule is decided here.
 * What the panel shows is plain language: changes a person made and the points
 * they kept, never the journal beneath. The words searched for, the scope and
 * the point chosen are the panel's own view state; everything that changes the
 * project is a command.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, OptionSelect, TextField } from '@audiogubbins/design-system';
import {
  historyRows,
  type EntityReference,
  type History,
  type HistoryRow,
  type RowQuery,
} from '@audiogubbins/history';
import type { HistoryNodeId, ProjectState } from '@audiogubbins/project-format';
import type { ProjectModel } from '@audiogubbins/storage';

import { ProjectPanelKinds } from '../../panel-kinds.js';
import { showPanelCommandId } from '../../commands/panel-commands.js';
import type { HistoryReviewState } from '../../state/history-review-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import type { RunCommand } from '../settings/section.js';
import { CompactionReview } from './compaction-review.js';
import { ComparisonView } from './comparison-view.js';
import { HistoryActions } from './history-actions.js';
import { HistoryList } from './history-list.js';
import { SnapshotField } from './snapshot-field.js';

/** What the panel reads and runs. */
export interface HistoryPanelProps {
  readonly title: string;
  readonly project: Observable<OpenProjectState>;
  readonly review: Observable<HistoryReviewState>;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}

const SCOPES = [
  { value: 'all', label: 'Every point' },
  { value: 'active-line', label: 'The line the project is on' },
  { value: 'snapshots', label: 'Snapshots only' },
] as const;

/** How much history there is, in a sentence. */
function summaryOf(history: History): string {
  let changes = 0;
  for (const node of history.nodes.values()) if (node.kind === 'change') changes += 1;
  const branches = [...history.children.values()].reduce(
    (sum, children) => sum + Math.max(0, children.length - 1),
    0,
  );
  const snapshots = history.snapshots.size;
  return `${String(changes)} ${changes === 1 ? 'change' : 'changes'}, ${String(branches)} other ${branches === 1 ? 'branch' : 'branches'} and ${String(snapshots)} ${snapshots === 1 ? 'snapshot' : 'snapshots'}.`;
}

/** The name a person knows an asset by, for finding the changes to it. */
function namesOf(state: ProjectState): (entity: EntityReference) => string | undefined {
  const names = new Map<string, string>();
  for (const [id, asset] of state.project.assets) names.set(id, asset.displayName);
  return (entity) => (entity.kind === 'asset' ? names.get(entity.id) : undefined);
}

/** The rows the words typed and the scope chosen ask for. */
function rowsFor(model: ProjectModel, text: string, scope: string): readonly HistoryRow[] {
  const query: RowQuery = {
    text,
    scope: SCOPES.find((one) => one.value === scope)?.value ?? 'all',
  };
  return historyRows(model.history, query, {
    exports: model.exports,
    nameOf: namesOf(model.state),
  });
}

/** What is open for review: the snapshot field, the comparison, and a plan to remove history. */
function Reviewing({
  model,
  reviewing,
  run,
  unavailableReason,
}: {
  readonly model: ProjectModel;
  readonly reviewing: HistoryReviewState;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  const pending = reviewing.compaction;
  return (
    <>
      <SnapshotField run={run} unavailable={unavailableReason('history.snapshot')} />
      {model.comparison !== undefined && (
        <ComparisonView
          history={model.history}
          comparison={model.comparison}
          difference={reviewing.difference}
          run={run}
        />
      )}
      {pending !== undefined && pending.policy === undefined && (
        <CompactionReview pending={pending} exports={model.exports} run={run} />
      )}
    </>
  );
}

/** The history of the project open, found by words and a scope. */
function OpenHistory({
  title,
  model,
  reviewing,
  run,
  unavailableReason,
}: Omit<HistoryPanelProps, 'project' | 'review'> & {
  readonly model: ProjectModel;
  readonly reviewing: HistoryReviewState;
}): ReactNode {
  const [text, setText] = useState('');
  const [scope, setScope] = useState<string>('all');
  const [chosen, setChosen] = useState<HistoryNodeId | undefined>(undefined);
  const rows = rowsFor(model, text, scope);
  const row = rows.find((one) => one.node.id === (chosen ?? model.history.cursor));

  return (
    <section className="ag-panel ag-history">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        {summaryOf(model.history)}{' '}
        <Button
          compact
          tone="quiet"
          onClick={() => run(showPanelCommandId(ProjectPanelKinds.Storage))}
        >
          What it takes up
        </Button>
      </p>
      <div className="ag-settings-row" role="group" aria-label="Find in the history">
        <TextField label="Find" value={text} onValueChange={setText} />
        <OptionSelect label="Show" value={scope} options={SCOPES} onValueChange={setScope} />
      </div>
      {rows.length === 0 ? (
        <p>Nothing in the history matches.</p>
      ) : (
        <HistoryList
          rows={rows}
          chosen={row?.node.id}
          onChoose={setChosen}
          onGo={(node) => run('history.go-to', { node })}
        />
      )}
      {row !== undefined && (
        <HistoryActions row={row} run={run} unavailableReason={unavailableReason} />
      )}
      <Reviewing
        model={model}
        reviewing={reviewing}
        run={run}
        unavailableReason={unavailableReason}
      />
    </section>
  );
}

/** The panel (see the module comment). */
export function HistoryPanel({ project, review, ...rest }: HistoryPanelProps): ReactNode {
  const open = useSyncExternalStore(project.subscribe, project.get);
  const reviewing = useSyncExternalStore(review.subscribe, review.get);
  if (open.kind !== 'open') {
    return (
      <section className="ag-panel">
        <h2 className="ag-panel-title">{rest.title}</h2>
        <p>No project is open. Its history appears here once one is.</p>
      </section>
    );
  }
  return (
    <OpenHistory
      // Made afresh for another project, so the point chosen in the last is not
      // looked for in this one.
      key={open.snapshot.project}
      model={open.snapshot.model}
      reviewing={reviewing}
      {...rest}
    />
  );
}
