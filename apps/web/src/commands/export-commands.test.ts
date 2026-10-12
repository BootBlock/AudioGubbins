import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakeDirectoryHandle,
  FakeFileHandle,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExportSettings } from '@audiogubbins/import-export';
import { activePanelOf, PanelKinds } from '@audiogubbins/workspace';

import type { ExportControl, ExportDestinationChoice } from '../export/export-types.js';
import { FAKE_HEAD, FAKE_TAIL } from '../testing/export-fakes.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { ExportCommand } from './import-export-ids.js';

holdPlatformFiles();
beforeEach(() => {
  installFakeHandles();
});

const SECOND = 48_000;
const WHOLE_BYTES = FAKE_HEAD.length + 6 * SECOND + FAKE_TAIL.length;

const SETTINGS: ExportSettings = {
  format: 'wav',
  encoding: { kind: 'float', bits: 32 },
  sampleRate: expectSuccess(sampleRate(SECOND)),
  channels: { kind: 'keep' },
  dither: { kind: 'none' },
  range: { kind: 'project' },
  metadata: { policy: 'full', edits: [] },
  fileName: '{project}',
};

function exportsOf(audio: AudioWindow): ExportControl {
  const { exports } = audio.window.context;
  if (exports === undefined) throw new Error('The window keeps projects, so it exports.');
  return exports;
}

/** Exports the asset to `destination`, answering any question with the command as `answer` asks. */
async function exported(
  audio: AudioWindow,
  destination: ExportDestinationChoice,
  answer?: Record<string, string | boolean>,
): Promise<string> {
  const exports = exportsOf(audio);
  const stop = exports.subscribe(() => {
    const state = exports.get();
    if (state.kind === 'running' && state.asking !== undefined) {
      audio.window.run(ExportCommand.AnswerCollision, answer);
    }
  });
  try {
    return expectSuccess(
      await exports.start(audio.session, { asset: audio.assetId, settings: SETTINGS, destination }),
    );
  } finally {
    stop();
  }
}

function heldJob(audio: AudioWindow): string {
  const state = exportsOf(audio).get();
  const job =
    state.kind === 'held' ? state.batch.jobs.find((one) => one.state.kind === 'staged') : undefined;
  if (job === undefined) throw new Error('No file is held.');
  return job.id;
}

async function sizeIn(folder: FakeDirectoryHandle, name: string): Promise<number> {
  return (await (await folder.getFileHandle(name)).getFile()).size;
}

