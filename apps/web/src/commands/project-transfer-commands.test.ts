import { describe, expect, it } from 'vitest';

import { MemoryDirectory } from '@audiogubbins/storage/testing';

import { bundleFrom, projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** The names of the projects a window lists, deleted ones among them, sorted. */
function names(window: ProjectWindow): readonly string[] {
  return window.projects.library
    .get()
    .entries.flatMap((entry) => (entry.kind === 'project' ? [entry.header.name] : []))
    .sort();
}

/** A window with a project made and renamed, so it has a history to carry. */
async function withProject(options?: { readonly canWriteFolders?: boolean }) {
  const world = projectWorld();
  const window = await world.window(options);
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  await window.runAndHear('file.rename-project', { name: 'Harbour at dusk' });
  // The list is read again once the new name is saved.
  await expect.poll(() => names(window)).toEqual(['Harbour at dusk']);
  return { world, window };
}

describe('taking a project out as a bundle and bringing it back', () => {
  it('saves the bundle where the person chooses, named after the project', async () => {
    const { window } = await withProject();

    expect(await window.runAndHear('file.export-bundle')).toBe(
      '"Harbour at dusk" is exported as a bundle.',
    );
    const [saved] = window.files.saved;
    expect(saved).toMatchObject({
      name: 'Harbour at dusk.zip',
      mediaType: 'application/zip',
      finished: true,
    });
    expect(saved?.sink.ending).toBe('closed');
  });

  it('brings the bundle into another browser as the same project, history and all', async () => {
    const { window } = await withProject();
    await window.runAndHear('file.export-bundle');
    const [saved] = window.files.saved;
    const elsewhere = await projectWorld().window();
    if (saved !== undefined) elsewhere.files.bundles.push(bundleFrom(saved));

    expect(await elsewhere.runAndHear('file.import-bundle')).toBe(
      '"Harbour at dusk" is brought in.',
    );
    expect(names(elsewhere)).toEqual(['Harbour at dusk']);

    const [entry] = elsewhere.projects.library.get().entries;
    await elsewhere.runAndHear('file.open', {
      project: entry?.kind === 'project' ? entry.header.id : '',
    });
    expect(await elsewhere.runAndHear('edit.undo')).toMatch(/^Undone: Rename/);
  });

  it('brings a bundle of a project this browser keeps in as a copy, even while it is open here', async () => {
    const { window } = await withProject();
    await window.runAndHear('file.export-bundle');
    const [saved] = window.files.saved;
    if (saved !== undefined) window.files.bundles.push(bundleFrom(saved));

    expect(await window.runAndHear('file.import-bundle')).toBe(
      '"Harbour at dusk" is brought in as a copy, since this browser already keeps that project.',
    );
    expect(names(window)).toEqual(['Harbour at dusk', 'Harbour at dusk']);
  });

  it('keeps only the state, at the provenance asked for, where the whole history is not wanted', async () => {
    const { window } = await withProject();
    await window.runAndHear('file.export-bundle', { scope: 'current-state', provenance: 'none' });
    const [saved] = window.files.saved;
    const elsewhere = await projectWorld().window();
    if (saved !== undefined) elsewhere.files.bundles.push(bundleFrom(saved));
    await elsewhere.runAndHear('file.import-bundle');
    const [entry] = elsewhere.projects.library.get().entries;

    await elsewhere.runAndHear('file.open', {
      project: entry?.kind === 'project' ? entry.header.id : '',
    });
    expect(elsewhere.run('edit.undo').kind).toBe('refused');
    expect(
      window.run('file.export-bundle', { scope: 'current-state', provenance: 'most' }).kind,
    ).toBe('refused');
  });

  it('says nothing and writes nothing where the person dismisses the chooser', async () => {
    const { window } = await withProject();
    window.files.dismissSave = true;
    const before = window.said.length;

    window.run('file.export-bundle');
    window.run('file.import-bundle');
    window.run('file.import-folder');
    await expect.poll(() => window.projects.transfer.get().working).toBeUndefined();

    expect(window.said.length).toBe(before);
    expect(names(window)).toEqual(['Harbour at dusk']);
  });
});

describe('taking a project out as a folder and bringing it back', () => {
  it('writes the unpacked tree into a folder the picker gives, and reads it back in', async () => {
    const { window } = await withProject();
    const folder = new MemoryDirectory();
    window.files.foldersToWrite.push(folder);

    expect(await window.runAndHear('file.export-folder')).toBe(
      '"Harbour at dusk" is exported to the folder.',
    );
    expect([...folder.files.keys()]).toContain('audiogubbins-project.json');

    const elsewhere = await projectWorld().window();
    elsewhere.files.foldersToRead.push(folder);
    expect(await elsewhere.runAndHear('file.import-folder')).toBe(
      '"Harbour at dusk" is brought in.',
    );
  });

  it('cannot export to a folder where the browser gives no folder to write into', async () => {
    const { window } = await withProject({ canWriteFolders: false });

    expect(window.run('file.export-folder')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: expect.stringMatching(/Export a bundle instead\./) }],
    });
  });
});

