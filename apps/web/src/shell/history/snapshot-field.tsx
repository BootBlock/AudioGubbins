/**
 * Keeping a snapshot of the state the project is in: a named point to come back
 * to, kept whole, which no retention policy takes away (REQ-STOR-194).
 *
 * The name typed is the field's own until the command runs, and stays where the
 * command refuses it.
 */

import { useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import { LONGEST_HISTORY_LABEL } from '@audiogubbins/project-format';

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
  const chosen = name.trim();
  const keep = (): void => {
    if (run('history.snapshot', { name: chosen })) setName('');
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
      <ReasonedButton
        reason={unavailable ?? (chosen === '' ? 'Type a name for the snapshot.' : undefined)}
        onPress={keep}
      >
        Keep a snapshot
      </ReasonedButton>
    </div>
  );
}
