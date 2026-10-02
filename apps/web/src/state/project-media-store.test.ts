import { describe, expect, it } from 'vitest';

import type { PageFile } from '@audiogubbins/storage-runtime';

import { addLinkedAsset, linkedFile, sourceOf } from '../testing/linked-assets.js';
import { projectWorld } from '../testing/project-context.js';
import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { ScriptedLinkedFiles } from '../testing/scripted-linked-files.js';

holdPlatformFiles();

/** `file` as the browser hands it over through its handle: the file itself. */
async function asHeld(file: PageFile): Promise<PageFile> {
  const source = sourceOf(file);
  const bytes = await source.read(0, source.size);
  return { ...file, bytes: { kind: 'file', file: new File([bytes], file.fileName) } };
}

describe('the files behind the open project’s assets (ADR-0052)', () => {
  it('holds the stored object of media kept in the project', async () => {
    const audio = await windowWithAudio();

    const held = audio.window.projects.media.of(audio.assetId);

    expect(held.kind).toBe('found');
    expect(held.kind === 'found' ? held.file.size : 0).toBeGreaterThan(6 * 48_000 * 4);
  });

  it('reads a linked file through its kept handle once the project’s files were looked at', async () => {
    const linkedFiles = new ScriptedLinkedFiles();
    const window = await projectWorld().window({ linkedFiles });
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const kick = linkedFile('Kick.wav', 'kept-kick');
    const held = await asHeld(kick);
    linkedFiles.keep(held);

    const asset = await addLinkedAsset(window, kick);

    await expect
      .poll(() => window.projects.media.of(asset))
      .toEqual({
        kind: 'found',
        file: held.bytes.kind === 'file' ? held.bytes.file : undefined,
      });
  });

  it('reads no linked file that is no longer the one the project recorded', async () => {
    const linkedFiles = new ScriptedLinkedFiles();
    const window = await projectWorld().window({ linkedFiles });
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const kick = linkedFile('Kick.wav', 'kept-kick');
    const asset = await addLinkedAsset(window, kick);
    linkedFiles.keep(await asHeld(linkedFile('Kick.wav', 'kept-kick', 9)));

    await window.projects.sources.check();

    expect(window.projects.sources.get().changes.map((change) => change.asset)).toEqual([asset]);
    expect(window.projects.media.of(asset)).toEqual({
      kind: 'unavailable',
      reason:
        'The file it is linked to is no longer the one the project recorded. Answer the question about it first.',
    });
  });
});
