/**
 * What can be done at the point of the history chosen in the History panel:
 * going to it, comparing it or a snapshot kept at it with the current state or
 * with a side chosen first, forking a project from it, naming the branch it
 * starts, deleting a snapshot kept at it, and letting the history before it or
 * its branch go (REQ-STOR-193 to REQ-STOR-196, REQ-STOR-199, REQ-STOR-200),
 * and describing in the Inspector an export made from it (REQ-EDIT-072).
 *
 * Every action runs a command naming the point, and each command's own reason
 * for not running opens from its button on hover or focus and describes it, as
 * every unavailable control's does (ADR-0013). Letting history go only plans:
 * what it would cost is shown, and asked about, first.
 */

import { useState, type ReactNode } from 'react';

import { Button, ButtonTone, Icon, TextField, type IconName } from '@audiogubbins/design-system';
import type { ComparisonSource, HistoryRow } from '@audiogubbins/history';
import {
  LONGEST_HISTORY_LABEL,
  LONGEST_NAME,
  type ExportRecord,
} from '@audiogubbins/project-format';

import { ExportCommand } from '../../commands/import-export-ids.js';
import { when } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';
import { describeNode } from './history-words.js';
import { quoted } from '@audiogubbins/text';

/** What the actions read and run. */
export interface HistoryActionsProps {
  readonly row: HistoryRow;

  /** The side of a comparison chosen first, where one is. */
  readonly chosen: ComparisonSource | undefined;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}

/**
 * A button that runs an action at the point, unavailable with `reason`. Where
 * its face is shorter than its name, `label` is the whole name, and it holds the
 * face's words, so a person who says what they see still reaches it.
 */
function ActionButton({
  reason,
  onPress,
  tone,
  icon,
  label,
  children,
}: {
  readonly reason: string | undefined;
  readonly onPress: () => void;
  readonly tone?: ButtonTone;
  readonly icon?: IconName;
  readonly label?: string;
  readonly children: string;
}): ReactNode {
  return (
    <Button
      compact
      {...(tone === undefined ? {} : { tone })}
      {...(label === undefined ? {} : { label })}
      {...(reason === undefined ? {} : { unavailableReason: reason })}
      onClick={onPress}
    >
      {icon !== undefined && <Icon name={icon} />}
      {children}
    </Button>
  );
}

/** A name typed and the command it names a point with. */
function NamingField({
  label,
  action,
  icon,
  initial,
  longest,
  onName,
  unavailable,
}: {
  readonly label: string;
  readonly action: string;
  readonly icon: IconName;
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
    <div className="ag-history-field-row">
      <TextField
        label={label}
        value={name}
        onValueChange={setName}
        onSubmit={go}
        maxLength={longest}
      />
      <ActionButton
        icon={icon}
        reason={unavailable ?? (chosen === '' ? 'Type a name first.' : undefined)}
        onPress={go}
      >
        {action}
      </ActionButton>
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
  short = false,
  chosen,
  run,
  unavailableReason,
}: Pick<HistoryActionsProps, 'chosen' | 'run' | 'unavailableReason'> & {
  readonly source: ComparisonSource;

  /** What the point or snapshot is called on its buttons. */
  readonly label: string;

  /** Whether the face says only what is done with side A, and the name says the rest. */
  readonly short?: boolean;
}): ReactNode {
  const named: Readonly<Record<string, string>> =
    source.kind === 'node' ? { node: source.node } : { snapshot: source.snapshot };
  if (chosen === undefined) {
    const name = `Choose ${label} as side A`;
    return (
      <ActionButton
        {...(short ? { label: name } : {})}
        reason={unavailableReason('history.choose-side')}
        onPress={() => run('history.choose-side', named)}
      >
        {short ? 'Side A' : name}
      </ActionButton>
    );
  }
  const name = `Compare ${label} with side A`;
  return (
    <ActionButton
      icon="compare"
      {...(short ? { label: name } : {})}
      reason={
        unavailableReason('history.compare') ??
        (isChosen(chosen, source) ? 'This is side A already.' : undefined)
      }
      onPress={() => run('history.compare', { ...named, ...fromSide(chosen) })}
    >
      {short ? 'Compare with side A' : name}
    </ActionButton>
  );
}

