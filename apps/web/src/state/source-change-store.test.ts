import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  type AssetId,
  type ProjectId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExternalFile } from '@audiogubbins/media-store';
import { memorySource, observeFile } from '@audiogubbins/media-store/testing';
import { addAssetInvocation } from '@audiogubbins/project-commands';
import { storageKeyOf, type MediaSource } from '@audiogubbins/project-format';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** A file the person linked, as the browser hands one over, its handle kept under `key`. */
function linkedFile(name: string, key: string, fill = 1): ExternalFile {
  return {
    source: memorySource(new Uint8Array(256).fill(fill)),
    fileName: name,
    mediaType: 'audio/wav',
    lastModified: 5,
    handleKey: key,
  };
}

/**
 * A window whose project links one asset to a file, opened again so its linked
 * files are looked at: the file cannot be found, since the test browser keeps
 * no handles.
 */
async function withLinkedAsset(): Promise<{
  readonly window: ProjectWindow;
  readonly asset: AssetId;
}> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('No project is open to change.');
  const identity = expectSuccess(
    await observeFile(linkedFile('kick.wav', 'kept-1'), window.services.digest),
  );
  const asset = window.services.ids.next<'AssetId'>();
  const media: MediaSource = { kind: 'external', identity, policy: 'prompt' };
  const added = await session.run(
    addAssetInvocation(
      {
        id: asset,
        displayName: 'Kick',
        origin: 'imported',
        sampleRate: expectSuccess(sampleRate(48_000)),
        channelLayout: StandardLayouts.mono,
        length: expectSuccess(sampleCount(4_800)),
        storageKey: storageKeyOf(asset, media),
      },
      { media },
    ),
  );
  expect(added).toMatchObject({ ok: true, value: { kind: 'applied' } });
  const project: ProjectId = session.project;
  await window.runAndHear('file.close-project');
  await window.runAndHear('file.open', { project });
  await expect.poll(() => window.projects.sources.get().checking).toBe(false);
  return { window, asset };
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
