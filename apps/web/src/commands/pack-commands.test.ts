import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { memorySource } from '@audiogubbins/media-store/testing';
import type { DomainResult } from '@audiogubbins/domain';
import {
  manifestJson,
  packKey,
  refOf,
  type FileRange,
  type ModelPackManifest,
  type PackSource,
  type ReceiveChunk,
} from '@audiogubbins/model-packs';
import {
  MemorySource,
  sampleManifest,
  type RecordedRead,
  type SourceOptions,
  type TestPack,
} from '@audiogubbins/model-packs/testing';
import type { DirectoryReader } from '@audiogubbins/storage';

import { buildShellContext } from '../testing/shell-context.js';
import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import {
  holdPlatformFiles,
  rackedWithDeepFilterNet,
  windowWithAudio,
} from '../testing/project-audio.js';
import { sine } from '@audiogubbins/test-fixtures';

holdPlatformFiles();

/**
 * Managing model packs through the shell's commands (REQ-AUDIO-139,
 * ADR-0062), over a window's own storage worker in memory, whose catalogue is
 * packs in memory: the catalogue is asked for only by the command that asks,
 * and every step is the installer's, each said once it settles.
 */

/** Bytes that differ from place to place, so a misplaced run shows. */
function patterned(length: number, seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + seed * 17) % 251);
}

/** A pack of two files of `bytes` each, whose manifest states their real lengths and hashes. */
function testPack(id: string, name: string, version = '1.0.0', bytes = 3_000): TestPack {
  const files = new Map([
    ['encoder.onnx', patterned(bytes, 1)],
    ['decoder.onnx', patterned(bytes, 2)],
  ]);
  const manifest: ModelPackManifest = {
    ...sampleManifest({
      id,
      version,
      processors: [id],
      files: [...files].map(([path, content]) => ({
        path,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      })),
    }),
    name,
  };
  return { manifest, files };
}

const DENOISER = testPack('denoiser', 'Denoiser');
const SEPARATOR = testPack('separator', 'Separator');

/**
 * The folder a pack build writes for `pack`, as the person chooses it: its
 * manifest and its files, each read recorded from the offset it starts at.
 */
function folderOf(pack: TestPack): DirectoryReader & { readonly reads: RecordedRead[] } {
  const files = new Map<string, Uint8Array>([
    ['manifest.json', new TextEncoder().encode(JSON.stringify(manifestJson(pack.manifest)))],
    ...pack.files,
  ]);
  const reads: RecordedRead[] = [];
  return {
    reads,
    list: () => Promise.resolve([...files].map(([path, bytes]) => ({ path, size: bytes.length }))),
    open: (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) return Promise.resolve(undefined);
      const source = memorySource(bytes);
      return Promise.resolve({
        size: source.size,
        read: (offset: number, length: number, signal?: AbortSignal) => {
          if (path !== 'manifest.json' && !reads.some((one) => one.path === path)) {
            reads.push({ path, offset });
          }
          return source.read(offset, length, signal);
        },
      });
    },
  };
}

/** A window whose storage worker downloads from `source`. */
async function windowOver(source: PackSource): Promise<ProjectWindow> {
  return await projectWorld(undefined, () => source).window();
}

/** The state the window's manager holds of `pack`, as its kind. */
function stateOf(window: ProjectWindow, pack: TestPack): string | undefined {
  const key = packKey(refOf(pack.manifest));
  return window.packs.get().installations.find((one) => packKey(one.ref) === key)?.state.kind;
}

/** The arguments that name `pack`. */
function named(pack: TestPack) {
  return { id: pack.manifest.id, version: pack.manifest.version };
}

/** Runs the catalogue's command, and settles with what it said. */
async function catalogueRead(window: ProjectWindow): Promise<string> {
  return await window.runAndHear('packs.refresh-catalogue');
}

/** Settles once `signal` aborts. */
function stopped(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) resolve();
    signal?.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Packs in memory, whose first download holds once `holdAt` bytes of it have
 * arrived, until the installer stops it, so a test pauses or cancels it at a
 * place it knows rather than racing it.
 */
class HoldingSource implements PackSource {
  readonly packs: MemorySource;
  /** Settles once the first download holds. */
  readonly holding: Promise<void>;
  private readonly holdAt: number;
  private served = 0;
  private held = false;
  private hold: () => void = () => undefined;

  constructor(packs: readonly TestPack[], holdAt: number, options: SourceOptions = {}) {
    this.packs = new MemorySource(packs, { chunkBytes: 50, ...options });
    this.holdAt = holdAt;
    this.holding = new Promise((resolve) => {
      this.hold = resolve;
    });
  }

  catalogue(): Promise<DomainResult<readonly ModelPackManifest[]>> {
    return this.packs.catalogue();
  }

