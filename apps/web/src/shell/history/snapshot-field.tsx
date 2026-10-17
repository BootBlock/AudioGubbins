/**
 * Keeping a snapshot of the state the project is in: a named point to come back
 * to, kept whole, which no retention policy takes away, with notes on it where
 * the person writes any (REQ-STOR-194).
 *
 * The name and notes typed are the fields' own until the command runs, and stay
 * where the command refuses them. They are held here rather than in the
 * section, so closing the section keeps what was typed.
 */

import { useState, type ReactNode } from 'react';

import { Button, Hint, Section, TextField } from '@audiogubbins/design-system';
import { LONGEST_HISTORY_LABEL, LONGEST_SNAPSHOT_NOTES } from '@audiogubbins/project-format';

import type { RunCommand } from '../settings/section.js';

/** The name and notes being typed, keeping them as a snapshot, and why it cannot be kept now. */
interface SnapshotDraft {
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly notes: string;
  readonly setNotes: (notes: string) => void;
  readonly keep: () => void;
  readonly reason: string | undefined;
}

/**
 * What is typed for a snapshot, kept by `history.snapshot` and cleared only
 * where the command keeps it; `unavailable` is the command's own reason.
 */
function useSnapshotDraft(run: RunCommand, unavailable: string | undefined): SnapshotDraft {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const chosen = name.trim();
  const keep = (): void => {
    const written = notes.trim() === '' ? {} : { notes };
    if (run('history.snapshot', { name: chosen, ...written })) {
      setName('');
      setNotes('');
    }
  };
  const reason = unavailable ?? (chosen === '' ? 'Type a name for the snapshot.' : undefined);
  return { name, setName, notes, setNotes, keep, reason };
}

/** The fields and their button. */
export function SnapshotField({
  run,
  unavailable,
}: {
  readonly run: RunCommand;

  /** Why no snapshot can be kept now, or `undefined` where one can. */
  readonly unavailable: string | undefined;
}): ReactNode {
  const { name, setName, notes, setNotes, keep, reason } = useSnapshotDraft(run, unavailable);
  return (
    <Section
      title="Snapshot"
      icon="take-snapshot"
      actions={
        <Hint label="About snapshots">
          A snapshot is a named point of the current state, kept until you delete it. Notes are
          optional, and are shown beside the snapshot in the history.
        </Hint>
      }
    >
      <div className="ag-history-snapshot">
        <TextField
          label="Snapshot name"
          placeholder="Name"
          value={name}
          onValueChange={setName}
          onSubmit={keep}
          maxLength={LONGEST_HISTORY_LABEL}
        />
        <TextField
          label="Notes"
          value={notes}
          onValueChange={setNotes}
          onSubmit={keep}
          maxLength={LONGEST_SNAPSHOT_NOTES}
        />
        <Button
          compact
          label="Keep a snapshot"
          {...(reason === undefined ? {} : { unavailableReason: reason })}
          onClick={keep}
        >
          Keep
        </Button>
      </div>
    </Section>
  );
}
