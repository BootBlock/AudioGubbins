/**
 * What can be done at the point of the history chosen in the History panel:
 * going to it, comparing it or a snapshot kept at it with the current state or
 * with a side chosen first, forking a project from it, naming the branch it
 * starts, deleting a snapshot kept at it, and letting the history before it or
 * its branch go (REQ-STOR-193 to REQ-STOR-196, REQ-STOR-199, REQ-STOR-200).
 *
 * Every action runs a command naming the point, and each command's own reason
 * for not running is shown beside its button, as the menus show it. Letting
 * history go only plans: what it would cost is shown, and asked about, first.
 */

import { useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import type { ComparisonSource, HistoryRow } from '@audiogubbins/history';
import { LONGEST_HISTORY_LABEL, LONGEST_NAME } from '@audiogubbins/project-format';

import { quoted } from '../../wording.js';
import { ReasonedButton } from '../settings/reasoned-button.js';
import type { RunCommand } from '../settings/section.js';
import { describeNode } from './history-words.js';

/** What the actions read and run. */
export interface HistoryActionsProps {
  readonly row: HistoryRow;

  /** The side of a comparison chosen first, where one is. */
  readonly chosen: ComparisonSource | undefined;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}

/** A name typed and the command it names a point with. */
function NamingField({
  label,
  action,
  initial,
  longest,
  onName,
  unavailable,
}: {
  readonly label: string;
  readonly action: string;
  readonly initial: string;

  /** The longest name what is named keeps. */
  readonly longest: number;
  readonly onName: (name: string) => void;
  readonly unavailable: string | undefined;
}): ReactNode {
  const [name, setName] = useState(initial);
  const chosen = name.trim();
  const go = (): void => {
    onName(chosen);
  };
  return (
    <div className="ag-settings-row">
      <TextField
        label={label}
        value={name}
        onValueChange={setName}
        onSubmit={go}
        maxLength={longest}
      />
      <ReasonedButton
        reason={unavailable ?? (chosen === '' ? 'Type a name first.' : undefined)}
        onPress={go}
      >
        {action}
      </ReasonedButton>
    </div>
  );
}

/** The arguments naming side A as `chosen`. */
function fromSide(chosen: ComparisonSource): Readonly<Record<string, string>> {
  return chosen.kind === 'node' ? { fromNode: chosen.node } : { fromSnapshot: chosen.snapshot };
}

/** Whether `chosen` is the point or the snapshot `source` names. */
function isChosen(chosen: ComparisonSource, source: ComparisonSource): boolean {
  if (chosen.kind === 'node') return source.kind === 'node' && chosen.node === source.node;
  return source.kind === 'snapshot' && chosen.snapshot === source.snapshot;
}

/** Comparing a point or a snapshot with side A where one is chosen, or choosing it as side A. */
function ComparingWith({
  source,
  label,
  chosen,
  run,
  unavailableReason,
}: Pick<HistoryActionsProps, 'chosen' | 'run' | 'unavailableReason'> & {
  readonly source: ComparisonSource;

  /** What the point or snapshot is called on its buttons. */
  readonly label: string;
}): ReactNode {
  const named: Readonly<Record<string, string>> =
    source.kind === 'node' ? { node: source.node } : { snapshot: source.snapshot };
  if (chosen === undefined) {
    return (
      <ReasonedButton
        reason={unavailableReason('history.choose-side')}
        onPress={() => run('history.choose-side', named)}
      >
        {`Choose ${label} as side A`}
      </ReasonedButton>
    );
  }
  return (
    <ReasonedButton
      reason={
        unavailableReason('history.compare') ??
        (isChosen(chosen, source) ? 'This is side A already.' : undefined)
      }
      onPress={() => run('history.compare', { ...named, ...fromSide(chosen) })}
    >
      {`Compare ${label} with side A`}
    </ReasonedButton>
  );
}

/** Going to the point, and comparing it with the current state or with side A. */
function Moving({ row, chosen, run, unavailableReason }: HistoryActionsProps): ReactNode {
  const node = row.node.id;
  const here = row.isCurrent ? 'The project is at this point already.' : undefined;
  return (
    <div className="ag-settings-row">
      <ReasonedButton
        reason={unavailableReason('history.go-to') ?? here}
        onPress={() => run('history.go-to', { node })}
      >
        Go to this point
      </ReasonedButton>
      <ReasonedButton
        reason={unavailableReason('history.compare') ?? here}
        onPress={() => run('history.compare', { node })}
      >
        Compare with the current state
      </ReasonedButton>
      <ComparingWith
        source={{ kind: 'node', node }}
        label="this point"
        chosen={chosen}
        run={run}
        unavailableReason={unavailableReason}
      />
      {chosen !== undefined && (
        <ReasonedButton reason={undefined} onPress={() => run('history.choose-side')}>
          Forget side A
        </ReasonedButton>
      )}
    </div>
  );
}

/** Letting the history before the point go, or the branch it starts. */
function Removing({ row, run, unavailableReason }: HistoryActionsProps): ReactNode {
  const node = row.node.id;
  const planning = unavailableReason('history.plan-compaction');
  return (
    <div className="ag-settings-row">
      <ReasonedButton
        reason={
          planning ?? (row.node.kind === 'origin' ? 'Nothing comes before the start.' : undefined)
        }
        onPress={() => run('history.plan-compaction', { before: node })}
      >
        Remove the history before this point…
      </ReasonedButton>
      {row.forkPoint !== undefined && (
        <ReasonedButton
          reason={planning}
          onPress={() => run('history.plan-compaction', { branch: node })}
        >
          Remove this branch…
        </ReasonedButton>
      )}
    </div>
  );
}

/** The actions (see the module comment). */
export function HistoryActions(props: HistoryActionsProps): ReactNode {
  const { row, run, unavailableReason } = props;
  const node = row.node.id;
  return (
    <div role="group" className="ag-history-actions" aria-label="At the chosen point">
      <h3 className="ag-section-heading">{describeNode(row.node)}</h3>
      <Moving {...props} />
      <NamingField
        key={`fork-${node}`}
        label="Name of a new project from here"
        action="Fork from here"
        initial=""
        longest={LONGEST_NAME}
        onName={(name) => run('file.fork-project', { name, node })}
        unavailable={unavailableReason('file.fork-project')}
      />
      {row.forkPoint !== undefined && (
        <NamingField
          key={`branch-${node}`}
          label="Name of this branch"
          action="Name the branch"
          initial={row.branchName ?? ''}
          longest={LONGEST_HISTORY_LABEL}
          onName={(name) => run('history.name-branch', { node, name })}
          unavailable={unavailableReason('history.name-branch')}
        />
      )}
      {row.snapshots.map((snapshot) => (
        <div key={snapshot.id} className="ag-settings-row">
          <ComparingWith
            source={{ kind: 'snapshot', snapshot: snapshot.id }}
            label={`the snapshot ${quoted(snapshot.name)}`}
            chosen={props.chosen}
            run={run}
            unavailableReason={unavailableReason}
          />
          <ReasonedButton
            reason={unavailableReason('history.delete-snapshot')}
            onPress={() => run('history.delete-snapshot', { snapshot: snapshot.id })}
          >
            {`Delete the snapshot ${quoted(snapshot.name)}`}
          </ReasonedButton>
        </div>
      ))}
      <Removing {...props} />
    </div>
  );
}
