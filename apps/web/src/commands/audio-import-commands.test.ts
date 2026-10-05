import { describe, expect, it, vi } from 'vitest';

import { channelCount } from '@audiogubbins/domain';
import { SourceHandling } from '@audiogubbins/media-store';
import type { PageFile } from '@audiogubbins/storage-runtime';
import { sine, stereo, wavFile } from '@audiogubbins/test-fixtures';

import { assetEntryId } from '../assets/project-entry.js';
import { holdPlatformFiles } from '../testing/project-audio.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { ScriptedLinkedFiles } from '../testing/scripted-linked-files.js';

holdPlatformFiles();

/** Half a second of stereo at 44.1 kHz, as a WAV file's bytes. */
const HARBOUR_WAV = wavFile(
  stereo(
    sine(440, { sampleRate: 44_100, length: 22_050, amplitude: 0.5 }),
    sine(660, { sampleRate: 44_100, length: 22_050 }),
  ),
);

/** A file the person chose, of `bytes`, kept under `handleKey` where one is given. */
function chosen(
  bytes: Uint8Array<ArrayBuffer>,
  name = 'Harbour.wav',
  handleKey?: string,
): PageFile {
  return {
    bytes: { kind: 'file', file: new File([bytes], name) },
    fileName: name,
    mediaType: 'audio/wav',
    lastModified: 11,
    ...(handleKey === undefined ? {} : { handleKey }),
  };
}

/** A window with a project open to change, and an editor view in use. */
async function windowWithProject(linkedFiles?: ScriptedLinkedFiles): Promise<ProjectWindow> {
  const window = await projectWorld().window(linkedFiles === undefined ? {} : { linkedFiles });
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  window.context.editorViews.focus('editor');
  return window;
}

/** The assets of the project `window` writes. */
function assetsOf(window: ProjectWindow) {
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('No project is open to change.');
  return session.getSnapshot().model.state;
}

/**
 * Calls off the next import the moment it starts, before the storage worker is
 * asked to read anything: an import of a file this small could otherwise finish
 * before a cancel sent after it, on a loaded machine.
 */
function cancelOnStart(window: ProjectWindow): void {
  const stop = window.projects.imports.subscribe(() => {
    if (window.projects.imports.get().kind !== 'importing') return;
    stop();
    window.run('file.cancel-import');
  });
}

