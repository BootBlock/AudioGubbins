import { generatedSource } from '@audiogubbins/media-store/testing';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import { describe, expect, it } from 'vitest';

import { olderStorage, projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** Waits until the window's usage store has stopped working. */
async function measured(window: ProjectWindow): Promise<void> {
  await expect.poll(() => window.projects.usage.get().usage !== undefined).toBe(true);
  await expect.poll(() => window.projects.usage.get().working).toBeUndefined();
}

describe('stored data of another version', () => {
  it('blocks every project with the compatibility screen until the person decides', async () => {
    const window = await projectWorld(await olderStorage()).window();

    expect(window.context.storageRoot.get()).toMatchObject({
      kind: 'blocked',
      data: {
        kind: 'incompatible',
        schema: 'projectStorage',
        found: 0,
        current: SCHEMA_VERSIONS.projectStorage,
      },
      shown: true,
    });
    expect(window.run('file.create-project', { name: 'Anything' }).kind).toBe('refused');
    expect(window.run('storage.review').kind).toBe('refused');
  });

  it('sets the decision aside, leaving every byte, and shows the screen again when asked', async () => {
    const tree = await olderStorage();
    const before = await tree.readFile('storage.json');
    const window = await projectWorld(tree).window();

    window.run('storage.set-aside');
    expect(window.context.storageRoot.get()).toMatchObject({ kind: 'blocked', shown: false });
    expect(window.said.at(-1)).toMatch(/left as it is/);
    expect(await tree.readFile('storage.json')).toEqual(before);

    window.run('storage.review');
    expect(window.context.storageRoot.get()).toMatchObject({ kind: 'blocked', shown: true });
  });

  it('saves a copy of the raw data where the person chooses, as a ZIP archive', async () => {
    const window = await projectWorld(await olderStorage()).window();

    expect(await window.runAndHear('storage.export-raw')).toBe(
      'A copy of the stored data is saved.',
    );

    const [saved] = window.files.saved;
    expect(saved).toMatchObject({ name: 'AudioGubbins stored data.zip', finished: true });
    // A ZIP archive's local file header, then the root's own file name.
    const bytes = saved?.sink.bytes() ?? new Uint8Array();
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(bytes)).toContain('storage.json');
  });

  it('removes the data only once the second confirmation says so, and then lets projects be made', async () => {
    const tree = await olderStorage();
    const window = await projectWorld(tree).window();

    expect(window.run('storage.wipe').kind).toBe('refused');
    expect(window.context.storageRoot.get().kind).toBe('blocked');

    expect(await window.runAndHear('storage.wipe', { confirmed: 'yes' })).toBe(
      'The stored data is removed. You can make new projects now.',
    );
    expect(window.context.storageRoot.get().kind).toBe('ready');
    expect(window.run('file.create-project', { name: 'Afresh' }).kind).toBe('applied');
  });

  it('refuses every decision where nothing blocks', async () => {
    const window = await projectWorld().window();

    for (const id of [
      'storage.export-raw',
      'storage.set-aside',
      'storage.review',
      'storage.wipe',
    ]) {
      expect(window.run(id, { confirmed: 'yes' }).kind, id).toBe('refused');
    }
  });
});

