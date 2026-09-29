/**
 * The open project's backups: when they are made on their own and how many are
 * kept, making one now, and every one kept, to restore as a new project or in
 * place of the project (REQ-STOR-105, REQ-STOR-106, REQ-STOR-198).
 *
 * Restoring in place replaces the project, history and all, which undo cannot
 * reverse, so it asks a second time and says the project as it is now is kept
 * as a backup first. A backup made by hand is kept until it is let go; the
 * others go as the policy says. Every control runs a command.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone, OptionSelect, TextField } from '@audiogubbins/design-system';
import type { BackupPolicy } from '@audiogubbins/project-format';
import type { BackupGeneration } from '@audiogubbins/storage';

import type { BackupState } from '../../state/backup-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import { describeBytes } from '../../wording.js';
import { ReasonedButton } from './reasoned-button.js';
import type { RunCommand } from './section.js';

/** How a time is written in the list. */
const WHEN = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** Why each backup was made. */
const REASONS: Readonly<Record<BackupGeneration['reason'], string>> = {
  manual: 'made by hand',
  time: 'made after a spell of work',
  save: 'made after a number of changes',
};

/** The policy's numbers as the form holds them, a blank for one not set. */
interface PolicyForm {
  readonly kind: string;
  readonly everyMinutes: string;
  readonly everyChanges: string;
  readonly keepCount: string;
  readonly keepDays: string;
}

/** The form a policy starts it from. */
function formOf(policy: BackupPolicy): PolicyForm {
  if (policy.kind === 'off') {
    return { kind: 'off', everyMinutes: '', everyChanges: '', keepCount: '', keepDays: '' };
  }
  const text = (value: number | undefined): string => (value === undefined ? '' : String(value));
  return {
    kind: 'automatic',
    everyMinutes: text(policy.trigger.everyMinutes),
    everyChanges: text(policy.trigger.everyChanges),
    keepCount: text(policy.retention.count),
    keepDays: text(policy.retention.days),
  };
}

/** The fields of the form, and what each is called. */
const FIELDS = [
  ['everyMinutes', 'After this many minutes of work'],
  ['everyChanges', 'After this many changes'],
  ['keepCount', 'Keep the newest'],
  ['keepDays', 'Keep those from the last days'],
] as const;

/** When backups are made, and how many are kept. */
function PolicyFormView({
  policy,
  run,
}: {
  readonly policy: BackupPolicy;
  readonly run: RunCommand;
}): ReactNode {
  const [form, setForm] = useState(formOf(policy));
  const numbers = Object.fromEntries(FIELDS.map(([field]) => [field, Number(form[field])]));
  return (
    <div className="ag-settings-section">
      <OptionSelect
        label="Back the project up"
        value={form.kind}
        options={[
          { value: 'automatic', label: 'On its own, as set below' },
          { value: 'off', label: 'Only when I ask' },
        ]}
        onValueChange={(kind) => {
          setForm({ ...form, kind });
        }}
      />
      {form.kind === 'automatic' && (
        <div className="ag-settings-row">
          {FIELDS.map(([field, label]) => (
            <TextField
              key={field}
              label={label}
              value={form[field]}
              onValueChange={(typed) => {
                setForm({ ...form, [field]: typed });
              }}
            />
          ))}
        </div>
      )}
      <Button onClick={() => run('backup.set-policy', { kind: form.kind, ...numbers })}>
        Save the backup settings
      </Button>
    </div>
  );
}

/** Restoring a backup in place, once the person has read that undo cannot reverse it. */
function RestoreConfirmation({
  generation,
  when,
  onCancel,
  run,
}: {
  readonly generation: BackupGeneration;
  readonly when: string;
  readonly onCancel: () => void;
  readonly run: RunCommand;
}): ReactNode {
  return (
    <span
      className="ag-project-row-actions"
      role="group"
      aria-label={`Restore the backup of ${when} in place`}
    >
      <span data-ag-status="unavailable">
        Undo cannot reverse this. The project as it is now is kept as a backup first.
      </span>
      <Button
        compact
        tone={ButtonTone.Destructive}
        onClick={() =>
          run('backup.restore', { generation: generation.number, as: 'replace-current' })
        }
      >
        Restore in place
      </Button>
      <Button compact onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

/** What can be done with a backup: restore it either way, take it out, keep it or let it go. */
function GenerationActions({
  generation,
  when,
  onRestoreInPlace,
  run,
}: {
  readonly generation: BackupGeneration;
  readonly when: string;
  readonly onRestoreInPlace: () => void;
  readonly run: RunCommand;
}): ReactNode {
  const { number } = generation;
  return (
    <span className="ag-project-row-actions">
      <Button
        compact
        label={`Restore the backup of ${when} as a new project`}
        onClick={() => run('backup.restore', { generation: number, as: 'new-project' })}
      >
        Restore as a new project
      </Button>
      <Button compact label={`Restore the backup of ${when} in place…`} onClick={onRestoreInPlace}>
        Restore in place…
      </Button>
      <Button
        compact
        label={`Export the backup of ${when}…`}
        onClick={() => run('backup.export', { generation: number })}
      >
        Export…
      </Button>
      <Button
        compact
        onClick={() => run('backup.protect', { generation: number, keep: !generation.protected })}
      >
        {generation.protected ? 'Let it go' : 'Keep it'}
      </Button>
    </span>
  );
}

/** One backup kept, and what can be done with it. */
function GenerationRow({
  generation,
  run,
}: {
  readonly generation: BackupGeneration;
  readonly run: RunCommand;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const when = WHEN.format(generation.at);
  const kept = generation.protected || generation.reason === 'manual';
  return (
    <li className="ag-project-row">
      <span className="ag-project-row-name">{when}</span>
      <span className="ag-project-row-note">
        {`${REASONS[generation.reason]}, ${describeBytes(generation.bytes)}${kept ? ', kept until you let it go' : ''}`}
      </span>
      {confirming ? (
        <RestoreConfirmation
          generation={generation}
          when={when}
          onCancel={() => {
            setConfirming(false);
          }}
          run={run}
        />
      ) : (
        <GenerationActions
          generation={generation}
          when={when}
          onRestoreInPlace={() => {
            setConfirming(true);
          }}
          run={run}
        />
      )}
    </li>
  );
}

/** The backup settings (see the module comment). */
export function Backups({
  projects,
  run,
  unavailableReason,
}: {
  readonly projects: {
    readonly project: Observable<OpenProjectState>;
    readonly backups: Observable<BackupState>;
  };
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  const open = useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const backups = useSyncExternalStore(projects.backups.subscribe, projects.backups.get);
  if (open.kind !== 'open')
    return <p className="ag-settings-note">Open a project to set how it is backed up.</p>;
  return (
    <div className="ag-settings-section">
      <PolicyFormView key={open.snapshot.project} policy={open.snapshot.model.backup} run={run} />
      <ReasonedButton
        reason={unavailableReason('file.back-up-now')}
        onPress={() => run('file.back-up-now')}
      >
        Back up now
      </ReasonedButton>
      {backups.working !== undefined && (
        <p role="status">{backups.working === 'restoring' ? 'Restoring…' : 'Backing up…'}</p>
      )}
      {backups.problem !== undefined && <p data-ag-status="unavailable">{backups.problem}</p>}
      {backups.generations.length === 0 ? (
        <p>No backup of this project is kept yet.</p>
      ) : (
        <ul className="ag-project-list" aria-label="Backups">
          {backups.generations.map((generation) => (
            <GenerationRow key={generation.number} generation={generation} run={run} />
          ))}
        </ul>
      )}
    </div>
  );
}
