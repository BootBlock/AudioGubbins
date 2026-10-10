import { beforeEach, describe, expect, it } from 'vitest';

import { TrustedFolders, webDigest } from '@audiogubbins/browser-storage';
import {
  FakeDirectoryHandle,
  FakeFileHandle,
  MemoryDatabases,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { FailureKind, failure, sampleRate, type DomainResult } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { PcmDescriptionKind } from '@audiogubbins/audio-engine';
import type { ExportSettings } from '@audiogubbins/import-export';
import { countingTokens } from '@audiogubbins/media-store/testing';

import { regionEntryId } from '../assets/project-entry.js';
import type { ExportDestinationChoice } from '../export/export-types.js';
import { browserExportDestinations } from '../io/export-destinations.js';
import {
  FAKE_ENCODER,
  FAKE_HEAD,
  FAKE_TAIL,
  FakeExportCodecs,
  FakeExportRender,
} from '../testing/export-fakes.js';
import { projectWorld, type ProjectWorld } from '../testing/project-context.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { PageExportControl } from './export-control.js';

holdPlatformFiles();
beforeEach(() => {
  installFakeHandles();
});

const SECOND = 48_000;

/** Six seconds, which the fake encoder writes as a byte a frame between its head and tail. */
const WHOLE_BYTES = FAKE_HEAD.length + 6 * SECOND + FAKE_TAIL.length;

/** Float WAV at the project's rate, named after the asset, or the region with its index. */
function settings(range: ExportSettings['range'], fileName = '{project}'): ExportSettings {
  return {
    format: 'wav',
    encoding: { kind: 'float', bits: 32 },
    sampleRate: expectSuccess(sampleRate(SECOND)),
    channels: { kind: 'keep' },
    dither: { kind: 'none' },
    range,
    metadata: { policy: 'full', edits: [] },
    fileName,
  };
}

/** An export over `audio`'s window, its workers played by fakes, its storage the window's own. */
function exportOver(
  audio: AudioWindow,
  options: { readonly room?: number; readonly refusesDownloads?: boolean } = {},
) {
  const render = new FakeExportRender();
  const codecs = new FakeExportCodecs();
  const downloads: { readonly name: string; readonly file: Blob }[] = [];
  const trusted = new TrustedFolders(new MemoryDatabases(), countingTokens());
  const control = new PageExportControl({
    runner: { host: render.host, planRender: render.planRender },
    codecs,
    exports: audio.window.services.client.exports,
    assets: audio.window.context.assets,
    trusted,
    allowWriting: browserExportDestinations(undefined).allowWriting,
    download: (file, name) => {
      if (options.refusesDownloads === true) throw new Error('Downloads are turned off here');
      downloads.push({ name, file });
    },
    room: () => Promise.resolve(options.room),
    digest: webDigest(crypto.subtle),
    clock: () => ({ epochMilliseconds: 0, utcOffsetMinutes: 0 }),
  });
  const start = (
    range: ExportSettings['range'],
    destination: ExportDestinationChoice,
    fileName?: string,
  ): Promise<DomainResult<string>> =>
    control.start(audio.session, {
      asset: audio.assetId,
      settings: settings(range, fileName),
      destination,
    });
  return { control, render, codecs, downloads, trusted, start };
}

async function bytesIn(folder: FakeDirectoryHandle, name: string): Promise<number> {
  return (await (await folder.getFileHandle(name)).getFile()).size;
}

async function namesIn(folder: FakeDirectoryHandle): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const entry of folder.values()) names.push(entry.name);
  return names.sort();
}

/** The parts of every export the world's storage holds staged. */
function stagedParts(world: ProjectWorld): readonly string[] {
  return world.tree.paths().filter((path) => /\/export-[^/]*\.(head|body|tail)$/u.test(path));
}

/** The job of the held export that waits, by its id. */
function waitingJob(control: PageExportControl): string {
  const state = control.get();
  if (state.kind !== 'held') throw new Error(`The export is ${state.kind}, not held.`);
  const job = state.batch.jobs.find((one) => one.state.kind === 'staged');
  if (job === undefined) throw new Error('No file waits.');
  return job.id;
}

