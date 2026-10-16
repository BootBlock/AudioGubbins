import { beforeEach, describe, expect, it } from 'vitest';

import { TrustedFolders, webDigest } from '@audiogubbins/browser-storage';
import {
  FakeDirectoryHandle,
  MemoryDatabases,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { planExport, type ExportSettings, type PlannedFile } from '@audiogubbins/import-export';
import { countingTokens } from '@audiogubbins/media-store/testing';
import { sine } from '@audiogubbins/test-fixtures';

import { browserExportDestinations } from '../io/export-destinations.js';
import { FakeExportCodecs, FakeExportRender } from '../testing/export-fakes.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { exportContextOf, servedCodecs } from './export-context.js';
import { PageExportControl } from './export-control.js';
import type { PlannedExportFile } from './export-types.js';

holdPlatformFiles();
beforeEach(() => {
  installFakeHandles();
});

const SECOND = 48_000;
const CLOCK = { epochMilliseconds: 0, utcOffsetMinutes: 0 };

/** WAV of `bits` bits at the project's rate over `range`, named `fileName`. */
function settings(range: ExportSettings['range'], bits: 16 | 24, fileName: string): ExportSettings {
  return {
    format: 'wav',
    encoding: { kind: 'integer', bits },
    sampleRate: expectSuccess(sampleRate(SECOND)),
    channels: { kind: 'keep' },
    dither: { kind: 'none' },
    range,
    metadata: { policy: 'full', edits: [] },
    fileName,
  };
}

/** A second of a tone with two regions, and an export over its window played by fakes. */
async function twoRegions() {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: SECOND }),
    name: 'Tone',
    regions: [
      { name: 'Step one', start: 0, end: 12_000 },
      { name: 'Step two', start: 12_000, end: 24_000 },
    ],
  });
  const codecs = new FakeExportCodecs();
  const render = new FakeExportRender();
  const control = new PageExportControl({
    runner: { host: render.host, planRender: render.planRender },
    codecs,
    exports: audio.window.services.client.exports,
    assets: audio.window.context.assets,
    trusted: new TrustedFolders(new MemoryDatabases(), countingTokens()),
    allowWriting: browserExportDestinations(undefined).allowWriting,
    download: () => undefined,
    room: () => Promise.resolve(undefined),
    digest: webDigest(crypto.subtle),
    clock: () => CLOCK,
  });
  return { audio, codecs, control };
}

/** The one file `settings` plans of `audio`'s asset. */
function plannedOf(audio: AudioWindow, of: ExportSettings): PlannedFile {
  const state = audio.session.getSnapshot().model.state;
  const context = expectSuccess(
    exportContextOf(audio.asset(), state, servedCodecs(new FakeExportCodecs().environment)),
  );
  const [file] = expectSuccess(planExport(of, context, CLOCK));
  if (file === undefined) throw new Error('The settings plan a file.');
  return file;
}

/** The names in the folder `path` leads to from `folder`, sorted. */
async function namesIn(
  folder: FakeDirectoryHandle,
  path: readonly string[] = [],
): Promise<readonly string[]> {
  let at = folder;
  for (const name of path) {
    let inner: FakeDirectoryHandle | undefined;
    for await (const child of at.values()) {
      if (child instanceof FakeDirectoryHandle && child.name === name) inner = child;
    }
    if (inner === undefined) throw new Error(`There is no folder ${name}.`);
    at = inner;
  }
  const names: string[] = [];
  for await (const child of at.values()) names.push(child.name);
  return names.sort();
}

describe('an export of files planned each with its own settings (ADR-0102)', () => {
  it('encodes each file by its own settings, delivers it into its own folder, and records the folder', async () => {
    const { audio, codecs, control } = await twoRegions();
    const [one, two] = [...audio.session.getSnapshot().model.state.project.regions.values()];
    if (one === undefined || two === undefined) throw new Error('The asset has two regions.');
    const first = settings({ kind: 'region', region: one.id }, 16, 'step_1');
    const second = settings({ kind: 'region', region: two.id }, 24, 'step_2');
    const files: [PlannedExportFile, PlannedExportFile] = [
      {
        asset: audio.assetId,
        settings: first,
        file: plannedOf(audio, first),
        folder: ['sfx', 'Steps'],
      },
      { asset: audio.assetId, settings: second, file: plannedOf(audio, second), folder: [] },
    ];
    const folder = new FakeDirectoryHandle('Game sounds', []);

    expectSuccess(
      await control.start(audio.session, {
        files,
        destination: { kind: 'folder', handle: folder, policy: 'prompt' },
      }),
    );

    expect(codecs.requests.map((request) => request.encoding.encoding)).toEqual([
      { kind: 'integer', bits: 16 },
      { kind: 'integer', bits: 24 },
    ]);
    expect(await namesIn(folder)).toEqual(['sfx', 'step_2.wav']);
    expect(await namesIn(folder, ['sfx', 'Steps'])).toEqual(['step_1.wav']);
    const records = audio.session.getSnapshot().model.exports;
    expect(records.map((record) => record.file?.fileName)).toEqual(['step_1.wav', 'step_2.wav']);
    expect(records.map((record) => record.file?.folder)).toEqual([
      { segments: ['sfx', 'Steps'] },
      undefined,
    ]);
    expect(records.map((record) => record.file?.settings)).toEqual([first, second]);
    const ended = control.get();
    if (ended.kind !== 'ended') throw new Error(`The export is ${ended.kind}.`);
    expect([...ended.settings.values()]).toEqual([first, second]);
    // A group export keeps the project's last export settings as they were.
    expect(audio.session.getSnapshot().model.state.exportSettings).toBeUndefined();
  });

  it('refuses several planned files for a save dialog’s one file, before anything renders', async () => {
    const { audio, codecs, control } = await twoRegions();
    const whole = settings({ kind: 'project' }, 16, 'whole');
    const file: PlannedExportFile = {
      asset: audio.assetId,
      settings: whole,
      file: plannedOf(audio, whole),
      folder: [],
    };
    const handle = await new FakeDirectoryHandle('Game sounds', []).getFileHandle('x.wav', {
      create: true,
    });

    const refused = await control.start(audio.session, {
      files: [file, file],
      destination: { kind: 'file', handle },
    });

    expect(refused.ok).toBe(false);
    expect(codecs.requests).toEqual([]);
  });
});
