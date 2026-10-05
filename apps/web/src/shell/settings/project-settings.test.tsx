import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { projectWorld, type ProjectWindow } from '../../testing/project-context.js';
import { ScriptedFolderPort } from '../../testing/scripted-folder.js';
import { Backups } from './backups.js';
import { ProjectSettings } from './projects.js';

/** What a settings section runs. */
function recorder() {
  return vi.fn((_id: string, _args?: unknown) => true);
}

/** A window with a project open, and a backup made of it. */
async function withBackup(): Promise<ProjectWindow> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  await window.runAndHear('file.back-up-now');
  return window;
}

describe('the project settings', () => {
  it('explains what bringing a file in costs, and chooses by command', async () => {
    const window = await projectWorld().window();
    const run = recorder();
    render(<ProjectSettings projects={window.projects} run={run} />);

    expect(screen.getByText(/A copy is kept with the project/)).toBeVisible();
    // From the keyboard: the list opens on the choice in force, and the next is
    // the other.
    screen.getByRole('combobox', { name: 'Bring files in by' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: 'Linking to them where they are' })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(run).toHaveBeenCalledWith('settings.source-handling', { handling: 'link' });
  });

  it('asks for the history to be kept only once a project is open', async () => {
    const window = await projectWorld().window();
    render(<ProjectSettings projects={window.projects} run={recorder()} />);

    expect(
      screen.getByText('Open a project to set how much of its history is kept.'),
    ).toBeVisible();
  });

  it('plans how much history is kept before it is set, and shows what that removes', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const run = recorder();
    render(<ProjectSettings projects={window.projects} run={run} />);

    screen.getByRole('combobox', { name: 'Keep' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: 'The most recent changes' })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await userEvent.type(screen.getByRole('textbox', { name: 'Changes' }), '20');
    expect(
      screen.getByText(/^Once applied, history past this limit goes on its own as you work\./u),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Show what this keeps' }));
    expect(run).toHaveBeenLastCalledWith('history.plan-retention', {
      kind: 'recent-changes',
      value: 20,
    });
  });
});

