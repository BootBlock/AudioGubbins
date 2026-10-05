import { describe, expect, it } from 'vitest';

import type { PageFile } from '@audiogubbins/storage-runtime';
import { sine, stereo, wavFile } from '@audiogubbins/test-fixtures';

import { assetEntryId } from '../assets/project-assets.js';
import { holdPlatformFiles } from '../testing/project-audio.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';

holdPlatformFiles();

/** Half a second of stereo at 44.1 kHz, as a WAV file's bytes. */
const HARBOUR_WAV = wavFile(
  stereo(
    sine(440, { sampleRate: 44_100, length: 22_050, amplitude: 0.5 }),
    sine(660, { sampleRate: 44_100, length: 22_050 }),
  ),
);

/** A file the person chose, of `bytes`. */
function chosen(bytes: Uint8Array<ArrayBuffer>, name = 'Harbour.wav'): PageFile {
  return {
    bytes: { kind: 'file', file: new File([bytes], name) },
    fileName: name,
    mediaType: 'audio/wav',
    lastModified: 11,
  };
}

/** The names of every project the window's storage keeps, deleted ones among them. */
async function projectNames(window: ProjectWindow): Promise<readonly string[]> {
  await window.projects.library.refresh();
  return window.projects.library
    .get()
    .entries.map((entry) => (entry.kind === 'project' ? entry.header.name : entry.name))
    .toSorted();
}

/** The open project's state, which the window can change. */
function stateOf(window: ProjectWindow) {
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('No project is open to change.');
  return session.getSnapshot().model.state;
}

/**
 * What a project holds, without what differs by when and where it was made:
 * the identities, the times and the project it was first imported into.
 */
function structureOf(window: ProjectWindow): unknown {
  const { project, sources } = stateOf(window);
  const [asset] = project.assets.values();
  const [source] = sources.values();
  if (asset === undefined || source === undefined) throw new Error('No asset was imported.');
  const { id: _asset, storageKey: _key, edits, ...shape } = asset;
  const {
    importedAt: _at,
    originProjectId: _origin,
    ...provenance
  } = source.provenance ?? {
    importedAt: 0,
    originProjectId: undefined,
  };
  return {
    name: project.displayName,
    asset: shape,
    edits: edits.map(({ id: _edit, ...edit }) => edit),
    media: source.media.kind,
    provenance,
  };
}

describe('Quick Edit (REQ-EDIT-008)', () => {
  it('makes the chosen file a project named after it, imports it and opens it in the editor', async () => {
    const window = await projectWorld().window();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));

    expect(await window.runAndHear('file.quick-edit')).toBe(
      '"Harbour" is imported and open. It is kept in a project of its own, "Harbour".',
    );

    const state = stateOf(window);
    const [asset] = state.project.assets.values();
    if (asset === undefined) throw new Error('No asset was imported.');
    expect(state.project.displayName).toBe('Harbour');
    expect(asset.sampleRate).toBe(44_100);
    const panel = window.context.editorViews.get().focused;
    expect(panel === undefined ? undefined : window.context.editorViews.entry(panel)?.asset).toBe(
      assetEntryId(asset.id),
    );
    const open = window.projects.project.get();
    expect(window.projects.quickEdit.get()).toEqual({
      project: open.kind === 'open' ? open.snapshot.project : undefined,
      asset: asset.id,
      fileName: 'Harbour.wav',
    });
  });

  it('makes the same project, asset and edits as Project Mode does', async () => {
    const quick = await projectWorld().window();
    quick.files.mediaFiles.push(chosen(HARBOUR_WAV));
    await quick.runAndHear('file.quick-edit');
    const project = await projectWorld().window();
    await project.runAndHear('file.create-project', { name: 'Harbour' });
    project.context.editorViews.focus('editor');
    project.files.mediaFiles.push(chosen(HARBOUR_WAV));
    await project.runAndHear('file.import-audio');

    for (const window of [quick, project]) {
      await window.runAndHear('edit.gain', { decibels: -6 });
      await window.runAndHear('edit.reverse');
    }

    expect(structureOf(quick)).toEqual(structureOf(project));
    expect(stateOf(quick).project.assets.values().next().value?.edits).toHaveLength(2);
  });

  it('keeps nothing of a file it cannot read, and opens again the project open before', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Earlier' });
    window.files.mediaFiles.push(
      chosen(new TextEncoder().encode('Not a sound at all.'), 'notes.wav'),
    );

    const said = await window.runAndHear('file.quick-edit');

    expect(said).toMatch(/notes\.wav|not.*(read|audio)/iu);
    expect(await projectNames(window)).toEqual(['Earlier']);
    await expect
      .poll(() => window.projects.project.session()?.getSnapshot().model.state.project.displayName)
      .toBe('Earlier');
    expect(window.projects.quickEdit.get()).toBeUndefined();
  });

  it('keeps nothing of a Quick Edit the person cancels', async () => {
    const window = await projectWorld().window();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));

    const heard = window.runAndHear('file.quick-edit');
    await expect.poll(() => window.projects.imports.get().kind).toBe('importing');
    window.run('file.cancel-import');

    expect(await heard).toBe(
      'The Quick Edit of "Harbour.wav" was cancelled, and nothing was kept.',
    );
    expect(await projectNames(window)).toEqual([]);
    expect(window.projects.project.get().kind).toBe('none');
  });

  it('forgets the Quick Edit once another project is opened', async () => {
    const window = await projectWorld().window();
    window.files.mediaFiles.push(chosen(HARBOUR_WAV));
    await window.runAndHear('file.quick-edit');

    await window.runAndHear('file.create-project', { name: 'Other' });

    expect(window.projects.quickEdit.get()).toBeUndefined();
  });

  it('says nothing and makes nothing when the person dismisses the chooser', async () => {
    const window = await projectWorld().window();

    expect(window.run('file.quick-edit').kind).toBe('applied');
    // A task runs once every promise the dismissal settled has run its callbacks.
    await new Promise((settled) => setTimeout(settled, 0));

    expect(await projectNames(window)).toEqual([]);
  });
});