  read(range: FileRange, receive: ReceiveChunk, signal?: AbortSignal): Promise<DomainResult<void>> {
    return this.packs.read(
      range,
      async (chunk) => {
        const taken = await receive(chunk);
        this.served += chunk.length;
        if (!this.held && this.served >= this.holdAt) {
          this.held = true;
          this.hold();
          await stopped(signal);
        }
        return taken;
      },
      signal,
    );
  }
}

describe('managing model packs', { timeout: 30_000 }, () => {
  it('asks the catalogue nothing until asked, and then lists what it offers', async () => {
    const source = new MemorySource([DENOISER, SEPARATOR]);
    const window = await windowOver(source);
    window.packs.subscribe(() => undefined);

    expect(source.catalogues).toBe(0);
    expect(window.packs.get().catalogue.kind).toBe('unasked');
    expect(await catalogueRead(window)).toBe('The catalogue offers 2 model pack versions.');
    expect(source.catalogues).toBe(1);
    const { catalogue } = window.packs.get();
    expect(catalogue.kind === 'read' ? catalogue.packs.map((one) => one.name) : []).toEqual([
      'Denoiser',
      'Separator',
    ]);
  });

  it('installs a version the catalogue offers, every file checked, and says so', async () => {
    const window = await windowOver(new MemorySource([DENOISER]));
    await catalogueRead(window);

    expect(await window.runAndHear('packs.install', named(DENOISER))).toBe(
      'Downloading Denoiser 1.0.0.',
    );
    expect(await window.nextSaid()).toBe(
      'Installed Denoiser 1.0.0. Every file matched its SHA-256.',
    );
    await expect.poll(() => stateOf(window, DENOISER)).toBe('installed');
    const read = await window.services.client.packs.read(refOf(DENOISER.manifest), 'decoder.onnx');
    expect([...expectSuccess(read).bytes]).toEqual([...patterned(3_000, 2)]);
  });

  it('pauses a download where it is and resumes it from what was kept', async () => {
    const source = new HoldingSource([DENOISER], 1_000);
    const window = await windowOver(source);
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(DENOISER));
    await source.holding;

    // With nothing named, the one download there is.
    await expect.poll(() => stateOf(window, DENOISER)).toBe('downloading');
    window.run('packs.pause');

    expect(await window.nextSaid()).toBe('Paused Denoiser 1.0.0, with 1,000 bytes of 5.9 kB kept.');
    expect(stateOf(window, DENOISER)).toBe('paused');
    expect(await window.runAndHear('packs.resume')).toBe('Resuming Denoiser 1.0.0.');
    expect(await window.nextSaid()).toBe(
      'Installed Denoiser 1.0.0. Every file matched its SHA-256.',
    );
    expect(source.packs.reads.filter((read) => read.offset > 0)).toEqual([
      { path: 'encoder.onnx', offset: 1_000 },
    ]);
  });

  it('cancels a download, keeping nothing of it', async () => {
    const source = new HoldingSource([DENOISER], 1_000);
    const window = await windowOver(source);
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(DENOISER));
    await source.holding;

    window.run('packs.cancel', named(DENOISER));

    expect(await window.nextSaid()).toBe('Cancelled Denoiser 1.0.0. Nothing of it is kept.');
    await expect.poll(() => stateOf(window, DENOISER)).toBeUndefined();
    expect(expectSuccess(await window.services.client.packs.installations())).toEqual([]);
  });

  it('retries a failed download from what it kept', async () => {
    const source = new MemorySource([DENOISER], {
      chunkBytes: 50,
      breakAt: { path: 'decoder.onnx', afterBytes: 500 },
    });
    const window = await windowOver(source);
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(DENOISER));

    expect(await window.nextSaid()).toBe(
      'Denoiser 1.0.0 could not be installed. The test broke it.',
    );
    expect(await window.runAndHear('packs.retry')).toBe('Trying Denoiser 1.0.0 again.');
    expect(await window.nextSaid()).toBe(
      'Installed Denoiser 1.0.0. Every file matched its SHA-256.',
    );
  });

  it('keeps a version a project needs, says which, and removes it only knowingly', async () => {
    const needed = testPack('deepfilternet-3', 'DeepFilterNet 3');
    const world = projectWorld(undefined, () => new MemorySource([needed]));
    const audio = await windowWithAudio({ world, fixture: sine(440, { length: 4_800 }) });
    const { window } = audio;
    await rackedWithDeepFilterNet(audio);
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(needed));
    await window.nextSaid();

    expect(await window.runAndHear('packs.remove', named(needed))).toBe(
      'A project needs deepfilternet-3@1.0.0, so it is kept until it is removed knowingly.',
    );
    expect(window.packs.get().needed.get('deepfilternet-3@1.0.0')).toBe(
      'A project needs deepfilternet-3@1.0.0, so it is kept until it is removed knowingly.',
    );
    expect(stateOf(window, needed)).toBe('installed');

    expect(await window.runAndHear('packs.remove', { ...named(needed), knowingly: true })).toBe(
      'Removed DeepFilterNet 3 1.0.0. The processors that need it cannot run until it is installed again.',
    );
    await expect.poll(() => stateOf(window, needed)).toBeUndefined();
    expect(window.packs.get().needed.size).toBe(0);
  });

  it(
    'imports a pack from the folder the person chooses, fetching nothing',
    { tags: ['ml-locality'] },
    async () => {
      const source = new MemorySource([]);
      const window = await windowOver(source);
      window.files.foldersToRead.push(folderOf(DENOISER));

      window.run('packs.import');

      expect(await window.nextSaid()).toBe(
        'Installed Denoiser 1.0.0. Every file matched its SHA-256.',
      );
      expect(source.catalogues).toBe(0);
      expect(source.reads).toEqual([]);
      await expect.poll(() => stateOf(window, DENOISER)).toBe('installed');
    },
  );

  it('finishes from a folder a download that was paused, from what it kept', async () => {
    const source = new HoldingSource([DENOISER], 1_000);
    const window = await windowOver(source);
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(DENOISER));
    await source.holding;
    window.run('packs.pause', named(DENOISER));
    await window.nextSaid();
    const folder = folderOf(DENOISER);
    window.files.foldersToRead.push(folder);

    window.run('packs.import');

    expect(await window.nextSaid()).toBe(
      'Installed Denoiser 1.0.0. Every file matched its SHA-256.',
    );
    expect(folder.reads).toEqual([
      { path: 'encoder.onnx', offset: 1_000 },
      { path: 'decoder.onnx', offset: 0 },
    ]);
  });

  it('follows each change in place: a download moves its own version and no other', async () => {
    const source = new HoldingSource([DENOISER, SEPARATOR], 8_000);
    const window = await windowOver(source);
    window.packs.subscribe(() => undefined);
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(DENOISER));
    await window.nextSaid();
    const installed = window.packs.get().installations.find((one) => one.ref.id === 'denoiser');
    const listed = window.packs.get().installations;

    await window.runAndHear('packs.install', named(SEPARATOR));
    await source.holding;
    await expect.poll(() => stateOf(window, SEPARATOR)).toBe('downloading');

    expect(installed?.state.kind).toBe('installed');
    expect(window.packs.get().installations).not.toBe(listed);
    expect(window.packs.get().installations.find((one) => one.ref.id === 'denoiser')).toBe(
      installed,
    );
    window.run('packs.cancel');
    expect(await window.nextSaid()).toBe('Cancelled Separator 1.0.0. Nothing of it is kept.');
  });

  it('refuses each step run a second time, where it would change nothing', async () => {
    const window = await windowOver(new MemorySource([DENOISER]));
    await catalogueRead(window);
    await window.runAndHear('packs.install', named(DENOISER));
    await window.nextSaid();
    await expect.poll(() => stateOf(window, DENOISER)).toBe('installed');

    expect(await window.runAndHear('packs.install', named(DENOISER))).toBe(
      'Downloading Denoiser 1.0.0.',
    );
    expect(await window.nextSaid()).toBe(
      'A pack that is installed cannot take start: only a pack not yet kept, or one queued, starts a download.',
    );
    for (const id of ['packs.pause', 'packs.cancel']) {
      expect(await window.runAndHear(id, named(DENOISER))).toBe(
        id === 'packs.pause'
          ? 'Nothing of denoiser@1.0.0 is being transferred.'
          : 'A pack that is installed cannot take cancel: only a download, queued or not, a check or a failure is cancelled.',
      );
    }
    expect(await window.runAndHear('packs.remove', named(DENOISER))).toMatch(/^Removed /u);
    expect(await window.runAndHear('packs.remove', named(DENOISER))).toBe(
      'A pack that is available cannot take remove: only an installed or failed pack is removed.',
    );
    expect(await window.runAndHear('packs.retry', named(DENOISER))).toBe(
      'Trying Denoiser 1.0.0 again.',
    );
    expect(await window.nextSaid()).toBe(
      'A pack that is available cannot take retry: only a failure is retried.',
    );
  });

  it('says from the palette which pack a step needs, and is unavailable where no pack can be kept', async () => {
    const window = await windowOver(new MemorySource([DENOISER]));

    expect(window.run('packs.pause')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'No model pack is downloading or being checked.' }],
    });
    expect(window.run('packs.install')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'Choose a pack to install in the Model packs panel.' }],
    });
    await catalogueRead(window);
    expect(window.run('packs.install', { id: 'denoiser', version: '9.9.9' })).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'The catalogue, as it was last read, does not offer that version. Check the catalogue again.',
        },
      ],
    });

    const { context } = buildShellContext();
    expect(context.packs.unavailable).toBe(
      'This browser cannot keep model packs, so none can be installed, imported or removed here.',
    );
  });
});
