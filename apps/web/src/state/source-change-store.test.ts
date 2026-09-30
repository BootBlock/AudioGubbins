import { describe, expect, it } from 'vitest';

import type { AssetId, ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { SourceChangePolicy } from '@audiogubbins/project-format';

import { addLinkedAsset, linkedFile } from '../testing/linked-assets.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { ScriptedLinkedFiles } from '../testing/scripted-linked-files.js';

/** Closes the project open in `window` and opens it again, so its linked files are looked at. */
async function reopened(window: ProjectWindow): Promise<void> {
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('No project is open.');
  const project: ProjectId = session.project;
  await window.runAndHear('file.close-project');
  await window.runAndHear('file.open', { project });
  await expect.poll(() => window.projects.sources.get().checking).toBe(false);
}

/**
 * A window whose project links one asset to a file, opened again so its linked
 * files are looked at: the file cannot be found, since the browser keeps no
 * handle for it.
 */
async function withLinkedAsset(): Promise<{
  readonly window: ProjectWindow;
  readonly asset: AssetId;
}> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const asset = await addLinkedAsset(window, linkedFile('kick.wav', 'kept-1'));
  await reopened(window);
  return { window, asset };
}

/**
 * A window whose project links one asset, frozen on a retained copy of its
 * content, to a file the browser keeps but needs the person's leave to read.
 */
async function withFileWantingLeave() {
  const linkedFiles = new ScriptedLinkedFiles();
  const window = await projectWorld().window({ linkedFiles });
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const file = linkedFile('kick.wav', 'kept-1');
  const { contentId } = expectSuccess(await window.services.store.put(file.source));
  const asset = await addLinkedAsset(window, file, {
    policy: SourceChangePolicy.Freeze,
    retainedCopy: contentId,
  });
  const kept = linkedFiles.keep(file, 'asks');
  await reopened(window);
  const mediaKind = (): string | undefined => {
    const open = window.projects.project.get();
    return open.kind === 'open'
      ? open.snapshot.model.state.sources.get(asset)?.media.kind
      : undefined;
  };
  return { window, asset, kept, linkedFiles, mediaKind };
}