describe('measuring the storage and cleaning it up', () => {
  it('measures what each part of the storage takes, the project open here among it', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });

    window.run('storage.measure');
    await measured(window);

    const usage = window.projects.usage.get().usage;
    expect(usage?.recoveryCheckpoints).toBeGreaterThan(0);
    expect(usage?.unreferencedMedia).toBe(0);
    expect(usage?.unreadable).toEqual([]);
  });

  it('plans a cleanup, carries out one of caches alone at a press, and measures again after', async () => {
    const window = await projectWorld().window();
    const heard = window.nextSaid();
    window.run('storage.plan-cleanup', { choices: 'cache:temporary,cache:waveform' });
    expect(await heard).toBe('There is nothing of that to clean up.');
    expect(window.projects.usage.get().plan?.confirmationBytes).toBe(0);

    expect(await window.runAndHear('storage.clean-up')).toBe('The cleanup freed 0 bytes.');
    expect(window.projects.usage.get().plan).toBeUndefined();
    await measured(window);
  });

  it('says only what the newer plan came to where it replaced one still being made', async () => {
    const window = await projectWorld().window();

    window.run('storage.plan-cleanup', { choices: 'cache:waveform' });
    window.run('storage.plan-cleanup', { choices: 'cache:temporary' });

    await expect.poll(() => window.said).toHaveLength(1);
    await expect.poll(() => window.projects.usage.get().working).toBeUndefined();
    expect(window.said).toEqual(['There is nothing of that to clean up.']);
    expect(window.projects.usage.get().plan?.steps).toEqual([]);
  });

  it('carries out a cleanup reaching past the caches only with the bytes the person was shown', async () => {
    const window = await projectWorld().window();
    // Media stored and referred to by nothing, which only a purge removes.
    const { store } = window.storage;
    const put = await store.put(generatedSource(3_000, 7));
    if (put.ok) store.release(put.value.contentId);
    const planned = window.nextSaid();
    window.run('storage.plan-cleanup', { choices: 'unreferenced-media' });
    expect(await planned).toBe('The cleanup is planned. Review it before you carry it out.');
    const bytes = window.projects.usage.get().plan?.confirmationBytes ?? 0;
    expect(bytes).toBeGreaterThanOrEqual(3_000);

    expect(await window.runAndHear('storage.clean-up')).toMatch(
      /was not confirmed as it was shown/,
    );
    expect(await window.runAndHear('storage.clean-up', { bytes: bytes + 1 })).toMatch(
      /was not confirmed as it was shown/,
    );
    expect(window.projects.usage.get().plan).toBeDefined();

    expect(await window.runAndHear('storage.clean-up', { bytes })).toMatch(
      /^The cleanup freed 2\.9 kB/,
    );
    await measured(window);
    expect(window.projects.usage.get().usage?.unreferencedMedia).toBe(0);
  });

  it('compacts the history of the project open in this tab, rather than calling it busy', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const session = window.projects.project.session();
    if (session === undefined) throw new Error('No project is open.');
    await session.setRetentionPolicy({
      kind: 'rules',
      rules: [{ kind: 'recent-changes', count: 1 }],
    });
    for (const name of ['One', 'Two', 'Three']) {
      await window.runAndHear('file.rename-project', { name });
    }
    await session.checkpoint();
    const planned = window.nextSaid();
    window.run('storage.plan-cleanup', { choices: 'expired-history' });
    expect(await planned).toBe('The cleanup is planned. Review it before you carry it out.');
    const bytes = window.projects.usage.get().plan?.confirmationBytes ?? 0;

    expect(await window.runAndHear('storage.clean-up', { bytes })).toMatch(
      /^The cleanup freed [^.]+\.$/u,
    );
    expect(window.projects.usage.get().outcomes).toMatchObject([
      { step: 'expired-history', busy: [], unapplied: [] },
    ]);
    expect(session.getSnapshot().model.history.nodes.size).toBe(2);
  });

  it('refuses a cleanup the arguments do not name, and one with no plan', async () => {
    const window = await projectWorld().window();

    expect(window.run('storage.plan-cleanup', { choices: 'everything-at-once' }).kind).toBe(
      'refused',
    );
    expect(window.run('storage.clean-up').kind).toBe('refused');
  });
});

describe('how files are brought in', () => {
  it('chooses to copy or to link, and says which', async () => {
    const window = await projectWorld().window();

    window.run('settings.source-handling', { handling: 'link' });
    expect(window.projects.preferences.get().sourceHandling).toBe('link');
    expect(window.said.at(-1)).toBe('Files are linked where they lie from now on.');

    window.run('settings.source-handling', { handling: 'copy' });
    expect(window.projects.preferences.get().sourceHandling).toBe('copy');
    expect(window.run('settings.source-handling', { handling: 'borrow' }).kind).toBe('refused');
  });
});