describe('the open project made whole', () => {
  it('has nothing to copy where it links to no file', async () => {
    const { window } = await withProject();

    expect(await window.runAndHear('file.consolidate')).toBe(
      '0 linked files are copied into the project.',
    );
  });
});

describe('backups of the open project', () => {
  it('makes one now, kept until the person lets it go, and lists it', async () => {
    const { window } = await withProject();

    expect(await window.runAndHear('file.back-up-now')).toBe(
      'A backup is made, and kept until you remove it.',
    );
    const [generation] = window.projects.backups.get().generations;
    expect(generation).toMatchObject({ reason: 'manual', protected: true });

    expect(
      await window.runAndHear('backup.protect', {
        generation: generation?.number ?? 0,
        keep: false,
      }),
    ).toBe('The backup goes when the policy no longer keeps it.');
    expect(window.projects.backups.get().generations[0]?.protected).toBe(false);
  });

  it('restores a backup as a new project, leaving the project as it is', async () => {
    const { window } = await withProject();
    await window.runAndHear('file.back-up-now');
    const [generation] = window.projects.backups.get().generations;

    expect(
      await window.runAndHear('backup.restore', {
        generation: generation?.number ?? 0,
        as: 'new-project',
      }),
    ).toBe('"Harbour at dusk" is restored as a new project.');
    expect(names(window)).toEqual(['Harbour at dusk', 'Harbour at dusk']);
  });

  it('restores a backup in place, keeping the project as it was as a backup first', async () => {
    const { window } = await withProject();
    await window.runAndHear('file.back-up-now');
    const [generation] = window.projects.backups.get().generations;
    await window.runAndHear('file.rename-project', { name: 'Harbour, later' });

    expect(
      await window.runAndHear('backup.restore', {
        generation: generation?.number ?? 0,
        as: 'replace-current',
      }),
    ).toMatch(/^The project is back as the backup kept it\./);
    const open = window.projects.project.get();
    expect(open.kind === 'open' && open.snapshot.model.state.project.displayName).toBe(
      'Harbour at dusk',
    );
    expect(open.kind === 'open' && open.snapshot.access.kind).toBe('writable');
    expect(window.projects.backups.get().generations).toHaveLength(2);
  });

  it('exports a backup as a bundle where the person chooses', async () => {
    const { window } = await withProject();
    await window.runAndHear('file.back-up-now');
    const [generation] = window.projects.backups.get().generations;

    expect(await window.runAndHear('backup.export', { generation: generation?.number ?? 0 })).toBe(
      'The backup is exported as a bundle.',
    );
    expect(window.files.saved[0]?.name).toMatch(/^Harbour at dusk, backed up .*\.zip$/);
    expect(window.run('backup.export', { generation: 99 }).kind).toBe('refused');
  });

  it('sets when backups are made on their own, and refuses a policy the project could not read back', async () => {
    const { window } = await withProject();

    expect(
      await window.runAndHear('backup.set-policy', {
        kind: 'automatic',
        everyChanges: 5,
        keepCount: 3,
      }),
    ).toBe('Backups are made on their own as you set.');
    const open = window.projects.project.get();
    expect(open.kind === 'open' && open.snapshot.model.backup).toEqual({
      kind: 'automatic',
      trigger: { everyChanges: 5 },
      retention: { count: 3 },
    });

    expect(window.run('backup.set-policy', { kind: 'automatic', everyMinutes: -2 }).kind).toBe(
      'refused',
    );
    expect(window.run('backup.set-policy', { kind: 'automatic', keepCount: 3 }).kind).toBe(
      'refused',
    );
    expect(await window.runAndHear('backup.set-policy', { kind: 'off' })).toBe(
      'Backups are no longer made on their own.',
    );
  });
});
