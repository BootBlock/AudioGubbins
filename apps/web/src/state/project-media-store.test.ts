import { describe, expect, it } from 'vitest';

import type { AssetId } from '@audiogubbins/domain';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { PageFile } from '@audiogubbins/storage-runtime';

import type { LinkedFileAccess } from '../io/linked-files.js';

import { addLinkedAsset, linkedFile, sourceOf } from '../testing/linked-assets.js';
import { projectWorld } from '../testing/project-context.js';
import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { ScriptedLinkedFiles } from '../testing/scripted-linked-files.js';

holdPlatformFiles();

/**
 * Linked files each found a task later, or once let through where `holds`
 * says so as the look begins, counting the looks begun, finished, at once and
 * held.
 */
class CountedLooks extends ScriptedLinkedFiles {
  begun = 0;
  found = 0;
  looking = 0;
  most = 0;
  waiting = 0;
  holds: () => boolean = () => false;
  #letThrough: () => void = () => undefined;
  readonly #held = new Promise<void>((resolve) => {
    this.#letThrough = resolve;
  });

  letThrough(): void {
    this.#letThrough();
  }

  override async look(
    identity: ExternalSourceIdentity,
    signal?: AbortSignal,
  ): Promise<LinkedFileAccess> {
    this.begun += 1;
    this.looking += 1;
    this.most = Math.max(this.most, this.looking);
    try {
      if (this.holds()) {
        this.waiting += 1;
        await this.#held;
        this.waiting -= 1;
      } else {
        await new Promise((later) => setTimeout(later, 0));
      }
      const access = await super.look(identity, signal);
      this.found += 1;
      return access;
    } finally {
      this.looking -= 1;
    }
  }
}

/** `file` as the browser hands it over through its handle: the file itself. */
async function asHeld(file: PageFile): Promise<PageFile> {
  const source = sourceOf(file);
  const bytes = await source.read(0, source.size);
  return { ...file, bytes: { kind: 'file', file: new File([bytes], file.fileName) } };
}

/**
 * A window whose project links ten assets to files the browser keeps, closed
 * so that opening it again wants every file at once.
 */
async function tenLinkedAssets() {
  const linkedFiles = new CountedLooks();
  const window = await projectWorld().window({ linkedFiles });
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const assets: AssetId[] = [];
  for (let index = 0; index < 10; index += 1) {
    const file = linkedFile(`Kick ${String(index)}.wav`, `kept-${String(index)}`, index + 1);
    linkedFiles.keep(await asHeld(file));
    assets.push(await addLinkedAsset(window, file));
  }
  const project = window.projects.project.session()?.project ?? '';
  await window.runAndHear('file.close-project');
  return { window, linkedFiles, assets, project };
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

  it('asks for a few files at a time, however many assets the project has', async () => {
    const { window, linkedFiles, assets, project } = await tenLinkedAssets();
    linkedFiles.most = 0;

    // Opened again, every file is wanted at once, once the project's files
    // were looked at one at a time.
    await window.runAndHear('file.open', { project });

    await expect
      .poll(() => assets.map((asset) => window.projects.media.of(asset).kind), {
        timeout: 10_000,
      })
      .toEqual(assets.map(() => 'found'));
    expect(linkedFiles.most).toBeGreaterThan(1);
    expect(linkedFiles.most).toBeLessThanOrEqual(4);
  });

  it('gives up the files it asks for, and asks for no more, once the project is let go', async () => {
    const { window, linkedFiles, project } = await tenLinkedAssets();
    // Held once the project's files were looked at, so only this store's wait.
    linkedFiles.holds = () => !window.projects.sources.get().checking;
    await window.runAndHear('file.open', { project });
    await expect.poll(() => linkedFiles.waiting).toBeGreaterThan(0);
    const { begun, found } = linkedFiles;

    await window.runAndHear('file.close-project');
    linkedFiles.letThrough();
    await expect.poll(() => linkedFiles.looking).toBe(0);

    expect([linkedFiles.begun - begun, linkedFiles.found - found]).toEqual([0, 0]);
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