describe('the page export (ADR-0092)', () => {
  it('renders the asset as it is heard, and delivers the whole file into a folder, recorded with its encoder', async () => {
    const audio = await windowWithAudio();
    const { start, render, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', []);

    const said = expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'prompt' }),
    );

    expect(said).toBe('“Harbour.wav” is exported.');
    const [request] = render.requests;
    const { owner } = audio.asset();
    expect(request?.sources[0]).toMatchObject({
      kind: PcmDescriptionKind.Edited,
      plan: owner.kind === 'project' ? owner.plan : undefined,
    });
    expect(request?.range).toEqual({ start: 0, length: 6 * SECOND });
    expect(await bytesIn(folder, 'Harbour.wav')).toBe(WHOLE_BYTES);
    const [record] = audio.session.getSnapshot().model.exports;
    expect(record?.file).toMatchObject({
      fileName: 'Harbour.wav',
      codec: FAKE_ENCODER,
      reproducible: true,
    });
    expect(control.get()).toMatchObject({ kind: 'ended', said });
  });

  it("says the render's own failure where it fails, and keeps nothing of the file", async () => {
    const audio = await windowWithAudio();
    const { start, render, control } = exportOver(audio);
    render.refusal = failure(
      'render.source-unreadable',
      FailureKind.Unrecoverable,
      'The source could not be read.',
    );
    const folder = new FakeDirectoryHandle('Game sounds', []);

    expect(
      expectSuccess(
        await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'prompt' }),
      ),
    ).toBe('1 file could not be exported: The source could not be read.');
    expect(control.get().kind).toBe('ended');
    expect(await namesIn(folder)).toEqual([]);
    expect(audio.session.getSnapshot().model.exports).toEqual([]);
  });

  it('refuses a codec this browser cannot write with before anything renders, naming what serves instead', async () => {
    const audio = await windowWithAudio();
    const { control, render } = exportOver(audio);
    const refused = await control.start(audio.session, {
      asset: audio.assetId,
      settings: { ...settings({ kind: 'project' }), format: 'aac', encoding: { bitRate: 256 } },
      destination: { kind: 'download' },
    });

    expect(expectFailureCode(refused)).toBe('export.codec-unavailable');
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(/instead\.$/u);
    expect(render.requests).toEqual([]);
    expect(control.get().kind).toBe('idle');
  });

  it('refuses before anything renders where the storage has too little room, naming the room needed and free', async () => {
    const audio = await windowWithAudio();
    const { start, render } = exportOver(audio, { room: 1_000 });
    const refused = await start({ kind: 'project' }, { kind: 'download' });

    expect(expectFailureCode(refused)).toBe('export.no-room');
    expect(refused.ok ? '' : refused.failures[0].summary).toMatch(
      /needs up to .+ of storage while it is made, and .+ is free/u,
    );
    expect(render.requests).toEqual([]);
  });

  it('keeps a file whose delivery lost its leave to write, and retries it with no new render', async () => {
    const audio = await windowWithAudio();
    const { start, render, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const gate = render.hold();
    const running = start(
      { kind: 'project' },
      { kind: 'folder', handle: folder, policy: 'prompt' },
    );
    await gate.reached;
    // The browser takes its leave back while the file is made.
    folder.permission.state = 'prompt';
    gate.open();

    expect(expectSuccess(await running)).toMatch(/could not be delivered/u);
    expect(control.get().kind).toBe('held');
    expect(await namesIn(folder)).toEqual([]);

    expect(expectSuccess(await control.retry(audio.session, waitingJob(control)))).toBe(
      '“Harbour.wav” is exported.',
    );
    expect(await bytesIn(folder, 'Harbour.wav')).toBe(WHOLE_BYTES);
    expect(render.requests).toHaveLength(1);
  });

  it('delivers a held file to another destination with no new render', async () => {
    const audio = await windowWithAudio();
    const { start, render, control } = exportOver(audio);
    const taken = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    const running = start({ kind: 'project' }, { kind: 'folder', handle: taken, policy: 'skip' });

    expect(expectSuccess(await running)).toMatch(/could not be delivered/u);
    const other = new FakeDirectoryHandle('Elsewhere', []);
    expect(
      expectSuccess(
        await control.deliverElsewhere(audio.session, waitingJob(control), {
          kind: 'folder',
          handle: other,
          policy: 'prompt',
        }),
      ),
    ).toBe('“Harbour.wav” is exported.');
    expect(await bytesIn(other, 'Harbour.wav')).toBe(WHOLE_BYTES);
    expect(await bytesIn(taken, 'Harbour.wav')).toBe(3);
    expect(render.requests).toHaveLength(1);
  });

  it('asks about a taken name, and holds an answer given for the rest of the batch', async () => {
    const audio = await windowWithAudio({
      regions: [
        { name: 'Waves', start: 0, end: SECOND },
        { name: 'Gulls', start: 2 * SECOND, end: 3 * SECOND },
      ],
    });
    const { start, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Waves.wav')),
      new FakeFileHandle(new File(['old'], 'Gulls.wav')),
    ]);
    const asked: string[] = [];
    const stop = control.subscribe(() => {
      const state = control.get();
      if (state.kind !== 'running' || state.asking === undefined) return;
      asked.push(state.asking);
      control.answerCollision({ answer: 'rename', applyToAll: true });
    });
    const said = expectSuccess(
      await start(
        { kind: 'every-region' },
        { kind: 'folder', handle: folder, policy: 'prompt' },
        '{region}',
      ),
    );
    stop();

    expect(asked).toEqual(['Waves.wav']);
    expect(said).toBe('2 files are exported.');
    expect(await namesIn(folder)).toEqual([
      'Gulls (2).wav',
      'Gulls.wav',
      'Waves (2).wav',
      'Waves.wav',
    ]);
    expect(await bytesIn(folder, 'Waves (2).wav')).toBe(
      FAKE_HEAD.length + SECOND + FAKE_TAIL.length,
    );
  });

  it('renders a region from its own plan, from its first frame', async () => {
    const audio = await windowWithAudio({
      regions: [{ name: 'Waves', start: SECOND, end: 3 * SECOND }],
    });
    const { start, render } = exportOver(audio);
    const region = audio.asset().regions[0];
    if (region === undefined) throw new Error('The region is placed.');
    const folder = new FakeDirectoryHandle('Game sounds', []);
    expectSuccess(
      await start(
        { kind: 'region', region: region.id },
        { kind: 'folder', handle: folder, policy: 'prompt' },
        '{region}',
      ),
    );

    const entry = audio.window.context.assets.find(regionEntryId(region.id));
    const [request] = render.requests;
    expect(request?.range).toEqual({ start: 0, length: 2 * SECOND });
    expect(request?.sources[0]).toMatchObject({
      plan: entry?.owner.kind === 'project' ? entry.owner.plan : undefined,
    });
  });

  it('skips the file where the question is dismissed, and holds it', async () => {
    const audio = await windowWithAudio();
    const { start, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    const stop = control.subscribe(() => {
      const state = control.get();
      if (state.kind === 'running' && state.asking !== undefined)
        control.answerCollision(undefined);
    });
    const said = expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'prompt' }),
    );
    stop();

    expect(said).toMatch(/“Harbour.wav” could not be delivered/u);
    expect(control.get().kind).toBe('held');
    expect(await bytesIn(folder, 'Harbour.wav')).toBe(3);
  });

  it('keeps nothing of an export cancelled while it renders, and leaves the folder as it was', async () => {
    const audio = await windowWithAudio();
    const { start, render, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const gate = render.hold();
    const running = start(
      { kind: 'project' },
      { kind: 'folder', handle: folder, policy: 'prompt' },
    );
    await gate.reached;
    expect(control.cancel()).toBe(true);
    gate.open();

    expect(expectSuccess(await running)).toBe('1 file was cancelled, and nothing of it was kept.');
    expect(control.get()).toMatchObject({ kind: 'ended' });
    expect(await namesIn(folder)).toEqual([]);
    expect(audio.session.getSnapshot().model.exports).toEqual([]);
  });

  it('gives up a held file when the export is cancelled', async () => {
    const world = projectWorld();
    const audio = await windowWithAudio({ world });
    const { start, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'skip' }),
    );
    const job = waitingJob(control);
    expect(stagedParts(world)).toHaveLength(3);

    expect(control.cancel()).toBe(true);
    await expect.poll(() => control.get().kind).toBe('ended');
    expect(stagedParts(world)).toEqual([]);
    expect(expectFailureCode(await control.retry(audio.session, job))).toBe('export.not-held');
    expect(await bytesIn(folder, 'Harbour.wav')).toBe(3);
  });

  it('shows a second export running once the first has ended', async () => {
    const audio = await windowWithAudio();
    const { start, control } = exportOver(audio);
    expectSuccess(await start({ kind: 'project' }, { kind: 'download' }));
    const kinds: string[] = [];
    const stop = control.subscribe(() => {
      kinds.push(control.get().kind);
    });
    const folder = new FakeDirectoryHandle('Game sounds', []);
    expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'prompt' }),
    );
    stop();

    expect(kinds[0]).toBe('running');
    expect(kinds.at(-1)).toBe('ended');
  });

  it('refuses a second export while one is held', async () => {
    const audio = await windowWithAudio();
    const { start } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', [
      new FakeFileHandle(new File(['old'], 'Harbour.wav')),
    ]);
    expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'skip' }),
    );

    expect(expectFailureCode(await start({ kind: 'project' }, { kind: 'download' }))).toBe(
      'export.busy',
    );
  });

  it('hands a download over whole, and gives its staging up once the next export begins', async () => {
    const world = projectWorld();
    const audio = await windowWithAudio({ world });
    const { start, downloads } = exportOver(audio);

    expect(expectSuccess(await start({ kind: 'project' }, { kind: 'download' }))).toBe(
      '“Harbour.wav” is exported.',
    );
    const [download] = downloads;
    expect(download?.name).toBe('Harbour.wav');
    expect(download?.file.size).toBe(WHOLE_BYTES);
    expect(download?.file.type).toBe('audio/wav');
    const [record] = audio.session.getSnapshot().model.exports;
    expect(record?.destination.kind).toBe('download');
    // The browser may still be reading it, so it stays staged until the next export.
    expect(stagedParts(world)).toHaveLength(3);

    const folder = new FakeDirectoryHandle('Game sounds', []);
    expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'prompt' }),
    );
    expect(stagedParts(world)).toEqual([]);
  });

  it('fails the file a browser will not download, and is free for the next export', async () => {
    const audio = await windowWithAudio();
    const { start, control } = exportOver(audio, { refusesDownloads: true });

    expect(expectSuccess(await start({ kind: 'project' }, { kind: 'download' }))).toBe(
      "1 file could not be exported: The export's download stopped: Downloads are turned off here.",
    );
    expect(control.get().kind).toBe('ended');
    const folder = new FakeDirectoryHandle('Game sounds', []);
    expectSuccess(
      await start({ kind: 'project' }, { kind: 'folder', handle: folder, policy: 'prompt' }),
    );
  });

  it('replaces, without asking, a file it exported earlier into a trusted folder', async () => {
    const audio = await windowWithAudio();
    const { start, trusted, control } = exportOver(audio);
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const key = await trusted.trust(folder);
    const asked: string[] = [];
    control.subscribe(() => {
      const state = control.get();
      if (state.kind === 'running' && state.asking !== undefined) {
        asked.push(state.asking);
        control.answerCollision(undefined);
      }
    });
    const destination = { kind: 'trusted-folder', key, policy: 'prompt' } as const;

    expectSuccess(await start({ kind: 'project' }, destination));
    expect(expectSuccess(await start({ kind: 'project' }, destination))).toBe(
      '“Harbour.wav” is exported.',
    );
    expect(asked).toEqual([]);
    expect(await namesIn(folder)).toEqual(['Harbour.wav']);
  });
});