describe('the export commands (ADR-0092, REQ-EDIT-073)', () => {
  it('answers a taken name with the command, keeping both', async () => {
    const audio = await windowWithAudio();
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);

    expect(
      await exported(
        audio,
        { kind: 'folder', handle: folder, policy: 'prompt' },
        {
          answer: 'rename',
          applyToAll: false,
        },
      ),
    ).toBe('“Harbour (2).wav” is exported.');
    expect(await sizeIn(folder, 'Harbour (2).wav')).toBe(WHOLE_BYTES);
  });

  it('skips a file whose question is dismissed, and delivers it into a folder chosen anew with no new render', async () => {
    const audio = await windowWithAudio();
    const taken = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    expect(await exported(audio, { kind: 'folder', handle: taken, policy: 'prompt' })).toMatch(
      /“Harbour.wav” could not be delivered/u,
    );
    const other = new FakeDirectoryHandle('Elsewhere', []);
    audio.window.exporting.destinations.folder = other;

    expect(
      await audio.window.runAndHear(ExportCommand.DeliverElsewhere, {
        job: heldJob(audio),
        to: 'folder',
      }),
    ).toBe('“Harbour.wav” is exported.');
    expect(await sizeIn(other, 'Harbour.wav')).toBe(WHOLE_BYTES);
    expect(await sizeIn(taken, 'Harbour.wav')).toBe(3);
    expect(audio.window.exporting.render.requests).toHaveLength(1);
  });

  it('saves a held file through a save dialog, suggesting its name', async () => {
    const audio = await windowWithAudio();
    const taken = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    await exported(audio, { kind: 'folder', handle: taken, policy: 'skip' });
    const file = new FakeFileHandle(new File([], 'Chosen.wav'));
    const { destinations } = audio.window.exporting;
    destinations.file = file;

    expect(
      await audio.window.runAndHear(ExportCommand.DeliverElsewhere, { job: heldJob(audio) }),
    ).toBe('“Chosen.wav” is exported.');
    expect(destinations.suggested).toEqual(['Harbour.wav']);
    expect((await file.getFile()).size).toBe(WHOLE_BYTES);
  });

  it('retries a file whose delivery lost its leave to write, asking for it again in the gesture', async () => {
    const audio = await windowWithAudio();
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const gate = audio.window.exporting.render.hold();
    const running = exported(audio, { kind: 'folder', handle: folder, policy: 'prompt' });
    await gate.reached;
    folder.permission.state = 'prompt';
    gate.open();
    expect(await running).toMatch(/could not be delivered/u);

    expect(await audio.window.runAndHear(ExportCommand.Retry, { job: heldJob(audio) })).toBe(
      '“Harbour.wav” is exported.',
    );
    expect(folder.modesAsked).toContain('readwrite');
    expect(await sizeIn(folder, 'Harbour.wav')).toBe(WHOLE_BYTES);
  });

  it('cancels a held export, giving its file up', async () => {
    const audio = await windowWithAudio();
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    await exported(audio, { kind: 'folder', handle: folder, policy: 'skip' });

    expect(await audio.window.runAndHear(ExportCommand.Cancel)).toBe(
      'The export is cancelled, and the files it kept are given up.',
    );
    await expect.poll(() => exportsOf(audio).get().kind).toBe('ended');
    expect(audio.window.run(ExportCommand.Retry, { job: 'export-1' })).toMatchObject({
      kind: 'refused',
    });
  });

  it('offers nothing to retry, cancel or answer while no export runs', async () => {
    const audio = await windowWithAudio();
    for (const id of [ExportCommand.Retry, ExportCommand.Cancel, ExportCommand.AnswerCollision]) {
      expect(audio.window.run(id, { job: 'export-1', answer: 'skip' })).toMatchObject({
        kind: 'refused',
      });
    }
  });

  it('trusts a folder the person chooses, and lets it go', async () => {
    const audio = await windowWithAudio();
    const folder = new FakeDirectoryHandle('Game sounds', []);
    audio.window.exporting.destinations.folder = folder;
    const { trustedFolders } = audio.window.projects;

    expect(await audio.window.runAndHear(ExportCommand.TrustFolder)).toMatch(
      /^“Game sounds” is trusted/u,
    );
    const state = trustedFolders.get();
    if (state.kind !== 'read') throw new Error(`The list is ${state.kind}.`);
    const [kept] = state.folders;
    expect(kept?.name).toBe('Game sounds');

    expect(
      await audio.window.runAndHear(ExportCommand.ForgetFolder, { key: kept?.key ?? '' }),
    ).toBe('“Game sounds” is no longer trusted; nothing in it was changed.');
    expect(trustedFolders.get()).toEqual({ kind: 'read', folders: [] });
    // Let go already, a second time changes nothing, and is refused.
    expect(
      await audio.window.runAndHear(ExportCommand.ForgetFolder, { key: kept?.key ?? '' }),
    ).toBe('No such folder is trusted.');
  });

  it('describes the page’s export in the Inspector only once one has run, bringing the Inspector into view', async () => {
    const audio = await windowWithAudio();
    const { context } = audio.window;
    expect(audio.window.run(ExportCommand.Inspect)).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'No export has run since the page opened.' }],
    });
    expect(context.exportFocus.subject.get()).toBeUndefined();

    await exported(audio, { kind: 'download' });
    expect(audio.window.run(ExportCommand.Inspect).kind).not.toBe('refused');

    expect(context.exportFocus.subject.get()).toEqual({ kind: 'batch' });
    expect(activePanelOf(context.workspace.get().layout)?.kind).toBe(PanelKinds.Inspector);
    // Run again, it would change nothing.
    expect(audio.window.run(ExportCommand.Inspect)).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'The Inspector describes that export already.' }],
    });
  });

  it('describes an export the open project’s history records, and refuses one it does not', async () => {
    const audio = await windowWithAudio();
    const { context } = audio.window;
    await exported(audio, {
      kind: 'folder',
      handle: new FakeDirectoryHandle('Game sounds', []),
      policy: 'prompt',
    });
    const [record] = audio.session.getSnapshot().model.exports;

    expect(
      audio.window.run(ExportCommand.InspectRecord, { record: '0000-0000-0000-dead' }),
    ).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'That export is not in the history of the project open now.' }],
    });
    expect(context.exportFocus.subject.get()).toBeUndefined();

    expect(
      audio.window.run(ExportCommand.InspectRecord, { record: record?.id ?? '' }).kind,
    ).not.toBe('refused');
    expect(context.exportFocus.subject.get()).toEqual({ kind: 'record', record: record?.id });
    expect(activePanelOf(context.workspace.get().layout)?.kind).toBe(PanelKinds.Inspector);
    expect(
      audio.window.run(ExportCommand.InspectRecord, { record: record?.id ?? '' }),
    ).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'The Inspector describes that export already.' }],
    });
    // The page's export is another subject, so it is described in its place.
    expect(audio.window.run(ExportCommand.Inspect).kind).not.toBe('refused');
    expect(context.exportFocus.subject.get()).toEqual({ kind: 'batch' });
  });
});
