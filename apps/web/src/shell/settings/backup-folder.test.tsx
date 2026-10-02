import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { projectWorld } from '../../testing/project-context.js';
import { ScriptedFolderPort } from '../../testing/scripted-folder.js';
import { BackupFolder } from './backup-folder.js';

describe('the backups folder in the settings', () => {
  it('says why a backup was not copied to the folder in words of the folder, not of a save', async () => {
    // Chosen before the reload, so leave to write to it is wanted again.
    const window = await projectWorld().window({ backupFolder: new ScriptedFolderPort() });
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    await window.runAndHear('backup.set-policy', {
      kind: 'automatic',
      everyMinutes: 30,
      external: true,
    });
    const { backupFolder, backups } = window.projects;
    render(
      <BackupFolder
        folder={backupFolder}
        backups={backups}
        run={vi.fn()}
        unavailableReason={() => undefined}
      />,
    );

    await act(async () => {
      await window.runAndHear('file.back-up-now');
    });

    expect(
      screen.getByText(
        'The latest backup is kept in this browser but was not copied to the folder. The folder cannot be written now: leave to write to it has not been given since the page loaded, or it is no longer there.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/kept in memory/u)).toBeNull();
  });
});
