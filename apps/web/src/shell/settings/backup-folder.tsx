/**
 * The backups folder in the backup settings: which folder on this machine each
 * backup is also copied to, whether the browser lets AudioGubbins write to it
 * now, and what became of the latest copy (REQ-STOR-105).
 *
 * The folder is this browser's on this machine, not the project's, and the
 * browser asks again after every reload before it lets a page write to a folder
 * it chose earlier, so both are said where the folder is chosen: a reader who
 * finds the copies stopped after a reload is told why and given the button that
 * asks. Where the browser has no folder to give, the section says the backups
 * stay in its own storage and can be exported from the list. Every control runs
 * a command.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';

import type { BackupFolderState } from '../../state/backup-folder-store.js';
import type { BackupState } from '../../state/backup-store.js';
import type { Observable } from '../../state/observable.js';
import { quoted } from '../../wording.js';
import { ReasonedButton } from './reasoned-button.js';
import type { RunCommand } from './section.js';

/** What the folder is for and whose it is, said wherever it can be chosen. */
const WHAT_IT_IS =
  'Each backup can also be written to a folder on this computer, such as one another program copies elsewhere. The folder belongs to this browser on this computer, not to the project, and after every reload the browser asks before AudioGubbins may write to it again.';

/** Where the browser gives no folder to write into. */
const NO_FOLDERS =
  'This browser cannot give AudioGubbins a folder to write into, so backups stay in its own storage. Export any of them from the list below to keep a copy elsewhere.';

/** What the folder's state is, in a sentence. */
function stateSentence(folder: BackupFolderState): string {
  switch (folder.kind) {
    case 'unsupported':
      return NO_FOLDERS;
    case 'looking':
      return 'Looking for the backups folder…';
    case 'none':
      return 'No backups folder is chosen, so backups stay in this browser.';
    case 'failed':
      return folder.reason;
    case 'chosen':
      switch (folder.access) {
        case 'granted':
          return `Backups are copied to ${quoted(folder.name)} where the settings above ask.`;
        case 'permission-needed':
          return `Backups are kept in this browser until you allow writing to ${quoted(folder.name)} again, which the browser asks after every reload.`;
        case 'denied':
          return `The browser refused to let AudioGubbins write to ${quoted(folder.name)}, so backups stay in its own storage. Choose the folder again to ask once more.`;
      }
  }
}

/** What became of the latest copy to the folder, where one was asked for. */
function copySentence(copied: BackupState['copied']): string | undefined {
  if (copied === undefined) return undefined;
  return copied.kind === 'written'
    ? 'The latest backup was copied to the folder.'
    : `The latest backup is kept in this browser but was not copied to the folder. ${copied.failure.summary}`;
}

/** The backups folder (see the module comment). */
export function BackupFolder({
  folder,
  backups,
  run,
  unavailableReason,
}: {
  readonly folder: Observable<BackupFolderState>;
  readonly backups: Observable<BackupState>;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  const state = useSyncExternalStore(folder.subscribe, folder.get);
  const { copied } = useSyncExternalStore(backups.subscribe, backups.get);
  const copy = copySentence(copied);
  if (state.kind === 'unsupported') {
    return (
      <section className="ag-settings-section" aria-label="Backups folder">
        <p className="ag-settings-note">{NO_FOLDERS}</p>
      </section>
    );
  }
  return (
    <section className="ag-settings-section" aria-label="Backups folder">
      <p className="ag-settings-note">{WHAT_IT_IS}</p>
      <p role="status">{stateSentence(state)}</p>
      {copy !== undefined && (
        <p {...(copied?.kind === 'failed' ? { 'data-ag-status': 'unavailable' } : {})}>{copy}</p>
      )}
      <div className="ag-settings-row">
        <ReasonedButton
          reason={unavailableReason('backup.choose-folder')}
          onPress={() => run('backup.choose-folder')}
        >
          {state.kind === 'chosen' ? 'Choose another folder…' : 'Choose a backups folder…'}
        </ReasonedButton>
        {state.kind === 'chosen' && state.access !== 'granted' && (
          <ReasonedButton
            reason={unavailableReason('backup.allow-folder')}
            onPress={() => run('backup.allow-folder')}
          >
            Allow writing to the folder
          </ReasonedButton>
        )}
        {state.kind === 'chosen' && (
          <Button onClick={() => run('backup.forget-folder')}>Stop copying to the folder</Button>
        )}
      </div>
    </section>
  );
}