describe('the backup settings', () => {
  it('sets when backups are made from the numbers typed', async () => {
    const window = await withBackup();
    const run = recorder();
    render(<Backups projects={window.projects} run={run} unavailableReason={() => undefined} />);

    const minutes = screen.getByRole('textbox', { name: 'After this many minutes of work' });
    expect(minutes).toHaveValue('30');
    await userEvent.type(screen.getByRole('textbox', { name: 'After this many changes' }), '50');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Keep as many as fit in this many MB' }),
      '512',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save the backup settings' }));
    expect(run).toHaveBeenLastCalledWith('backup.set-policy', {
      kind: 'automatic',
      everyMinutes: 30,
      everyChanges: 50,
      keepCount: 10,
      keepDays: 0,
      keepBytes: 512 * 2 ** 20,
      external: false,
    });
  });

  it('shows the size a policy keeps backups within, in megabytes', async () => {
    const window = await withBackup();
    expect(
      await window.runAndHear('backup.set-policy', {
        kind: 'automatic',
        everyMinutes: 30,
        keepBytes: 3 * 2 ** 20,
      }),
    ).toBe('Backups are made on their own as you set.');
    render(
      <Backups projects={window.projects} run={recorder()} unavailableReason={() => undefined} />,
    );

    expect(
      screen.getByRole('textbox', { name: 'Keep as many as fit in this many MB' }),
    ).toHaveValue('3');
  });

  it('lists each backup kept, and restores in place only from its confirmation', async () => {
    const window = await withBackup();
    const [generation] = window.projects.backups.get().generations;
    const run = recorder();
    render(<Backups projects={window.projects} run={run} unavailableReason={() => undefined} />);

    const list = screen.getByRole('list', { name: 'Backups' });
    expect(within(list).getByText(/made by hand, .*, kept until you let it go/)).toBeVisible();

    await userEvent.click(within(list).getByRole('button', { name: /as a new project$/ }));
    expect(run).toHaveBeenLastCalledWith('backup.restore', {
      generation: generation?.number,
      as: 'new-project',
    });
    await userEvent.click(within(list).getByRole('button', { name: /in place…$/ }));
    expect(within(list).getByText(/Undo cannot reverse this\./)).toBeVisible();
    await userEvent.click(within(list).getByRole('button', { name: 'Restore in place' }));
    expect(run).toHaveBeenLastCalledWith('backup.restore', {
      generation: generation?.number,
      as: 'replace-current',
    });
  });

  it('deletes a backup only from its confirmation, and says a let-go one is kept no longer', async () => {
    const window = await withBackup();
    const [generation] = window.projects.backups.get().generations;
    await window.runAndHear('backup.protect', { generation: generation?.number ?? 0, keep: false });
    const run = recorder();
    render(<Backups projects={window.projects} run={run} unavailableReason={() => undefined} />);

    const list = screen.getByRole('list', { name: 'Backups' });
    expect(within(list).queryByText(/kept until you let it go/)).toBeNull();
    expect(within(list).getByRole('button', { name: /^Keep the backup of / })).toBeVisible();
    await userEvent.click(within(list).getByRole('button', { name: /^Delete the backup of .*…$/ }));
    expect(run).not.toHaveBeenCalled();
    expect(within(list).getByText(/cannot be brought back/)).toBeVisible();
    await userEvent.click(within(list).getByRole('button', { name: 'Delete' }));
    expect(run).toHaveBeenLastCalledWith('backup.delete', { generation: generation?.number });
  });

  it('exports a backup, and keeps or lets one go, each by its command', async () => {
    const window = await withBackup();
    const [generation] = window.projects.backups.get().generations;
    const run = recorder();
    render(<Backups projects={window.projects} run={run} unavailableReason={() => undefined} />);

    const list = screen.getByRole('list', { name: 'Backups' });
    await userEvent.click(within(list).getByRole('button', { name: /^Export the backup of / }));
    await userEvent.click(within(list).getByRole('button', { name: /^Let the backup of .* go$/ }));
    expect(run.mock.calls).toEqual([
      ['backup.export', { generation: generation?.number }],
      ['backup.protect', { generation: generation?.number, keep: false }],
    ]);
  });

  it('asks for a project to be open first', async () => {
    const window = await projectWorld().window();
    render(
      <Backups projects={window.projects} run={recorder()} unavailableReason={() => undefined} />,
    );

    expect(screen.getByText('Open a project to set how it is backed up.')).toBeVisible();
  });
});

describe('the backups folder in the backup settings (REQ-STOR-105)', () => {
  it('explains the folder is this machine’s, asks for leave after a reload, and copies by the policy', async () => {
    const window = await projectWorld().window({ backupFolder: new ScriptedFolderPort() });
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const run = recorder();
    render(<Backups projects={window.projects} run={run} unavailableReason={() => undefined} />);

    const folder = screen.getByRole('region', { name: 'Backups folder' });
    expect(within(folder).getByText(/belongs to this browser on this computer/u)).toBeVisible();
    expect(within(folder).getByText(/until you allow writing to “Backups” again/u)).toBeVisible();
    await userEvent.click(
      within(folder).getByRole('button', { name: 'Allow writing to the folder' }),
    );
    expect(run).toHaveBeenLastCalledWith('backup.allow-folder');
    await userEvent.click(within(folder).getByRole('button', { name: 'Choose another folder…' }));
    expect(run).toHaveBeenLastCalledWith('backup.choose-folder');

    await userEvent.click(
      screen.getByRole('switch', { name: 'Also copy each backup to the backups folder' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save the backup settings' }));
    expect(run).toHaveBeenLastCalledWith(
      'backup.set-policy',
      expect.objectContaining({ kind: 'automatic', external: true }),
    );
  });

  it('says backups stay in the browser where it gives no folder, and offers no copy', async () => {
    const window = await withBackup();
    render(
      <Backups projects={window.projects} run={recorder()} unavailableReason={() => undefined} />,
    );

    expect(screen.getByText(/cannot give AudioGubbins a folder to write into/u)).toBeVisible();
    expect(
      screen.queryByRole('switch', { name: 'Also copy each backup to the backups folder' }),
    ).toBeNull();
  });
});