describe('importing audio into the open project (REQ-STOR-025, REQ-AUDIO-220)', () => {
  it('copies the chosen file in at its own rate, records its shape and opens it in the editor in use', async () => {
    const window = await windowWithProject();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));

    expect(await window.runAndHear('file.import-audio')).toBe('"Harbour" is imported and open.');

    const state = assetsOf(window);
    const [asset] = state.project.assets.values();
    if (asset === undefined) throw new Error('No asset was imported.');
    expect([asset.sampleRate, asset.length, channelCount(asset.channelLayout)]).toEqual([
      44_100, 22_050, 2,
    ]);
    const source = state.sources.get(asset.id);
    expect(source?.media.kind).toBe('managed');
    expect(source?.provenance?.audio).toMatchObject({
      container: 'wav',
      sampleRate: 44_100,
      bitDepth: 16,
      frames: 22_050,
      declaredFrames: 22_050,
    });
    expect(window.context.editorViews.entry('editor')?.asset).toBe(assetEntryId(asset.id));
  });

  it('opens the file in a new Editor panel where no editor is in use', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    expect(window.context.editorViews.get().focused).toBeUndefined();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));

    expect(await window.runAndHear('file.import-audio')).toBe('"Harbour" is imported and open.');

    const [asset] = assetsOf(window).project.assets.values();
    const panel = window.context.editorViews.get().focused;
    if (asset === undefined || panel === undefined) throw new Error('Nothing was opened.');
    expect(window.context.editorViews.entry(panel)?.asset).toBe(assetEntryId(asset.id));
  });

  it('links the file where the person chose to link files, keeping no copy of it', async () => {
    const linkedFiles = new ScriptedLinkedFiles();
    const window = await windowWithProject(linkedFiles);
    const file = chosen(HARBOUR_WAV, 'Harbour.wav', 'harbour-key');
    linkedFiles.keep(file);
    window.files.mediaFiles.push(file);
    window.run('settings.source-handling', { handling: SourceHandling.Link });

    expect(await window.runAndHear('file.import-audio')).toBe('"Harbour" is imported and open.');

    const [source] = assetsOf(window).sources.values();
    expect(source?.media).toMatchObject({ kind: 'external', policy: 'prompt' });
    expect(source?.media.kind === 'external' && source.media.retainedCopy).toBe(undefined);
  });

  it('refuses a file that is not audio it can read, naming it, and leaves the project as it was', async () => {
    const window = await windowWithProject();
    const before = assetsOf(window);
    window.files.mediaFiles.push(
      chosen(new TextEncoder().encode('Not a sound at all.'), 'notes.wav'),
    );

    const said = await window.runAndHear('file.import-audio');

    expect(said).toMatch(/notes\.wav|not.*(read|audio)/iu);
    expect(assetsOf(window)).toBe(before);
  });

  it('reads a file cut short to its last whole frame, and says by how much it fell short', async () => {
    const window = await windowWithProject();
    // Ten frames of 16-bit stereo, and half of one more, are gone from the end.
    window.files.mediaFiles.push(chosen(HARBOUR_WAV.slice(0, HARBOUR_WAV.length - 42)));

    expect(await window.runAndHear('file.import-audio')).toBe(
      '"Harbour" is imported and open. Its audio ends 11 frames before its header says it does, so it was read to its last whole frame.',
    );
    const [asset] = assetsOf(window).project.assets.values();
    expect(asset?.length).toBe(22_039);
  });

  it('keeps nothing of an import the person cancels', async () => {
    const window = await windowWithProject();
    const before = assetsOf(window);
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));

    cancelOnStart(window);

    expect(await window.runAndHear('file.import-audio')).toBe(
      'The import of "Harbour.wav" was cancelled, and nothing was kept.',
    );
    expect(assetsOf(window)).toBe(before);
    expect(window.projects.imports.get().kind).toBe('idle');
  });

  it('reports an import as made where the cancel reaches the worker only after it added the asset', async () => {
    const window = await windowWithProject();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));
    const session = window.projects.project.session();
    if (session === undefined) throw new Error('No project is open to change.');
    // The page hears the asset added before the worker's answer arrives, so a
    // cancel sent now reaches a worker that has carried the import out.
    const stop = session.subscribe(() => {
      if (session.getSnapshot().model.state.project.assets.size === 0) return;
      stop();
      expect(window.run('file.cancel-import').kind).toBe('applied');
    });

    expect(await window.runAndHear('file.import-audio')).toBe('"Harbour" is imported and open.');
    expect(assetsOf(window).project.assets.size).toBe(1);
  });

  it('says nothing and changes nothing when the person dismisses the chooser', async () => {
    const window = await windowWithProject();
    const before = assetsOf(window);
    const asked = vi.spyOn(window.services.client.media, 'importFile');

    const said = window.said.length;

    expect(window.run('file.import-audio').kind).toBe('applied');
    // A task runs once every promise the dismissal settled has run its callbacks.
    await new Promise((settled) => setTimeout(settled, 0));

    expect(window.said.length).toBe(said);
    expect(assetsOf(window)).toBe(before);
    expect(window.projects.imports.get().kind).toBe('idle');
    expect(asked).not.toHaveBeenCalled();
  });

  it('offers neither another import nor a Quick Edit while one runs, saying why', async () => {
    const window = await windowWithProject();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV), chosen(HARBOUR_WAV, 'Again.wav'));
    // Asked the moment the first import starts, which a poll could miss. The
    // bus refuses a command its availability turns down, so a refusal here is
    // what the File menu and the palette read before anything is pressed.
    const refused = new Promise<readonly string[]>((resolve) => {
      const stop = window.projects.imports.subscribe(() => {
        if (window.projects.imports.get().kind !== 'importing') return;
        stop();
        resolve(
          ['file.import-audio', 'file.quick-edit'].map((id) => {
            const ran = window.run(id);
            return ran.kind === 'refused' ? ran.failures[0].summary : ran.kind;
          }),
        );
      });
    });

    window.run('file.import-audio');

    expect(await refused).toEqual([
      'A file is being imported already. Wait for it, or cancel it.',
      'A file is being imported already. Wait for it, or cancel it.',
    ]);
    await expect.poll(() => window.said).toContain('"Harbour" is imported and open.');
    expect(assetsOf(window).project.assets.size).toBe(1);
  });
});