/** Going to the point, and comparing it with the current state or with side A. */
function Moving({ row, chosen, run, unavailableReason }: HistoryActionsProps): ReactNode {
  const node = row.node.id;
  const here = row.isCurrent ? 'The project is at this point already.' : undefined;
  return (
    <div className="ag-history-buttons">
      <ActionButton
        tone={ButtonTone.Primary}
        icon="return-to-state"
        reason={unavailableReason('history.go-to') ?? here}
        onPress={() => run('history.go-to', { node })}
      >
        Go to this point
      </ActionButton>
      <ActionButton
        icon="compare"
        label="Compare with the current state"
        reason={unavailableReason('history.compare') ?? here}
        onPress={() => run('history.compare', { node })}
      >
        Compare
      </ActionButton>
      <ComparingWith
        source={{ kind: 'node', node }}
        label="this point"
        short
        chosen={chosen}
        run={run}
        unavailableReason={unavailableReason}
      />
      {chosen !== undefined && (
        <ActionButton reason={undefined} onPress={() => run('history.choose-side')}>
          Forget side A
        </ActionButton>
      )}
    </div>
  );
}

/** Letting the history before the point go, or the branch it starts. */
function Removing({ row, run, unavailableReason }: HistoryActionsProps): ReactNode {
  const node = row.node.id;
  const planning = unavailableReason('history.plan-compaction');
  return (
    <div className="ag-history-buttons">
      <ActionButton
        tone={ButtonTone.QuietDestructive}
        reason={
          planning ?? (row.node.kind === 'origin' ? 'Nothing comes before the start.' : undefined)
        }
        onPress={() => run('history.plan-compaction', { before: node })}
      >
        Remove the history before this point…
      </ActionButton>
      {row.forkPoint !== undefined && (
        <ActionButton
          tone={ButtonTone.QuietDestructive}
          reason={planning}
          onPress={() => run('history.plan-compaction', { branch: node })}
        >
          Remove this branch…
        </ActionButton>
      )}
    </div>
  );
}

/** What an export of the point is called on its button: the file it wrote, or when it was made. */
function exportName(record: ExportRecord): string {
  const name = record.file?.fileName;
  return name === undefined ? `made ${when(record.at)}` : quoted(name);
}

/** Describing in the Inspector each export made from the point. */
function Exports({ row, run, unavailableReason }: HistoryActionsProps): ReactNode {
  if (row.exports.length === 0) return null;
  return (
    <div className="ag-history-buttons">
      {row.exports.map((record) => (
        <ActionButton
          key={record.id}
          icon="export"
          reason={unavailableReason(ExportCommand.InspectRecord)}
          onPress={() => run(ExportCommand.InspectRecord, { record: record.id })}
        >
          {`Describe the export ${exportName(record)} in the Inspector`}
        </ActionButton>
      ))}
    </div>
  );
}

/** Comparing and deleting each snapshot kept at the point. */
function Snapshots(props: HistoryActionsProps): ReactNode {
  const { row, chosen, run, unavailableReason } = props;
  return row.snapshots.map((snapshot) => (
    <div key={snapshot.id} className="ag-history-buttons">
      <ComparingWith
        source={{ kind: 'snapshot', snapshot: snapshot.id }}
        label={`the snapshot ${quoted(snapshot.name)}`}
        chosen={chosen}
        run={run}
        unavailableReason={unavailableReason}
      />
      <ActionButton
        tone={ButtonTone.QuietDestructive}
        reason={unavailableReason('history.delete-snapshot')}
        onPress={() => run('history.delete-snapshot', { snapshot: snapshot.id })}
      >
        {`Delete the snapshot ${quoted(snapshot.name)}`}
      </ActionButton>
    </div>
  ));
}

/**
 * The actions (see the module comment), as the chosen point's card: its
 * description, `details` (what the change affected), going and comparing, then
 * below a hairline the rest. Each stays in view, since the naming fields cannot
 * live in a menu and a control is never hidden to make the card shorter.
 */
export function HistoryActions(
  props: HistoryActionsProps & { readonly details: ReactNode },
): ReactNode {
  const { row, run, unavailableReason, details } = props;
  const node = row.node.id;
  return (
    <div role="group" className="ag-history-chosen" aria-label="At the chosen point">
      <h3 className="ag-history-chosen-title">{describeNode(row.node)}</h3>
      {details}
      <Moving {...props} />
      <div className="ag-history-chosen-more">
        <NamingField
          key={`fork-${node}`}
          label="Name of a new project from here"
          action="Fork from here"
          icon="fork"
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
            icon="branch"
            initial={row.branchName ?? ''}
            longest={LONGEST_HISTORY_LABEL}
            onName={(name) => run('history.name-branch', { node, name })}
            unavailable={unavailableReason('history.name-branch')}
          />
        )}
        <Exports {...props} />
        <Snapshots {...props} />
        <Removing {...props} />
      </div>
    </div>
  );
}
