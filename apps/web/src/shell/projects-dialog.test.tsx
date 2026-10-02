import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectsSection } from '../state/interaction-store.js';
import { renderInTheShell } from '../testing/in-the-shell.js';
import { MemoryDirectory } from '@audiogubbins/storage/testing';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { ProjectsDialog } from './projects-dialog.js';

/** Draws the dialogue at a section over a window's stores, and what it runs. */
function dialogueAt(
  window: ProjectWindow,
  section: ProjectsSection,
  unavailableReason: (id: string) => string | undefined = () => undefined,
) {
  const run = vi.fn((_id: string, _args?: unknown) => true);
  renderInTheShell(
    <ProjectsDialog
      section={section}
      projects={window.projects}
      run={run}
      unavailableReason={unavailableReason}
    />,
  );
  return { run, dialogue: screen.getByRole('dialog', { name: 'Projects' }) };
}

/** A window with two projects kept, one open and one deleted. */
async function withProjects(): Promise<ProjectWindow> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Old tide' });
  await window.runAndHear('file.delete-project');
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  return window;
}

describe('the Projects dialogue', () => {
  it('shows the section asked for, and moves between sections and closes by command', async () => {
    const { run, dialogue } = dialogueAt(await projectWorld().window(), 'new');

    expect(within(dialogue).getByRole('tab', { name: 'New' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(within(dialogue).getByRole('tab', { name: 'Import' }));
    expect(run).toHaveBeenCalledWith('file.projects', { section: 'import' });
    await userEvent.keyboard('{Escape}');
    expect(run).toHaveBeenLastCalledWith('file.close-projects');
  });

  it('makes a project with the name typed and the settings chosen, and says why it waits without one', async () => {
    const { run, dialogue } = dialogueAt(await projectWorld().window(), 'new');

    const make = within(dialogue).getByRole('button', { name: 'Make the project' });
    expect(make).toHaveAttribute('aria-disabled', 'true');
    expect(make).toHaveAccessibleDescription('Type a name for the new project.');
    await userEvent.click(make);
    expect(run).not.toHaveBeenCalled();

    await userEvent.type(
      within(dialogue).getByRole('textbox', { name: 'Name' }),
      'Forest walk{Enter}',
    );
    expect(run).toHaveBeenCalledWith('file.create-project', {
      name: 'Forest walk',
      sampleRate: 48_000,
      channels: 'stereo',
    });
  });

  it('lists the projects kept, marks the one open, and opens one to change or to read', async () => {
    const window = await withProjects();
    const { run, dialogue } = dialogueAt(window, 'open');

    const list = within(dialogue).getByRole('list', { name: 'Projects' });
    const row = within(list).getByText('Harbour').closest('li');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(within(row ?? dialogue).getByText('Open now')).toBeVisible();

    await userEvent.click(within(list).getByRole('button', { name: 'Open "Harbour"' }));
    await userEvent.click(within(list).getByRole('button', { name: 'Open "Harbour" to read' }));
    const [entry] = window.projects.library
      .get()
      .entries.flatMap((one) =>
        one.kind === 'project' && one.header.name === 'Harbour' ? [one] : [],
      );
    const project = entry?.header.id;
    expect(run.mock.calls).toEqual([
      ['file.open', { project }],
      ['file.open', { project, access: 'read' }],
    ]);
  });

  it('restores a deleted project, and purges one only from its confirmation', async () => {
    const window = await withProjects();
    const { run, dialogue } = dialogueAt(window, 'open');
    const deleted = within(dialogue).getByRole('group', { name: 'Deleted projects' });
    const header = window.projects.library
      .get()
      .entries.flatMap((one) =>
        one.kind === 'project' && one.header.deleted !== undefined ? [one.header] : [],
      )[0];

    await userEvent.click(within(deleted).getByRole('button', { name: 'Restore "Old tide"' }));
    expect(run).toHaveBeenLastCalledWith('file.restore-project', { project: header?.id });

    await userEvent.click(within(deleted).getByRole('button', { name: 'Purge "Old tide"…' }));
    expect(
      within(deleted).getByText('Purging removes "Old tide" and its backups for good.'),
    ).toBeVisible();
    expect(run).toHaveBeenCalledTimes(1);
    await userEvent.click(within(deleted).getByRole('button', { name: 'Purge for good' }));
    expect(run).toHaveBeenLastCalledWith('file.purge-project', {
      project: header?.id,
      deletedAt: header?.deleted,
    });
  });

  it('renames, forks and exports the open project as chosen, each by its command', async () => {
    const window = await withProjects();
    const { run, dialogue } = dialogueAt(window, 'current', (id) =>
      id === 'file.export-folder'
        ? 'This browser cannot give AudioGubbins a folder to write into.'
        : undefined,
    );

    const name = within(dialogue).getByRole('textbox', { name: 'Project name' });
    expect(name).toHaveValue('Harbour');
    await userEvent.clear(name);
    await userEvent.type(name, 'Harbour at dusk');
    await userEvent.click(within(dialogue).getByRole('button', { name: 'Rename' }));
    expect(run).toHaveBeenLastCalledWith('file.rename-project', { name: 'Harbour at dusk' });

    await userEvent.click(within(dialogue).getByRole('button', { name: 'Fork from here' }));
    expect(run).toHaveBeenLastCalledWith('file.fork-project', { name: 'Harbour (fork)' });

    await userEvent.click(within(dialogue).getByRole('switch', { name: 'Include caches' }));
    await userEvent.click(within(dialogue).getByRole('button', { name: 'Export as a bundle…' }));
    expect(run).toHaveBeenLastCalledWith('file.export-bundle', {
      scope: 'whole-history',
      provenance: 'full',
      caches: true,
    });
    expect(
      within(dialogue).getByRole('button', { name: 'Export to a folder…' }),
    ).toHaveAccessibleDescription('This browser cannot give AudioGubbins a folder to write into.');
  });

  it('offers every level of where the audio came from for a whole history, saying what it keeps', async () => {
    const { run, dialogue } = dialogueAt(await withProjects(), 'current');
    const level = within(dialogue).getByRole('combobox', { name: 'Where the audio came from' });
    const user = userEvent.setup();

    expect(level).toBeEnabled();
    level.focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Keep all of it',
      'Leave out names and places',
      'Leave it all out',
    ]);
    await user.click(screen.getByRole('option', { name: 'Leave it all out' }));
    expect(within(dialogue).getByText(/Leaves out how each file came in/u)).toBeVisible();
    expect(within(dialogue).getByText(/so undo and redo still work/u)).toBeVisible();
    await user.click(within(dialogue).getByRole('button', { name: 'Export as a bundle…' }));
    expect(run).toHaveBeenLastCalledWith('file.export-bundle', {
      scope: 'whole-history',
      provenance: 'none',
      caches: false,
    });
  });

  it('shows what each level keeps of where the audio came from for the state alone', async () => {
    const { run, dialogue } = dialogueAt(await withProjects(), 'current');
    const level = within(dialogue).getByRole('combobox', { name: 'Where the audio came from' });

    const user = userEvent.setup();
    within(dialogue).getByRole('combobox', { name: 'What to include' }).focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('option', { name: 'The current state alone' }));
    level.focus();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Keep all of it',
      'Leave out names and places',
      'Leave it all out',
    ]);
    await user.click(screen.getByRole('option', { name: 'Leave out names and places' }));
    expect(within(dialogue).getByText(/Leaves out the names and folders of files/u)).toBeVisible();
    expect(within(dialogue).queryByText(/so undo and redo still work/u)).toBeNull();
    await user.click(within(dialogue).getByRole('button', { name: 'Export as a bundle…' }));
    expect(run).toHaveBeenLastCalledWith('file.export-bundle', {
      scope: 'current-state',
      provenance: 'minimal',
      caches: false,
    });
  });

  it('says there is nothing to do with a project where none is open', async () => {
    const { dialogue } = dialogueAt(await projectWorld().window(), 'current');

    expect(within(dialogue).getByText('No project is open.')).toBeVisible();
  });

  it('brings a project in from a bundle or a folder, each by its command', async () => {
    const { run, dialogue } = dialogueAt(await projectWorld().window(), 'import');

    await userEvent.click(within(dialogue).getByRole('button', { name: 'Import a bundle…' }));
    await userEvent.click(within(dialogue).getByRole('button', { name: 'Import a folder…' }));
    expect(run.mock.calls).toEqual([['file.import-bundle'], ['file.import-folder']]);
  });

  it('puts a folder holding another project to the person before writing over it', async () => {
    const window = await withProjects();
    const folder = new MemoryDirectory();
    const other = await projectWorld().window();
    await other.runAndHear('file.create-project', { name: 'Quay' });
    other.files.foldersToWrite.push(folder);
    await other.runAndHear('file.export-folder');
    window.files.foldersToWrite.push(folder);
    await window.runAndHear('file.export-folder');
    const { run, dialogue } = dialogueAt(window, 'current');

    const question = within(dialogue).getByRole('group', {
      name: 'The folder holds another project',
    });
    expect(question).toHaveTextContent(
      'The folder holds another project, "Quay". Replacing it deletes its files from the folder.',
    );
    await userEvent.click(within(question).getByRole('button', { name: 'Replace its files' }));
    await userEvent.click(
      within(question).getByRole('button', { name: 'Keep the folder as it is' }),
    );
    expect(run.mock.calls).toEqual([['file.export-folder-replace'], ['file.export-folder-keep']]);
  });
});