describe('a file the open project links to', () => {
  it('is looked at as the project opens, and one that cannot be found is put to the person', async () => {
    const { window, asset } = await withLinkedAsset();

    const [change] = window.projects.sources.get().changes;
    expect(change).toMatchObject({
      asset,
      name: 'Kick',
      classification: { kind: 'missing', reason: 'not-found' },
    });
    expect(change?.plan.choices).toEqual([
      { kind: 'relink', available: true },
      { kind: 'freeze', available: false, reason: 'no-retained-copy' },
      { kind: 'keep-offline', available: true },
    ]);
  });

  it('is linked to another file the person chooses, as a change undo reverses', async () => {
    const { window, asset } = await withLinkedAsset();
    window.files.mediaFiles.push(linkedFile('kick, moved.wav', 'kept-2'));

    expect(await window.runAndHear('source.resolve', { asset, choice: 'relink' })).toBe('Done.');
    expect(window.projects.sources.get().changes).toEqual([]);
    const open = window.projects.project.get();
    const media =
      open.kind === 'open' ? open.snapshot.model.state.sources.get(asset)?.media : undefined;
    expect(media?.kind === 'external' && media.identity.fileName).toBe('kick, moved.wav');
  });

  it('asks before linking a chosen file that is not the one the project used', async () => {
    const { window, asset } = await withLinkedAsset();
    window.files.mediaFiles.push(linkedFile('snare.wav', 'kept-3', 2));

    expect(await window.runAndHear('source.resolve', { asset, choice: 'relink' })).toBe(
      'The file you chose is not the one the project used: it is another kind of file. Link it anyway, or choose another file.',
    );
    const [change] = window.projects.sources.get().changes;
    expect(change?.offered?.identity.fileName).toBe('snare.wav');
    const linkedName = (): string | false | undefined => {
      const open = window.projects.project.get();
      const media =
        open.kind === 'open' ? open.snapshot.model.state.sources.get(asset)?.media : undefined;
      return media?.kind === 'external' && media.identity.fileName;
    };
    expect(linkedName()).toBe('kick.wav');

    expect(await window.runAndHear('source.link-offered', { asset })).toBe('Done.');
    expect(window.projects.sources.get().changes).toEqual([]);
    expect(linkedName()).toBe('snare.wav');
  });

  it('refuses a choice that cannot be taken, saying why, and keeps it waiting', async () => {
    const { window, asset } = await withLinkedAsset();

    expect(await window.runAndHear('source.resolve', { asset, choice: 'freeze' })).toBe(
      'No copy of the version the project was made with was kept, so it cannot be kept playing.',
    );
    expect(window.projects.sources.get().changes).toHaveLength(1);
    expect(await window.runAndHear('source.resolve', { asset, choice: 'relink' })).toBe(
      'No file was chosen, so the asset is linked as it was.',
    );
  });

  it('that needs leave to be read is put to the person, and not frozen by its policy', async () => {
    const { window, asset, linkedFiles, mediaKind } = await withFileWantingLeave();

    expect(window.projects.sources.get()).toMatchObject({
      changes: [{ asset, classification: { kind: 'missing', reason: 'access-needed' } }],
      applied: [],
    });
    expect(mediaKind()).toBe('external');
    expect(linkedFiles.asked).toBe(0);
  });

  it('is looked at again once the person gives leave, and found as it was', async () => {
    const { window, asset, linkedFiles, mediaKind } = await withFileWantingLeave();

    expect(await window.runAndHear('source.give-access', { asset })).toBe(
      'The file is as the project recorded it, and the asset plays again.',
    );
    expect(linkedFiles.asked).toBe(1);
    expect(window.projects.sources.get().changes).toEqual([]);
    expect(mediaKind()).toBe('external');
  });

  it('once given leave, is answered by its policy where it changed', async () => {
    const { window, asset, kept, mediaKind } = await withFileWantingLeave();
    kept.file = linkedFile('kick.wav', 'kept-1', 7);

    expect(await window.runAndHear('source.give-access', { asset })).toBe(
      'The file is not what the project recorded, so the asset was dealt with as its own setting says.',
    );
    expect(window.projects.sources.get()).toMatchObject({
      changes: [],
      applied: [{ asset, kind: 'freeze' }],
    });
    expect(mediaKind()).toBe('managed');
  });

  it('stays waiting where leave is refused, or the browser does not ask', async () => {
    const { window, asset, kept } = await withFileWantingLeave();
    kept.activated = false;

    expect(await window.runAndHear('source.give-access', { asset })).toBe(
      'The browser did not ask for leave to read the file. Press Give access again.',
    );
    kept.activated = true;
    kept.answer = 'denied';
    expect(await window.runAndHear('source.give-access', { asset })).toBe(
      'Leave to read the file was refused, so the asset stays offline unless you choose another file.',
    );
    expect(window.projects.sources.get().changes).toMatchObject([
      { asset, classification: { kind: 'missing', reason: 'permission-refused' } },
    ]);
    expect(await window.runAndHear('source.give-access', { asset })).toBe(
      'AudioGubbins does not need your leave to read that file.',
    );
  });

  it('is kept offline, or every one set aside until the project opens again', async () => {
    const { window, asset } = await withLinkedAsset();

    expect(await window.runAndHear('source.resolve', { asset, choice: 'keep-offline' })).toBe(
      'The asset stays offline until you choose again.',
    );
    expect(window.projects.sources.get().changes).toEqual([]);
    expect(window.run('source.decide-later').kind).toBe('refused');

    const again = await withLinkedAsset();
    again.window.run('source.decide-later');
    expect(again.window.projects.sources.get().changes).toEqual([]);
  });
});
