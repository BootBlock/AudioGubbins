import { describe, expect, it } from 'vitest';

import { olderStorage, projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** The name of the project open in a window, or nothing where none is. */
function openName(window: ProjectWindow): string | undefined {
  const open = window.projects.project.get();
  return open.kind === 'open' ? open.snapshot.model.state.project.displayName : undefined;
}

/** The headers the window's list holds. */
function headers(window: ProjectWindow) {
  return window.projects.library
    .get()
    .entries.flatMap((entry) => (entry.kind === 'project' ? [entry.header] : []));
}

/** Makes a project named `name` in a window, and waits until it is open. */
async function made(window: ProjectWindow, name: string): Promise<void> {
  expect(await window.runAndHear('file.create-project', { name })).toBe(
    `"${name}" is made and open.`,
  );
}

describe('the Projects dialogue', () => {
  it('opens at the section named, and at the list where none is', async () => {
    const window = await projectWorld().window();

    window.run('file.projects', { section: 'new' });
    expect(window.context.interaction.get().projectsSection).toBe('new');

    window.run('file.projects');
    expect(window.context.interaction.get().projectsSection).toBe('open');

    expect(window.run('file.projects', { section: 'elsewhere' }).kind).toBe('refused');
    window.run('file.close-projects');
    expect(window.context.interaction.get().projectsSection).toBeUndefined();
    expect(window.run('file.close-projects').kind).toBe('refused');
  });

  it('cannot be opened while the stored projects are of another version', async () => {
    const window = await projectWorld(await olderStorage()).window();

    expect(window.run('file.projects')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: expect.stringMatching(/made by another version/) }],
    });
  });
});

describe('making, opening and closing a project', () => {
  it('makes a project at the settings asked for, opens it, and shuts the dialogue', async () => {
    const window = await projectWorld().window();
    window.run('file.projects', { section: 'new' });

    expect(
      await window.runAndHear('file.create-project', {
        name: '  Forest walk  ',
        sampleRate: 44_100,
        channels: 'mono',
      }),
    ).toBe('"Forest walk" is made and open.');

    const open = window.projects.project.get();
    expect(open.kind === 'open' && open.snapshot.access.kind).toBe('writable');
    const settings = open.kind === 'open' ? open.snapshot.model.state.project.settings : undefined;
    expect(settings?.sampleRate).toBe(44_100);
    expect(settings?.channelLayout.roles).toHaveLength(1);
    expect(window.context.interaction.get().projectsSection).toBeUndefined();
    expect(headers(window).map((header) => header.name)).toEqual(['Forest walk']);
    expect(window.projects.preferences.get().lastProject).toBe(
      open.kind === 'open' ? open.snapshot.project : undefined,
    );
  });

  it('refuses a project with no name, or at a sample rate no project can have, before making anything', async () => {
    const window = await projectWorld().window();

    expect(window.run('file.create-project', { name: '   ' })).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Type a name for the new project.' }],
    });
    expect(window.run('file.create-project', { name: 'Loud', sampleRate: 3 }).kind).toBe('refused');
    expect(headers(window)).toEqual([]);
  });

  it('closes the project, forgets it as the one to open next time, and opens it again by name', async () => {
    const window = await projectWorld().window();
    await made(window, 'Harbour');
    const [header] = headers(window);

    expect(await window.runAndHear('file.close-project')).toBe('The project is closed.');
    expect(window.projects.project.get().kind).toBe('none');
    expect(window.projects.preferences.get().lastProject).toBeUndefined();
    expect(window.run('file.close-project').kind).toBe('refused');

    expect(await window.runAndHear('file.open', { project: header?.id ?? '' })).toBe(
      '"Harbour" is open.',
    );
    expect(openName(window)).toBe('Harbour');
    expect(
      await window.runAndHear('file.open', { project: header?.id ?? '', access: 'read' }),
    ).toBe('"Harbour" is open to read.');
  });

  it('refuses to open a project the argument does not name', async () => {
    const window = await projectWorld().window();

    expect(window.run('file.open').kind).toBe('refused');
    expect(window.run('file.open', { project: 'not an identifier' })).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'There is no such project.' }],
    });
  });
});

