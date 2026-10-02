/**
 * Keeping a snapshot of the state the project is in: a named point to come back
 * to, kept whole, which no retention policy takes away, with notes on it where
 * the person writes any (REQ-STOR-194).
 *
 * The name and notes typed are the fields' own until the command runs, and stay
 * where the command refuses them.
 */

import { useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import { LONGEST_HISTORY_LABEL, LONGEST_SNAPSHOT_NOTES } from '@audiogubbins/project-format';

import { ReasonedButton } from '../settings/reasoned-button.js';
import type { RunCommand } from '../settings/section.js';

/** The field and its button. */
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
  return (
    <div className="ag-settings-row">
      <TextField
        label="Snapshot name"
        description="A named point of the current state, kept until you delete it."
        value={name}
        onValueChange={setName}
        onSubmit={keep}
        maxLength={LONGEST_HISTORY_LABEL}
      />
      <TextField
        label="Notes"
        description="Optional. Shown beside the snapshot in the history."
        value={notes}
        onValueChange={setNotes}
        onSubmit={keep}
        maxLength={LONGEST_SNAPSHOT_NOTES}
      />
      <ReasonedButton
        reason={unavailable ?? (chosen === '' ? 'Type a name for the snapshot.' : undefined)}
        onPress={keep}
      >
        Keep a snapshot
      </ReasonedButton>
    </div>
  );
}
