/**
 * The open project's backups: when they are made on their own and how many are
 * kept, making one now, and every one kept, to restore as a new project or in
 * place of the project (REQ-STOR-105, REQ-STOR-106, REQ-STOR-198).
 *
 * Restoring in place replaces the project, history and all, which undo cannot
 * reverse, so it asks a second time and says the project as it is now is kept
 * as a backup first. Deleting a backup asks a second time too. A backup made by
 * hand is kept until it is let go, and then goes as the policy says, as the
 * others do. Where the browser gives a folder to write into, a backup can be
 * copied to one as well (`backup-folder.tsx`). Every control runs a command.
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

/** What a row asks a second time before doing. */
type Confirming = 'restore-in-place' | 'delete';

/** The words and the command of each thing a row confirms. */
const CONFIRMATIONS: Readonly<
  Record<
    Confirming,
    {
      readonly group: string;
      readonly warning: string;
      readonly action: string;
      readonly command: string;
      readonly arguments: Readonly<Record<string, string>>;
    }
  >
> = {
  'restore-in-place': {
    group: 'Restore the backup of %s in place',
    warning: 'Undo cannot reverse this. The project as it is now is kept as a backup first.',
    action: 'Restore in place',
    command: 'backup.restore',
    arguments: { as: 'replace-current' },
  },
  delete: {
    group: 'Delete the backup of %s',
    warning: 'The backup cannot be brought back once it is deleted.',
    action: 'Delete',
    command: 'backup.delete',
    arguments: {},
  },
};

/** A destructive action on a backup, once the person has read what it cannot undo. */
function Confirmation({
  confirming,
  generation,
  when,
  onCancel,
  run,
}: {
  readonly confirming: Confirming;
  readonly generation: BackupGeneration;
  readonly when: string;
  readonly onCancel: () => void;
  readonly run: RunCommand;
}): ReactNode {
  const words = CONFIRMATIONS[confirming];
  return (
    <span
      className="ag-project-row-actions"
      role="group"
      aria-label={words.group.replace('%s', when)}
    >
      <span data-ag-status="unavailable">{words.warning}</span>
      <Button
        compact
        tone={ButtonTone.Destructive}
        onClick={() => run(words.command, { ...words.arguments, generation: generation.number })}
      >
        {words.action}
      </Button>
      <Button compact onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

/**
 * What can be done with a backup: restore it either way, take it out, keep it
 * or let it go, or delete it.
 */
function GenerationActions({
  generation,
  when,
  onConfirm,
  run,
}: {
  readonly generation: BackupGeneration;
  readonly when: string;
  readonly onConfirm: (confirming: Confirming) => void;
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
      <Button
        compact
        label={`Restore the backup of ${when} in place…`}
        onClick={() => {
          onConfirm('restore-in-place');
        }}
      >
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
        label={generation.protected ? `Let the backup of ${when} go` : `Keep the backup of ${when}`}
        onClick={() => run('backup.protect', { generation: number, keep: !generation.protected })}
      >
        {generation.protected ? 'Let it go' : 'Keep it'}
      </Button>
      <Button
        compact
        label={`Delete the backup of ${when}…`}
        onClick={() => {
          onConfirm('delete');
        }}
      >
        Delete…
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
  const [confirming, setConfirming] = useState<Confirming | undefined>(undefined);
  const when = WHEN.format(generation.at);
  const kept = generation.protected;
  return (
    <li className="ag-project-row">
      <span className="ag-project-row-name">{when}</span>
      <span className="ag-project-row-note">
        {`${REASONS[generation.reason]}, ${describeBytes(generation.bytes)}${kept ? ', kept until you let it go' : ''}`}
      </span>
      {confirming === undefined ? (
        <GenerationActions
          generation={generation}
          when={when}
          onConfirm={setConfirming}
          run={run}
        />
      ) : (
        <Confirmation
          confirming={confirming}
          generation={generation}
          when={when}
          onCancel={() => {
            setConfirming(undefined);
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
