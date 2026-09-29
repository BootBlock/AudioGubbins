/**
 * The open project's backups: when they are made on their own and how many are
 * kept, making one now, and every one kept, to restore as a new project or in
 * place of the project (REQ-STOR-105, REQ-STOR-106, REQ-STOR-198).
 *
 * Restoring in place replaces the project, history and all, which undo cannot
 * reverse, so it asks a second time and says the project as it is now is kept
 * as a backup first. A backup made by hand is kept until it is let go; the
 * others go as the policy says. Where the browser gives a folder to write into,
 * a backup can be copied to one as well (`backup-folder.tsx`). Every control
 * runs a command.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import type { BackupGeneration } from '@audiogubbins/storage';

import type { BackupFolderState } from '../../state/backup-folder-store.js';
import type { BackupState } from '../../state/backup-store.js';
import type { Observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import { describeBytes } from '../../wording.js';
import { BackupFolder } from './backup-folder.js';
import { PolicyFormView } from './backup-policy-form.js';
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
    readonly backupFolder: Observable<BackupFolderState>;
  };
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  const open = useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const backups = useSyncExternalStore(projects.backups.subscribe, projects.backups.get);
  const folder = useSyncExternalStore(projects.backupFolder.subscribe, projects.backupFolder.get);
  const chooser = (
    <BackupFolder
      folder={projects.backupFolder}
      backups={projects.backups}
      run={run}
      unavailableReason={unavailableReason}
    />
  );
  if (open.kind !== 'open') {
    return (
      <div className="ag-settings-section">
        <p className="ag-settings-note">Open a project to set how it is backed up.</p>
        {chooser}
      </div>
    );
  }
  return (
    <div className="ag-settings-section">
      <PolicyFormView
        key={open.snapshot.project}
        policy={open.snapshot.model.backup}
        canCopyOut={folder.kind !== 'unsupported'}
        run={run}
      />
      {chooser}
      <ReasonedButton
        reason={unavailableReason('file.back-up-now')}
        onPress={() => run('file.back-up-now')}
      >
        Back up now
      </ReasonedButton>
      <GenerationList backups={backups} run={run} />
    </div>
  );
}

/** Every backup kept, and what is being done with them. */
function GenerationList({
  backups,
  run,
}: {
  readonly backups: BackupState;
  readonly run: RunCommand;
}): ReactNode {
  return (
    <>
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
    </>
  );
}
