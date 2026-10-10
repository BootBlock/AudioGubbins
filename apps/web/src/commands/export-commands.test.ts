import { beforeEach, describe, expect, it } from 'vitest';

import {
  FakeDirectoryHandle,
  FakeFileHandle,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExportSettings } from '@audiogubbins/import-export';

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
      new FakeFileHandle(new File(['old'], 'Loop.wav')),
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
    ).toBe('“Loop (2).wav” is exported.');
    expect(await sizeIn(folder, 'Loop (2).wav')).toBe(WHOLE_BYTES);
  });

  it('skips a file whose question is dismissed, and delivers it into a folder chosen anew with no new render', async () => {
    const audio = await windowWithAudio();
    const taken = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Loop.wav')),
    ]);
    expect(await exported(audio, { kind: 'folder', handle: taken, policy: 'prompt' })).toMatch(
      /“Loop\.wav” could not be delivered/u,
    );
    const other = new FakeDirectoryHandle('Elsewhere', []);
    audio.window.exporting.destinations.folder = other;

    expect(
      await audio.window.runAndHear(ExportCommand.DeliverElsewhere, {
        job: heldJob(audio),
        to: 'folder',
      }),
    ).toBe('“Loop.wav” is exported.');
    expect(await sizeIn(other, 'Loop.wav')).toBe(WHOLE_BYTES);
    expect(await sizeIn(taken, 'Loop.wav')).toBe(3);
    expect(audio.window.exporting.render.requests).toHaveLength(1);
  });

  it('saves a held file through a save dialog, suggesting its name', async () => {
    const audio = await windowWithAudio();
    const taken = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Loop.wav')),
    ]);
    await exported(audio, { kind: 'folder', handle: taken, policy: 'skip' });
    const file = new FakeFileHandle(new File([], 'Chosen.wav'));
    const { destinations } = audio.window.exporting;
    destinations.file = file;

    expect(
      await audio.window.runAndHear(ExportCommand.DeliverElsewhere, { job: heldJob(audio) }),
    ).toBe('“Chosen.wav” is exported.');
    expect(destinations.suggested).toEqual(['Loop.wav']);
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
      '“Loop.wav” is exported.',
    );
    expect(folder.modesAsked).toContain('readwrite');
    expect(await sizeIn(folder, 'Loop.wav')).toBe(WHOLE_BYTES);
  });

  it('cancels a held export, giving its file up', async () => {
    const audio = await windowWithAudio();
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Loop.wav')),
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
  });
});
