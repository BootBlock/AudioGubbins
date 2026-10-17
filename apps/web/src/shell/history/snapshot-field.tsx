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

/** The fields and their button. */
export function SnapshotField({
  run,
  unavailable,
}: {
  readonly run: RunCommand;

  /** Why no snapshot can be kept now, or `undefined` where one can. */
  readonly unavailable: string | undefined;
}): ReactNode {
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