describe('renaming and forking the open project', () => {
  it('renames through the session, as a change undo reverses', async () => {
    const window = await projectWorld().window();
    await made(window, 'Harbour');

    expect(await window.runAndHear('file.rename-project', { name: 'Harbour at dusk' })).toBe(
      'The project is now called "Harbour at dusk".',
    );
    expect(openName(window)).toBe('Harbour at dusk');
    expect(await window.runAndHear('file.rename-project', { name: 'Harbour at dusk' })).toMatch(
      /already/,
    );

    await window.runAndHear('edit.undo');
    expect(openName(window)).toBe('Harbour');
  });

  it('refuses a rename with no name, and in a window that can only read the project', async () => {
    const world = projectWorld();
    const writer = await world.window();
    await made(writer, 'Harbour');
    const reader = await world.window();
    const [header] = headers(reader);
    await reader.runAndHear('file.open', { project: header?.id ?? '' });

    expect(writer.run('file.rename-project', { name: ' ' }).kind).toBe('refused');
    expect(reader.run('file.rename-project', { name: 'Mine now' })).toMatchObject({
      kind: 'refused',
      failures: [
        { summary: 'This tab can only read the project open here, so it cannot change it.' },
      ],
    });
  });

  it('forks a project of its own from where the project is, leaving the project as it was', async () => {
    const window = await projectWorld().window();
    await made(window, 'Harbour');

    expect(await window.runAndHear('file.fork-project', { name: 'Harbour, another way' })).toBe(
      '"Harbour, another way" is made. Open it from the Projects dialogue.',
    );
    expect(
      headers(window)
        .map((header) => header.name)
        .sort(),
    ).toEqual(['Harbour', 'Harbour, another way']);
    expect(openName(window)).toBe('Harbour');
    expect(window.run('file.fork-project', { name: '' }).kind).toBe('refused');
  });
});

describe('deleting, restoring and purging a project', () => {
  it('deletes the project open here, closing it first, and restores it', async () => {
    const window = await projectWorld().window();
    await made(window, 'Harbour');

    expect(await window.runAndHear('file.delete-project')).toBe(
      '"Harbour" is deleted. You can restore it from the Projects dialogue.',
    );
    expect(window.projects.project.get().kind).toBe('none');
    const [deleted] = headers(window);
    expect(deleted?.deleted).toBeDefined();

    expect(await window.runAndHear('file.restore-project', { project: deleted?.id ?? '' })).toBe(
      '"Harbour" is restored.',
    );
    expect(headers(window)[0]?.deleted).toBeUndefined();
  });

  it('purges a deleted project only with the deletion the person was shown', async () => {
    const window = await projectWorld().window();
    await made(window, 'Harbour');
    await window.runAndHear('file.delete-project');
    const [deleted] = headers(window);
    const project = deleted?.id ?? '';

    expect(window.run('file.purge-project', { project }).kind).toBe('refused');
    expect(
      await window.runAndHear('file.purge-project', {
        project,
        deletedAt: (deleted?.deleted ?? 0) + 1,
      }),
    ).toMatch(/Only a deleted project is purged/);
    expect(headers(window)).toHaveLength(1);

    expect(
      await window.runAndHear('file.purge-project', { project, deletedAt: deleted?.deleted ?? 0 }),
    ).toBe('"Harbour" is purged, and cannot be restored.');
    expect(window.projects.library.get().entries).toEqual([]);
  });

  it('cannot delete where no project is open and none is named', async () => {
    const window = await projectWorld().window();

    expect(window.run('file.delete-project').kind).toBe('refused');
  });
});
