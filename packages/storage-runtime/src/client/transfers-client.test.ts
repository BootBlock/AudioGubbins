import { File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import {
  AssetOrigin,
  sampleCount,
  unsafeBrandId,
  type Asset,
  type AssetId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { generatedSource, memorySource, observeFile } from '@audiogubbins/media-store/testing';
import { addAssetInvocation } from '@audiogubbins/project-commands';
import {
  SourceChangePolicy,
  TreeFailure,
  TreeFailureKind,
  storageKeyOf,
  type ByteSink,
  type MediaSource,
} from '@audiogubbins/project-format';
import { exportUnpacked, type CopyOptions } from '@audiogubbins/storage';
import { MemoryDirectory, memorySink } from '@audiogubbins/storage/testing';

import { readPortMessage, type CallOutcome } from '../protocol/port-messages.js';
import { SETTINGS, memoryStorage, type MemoryStorage } from '../testing/memory-storage.js';
import type { PortPair } from '../testing/port-pair.js';
import { projectScene, rename, storedModel, type ProjectScene } from '../testing/project-scene.js';
import type { PageFile } from './page-ports.js';

const WHOLE: CopyOptions = { scope: { kind: 'whole-history' }, includeCaches: false };

const ASSET = unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-000000000001');

/** An asset of the project whose bytes are `media`. */
function assetOf(media: MediaSource): Asset {
  return {
    id: ASSET,
    displayName: 'Rain',
    origin: AssetOrigin.Imported,
    sampleRate: SETTINGS.sampleRate,
    channelLayout: SETTINGS.channelLayout,
    length: expectSuccess(sampleCount(4_800)),
    storageKey: storageKeyOf(ASSET, media),
  };
}

/** A project open to write whose one asset is `size` bytes the store keeps. */
async function withMedia(size: number): Promise<ProjectScene> {
  const scene = await projectScene();
  const { store } = scene.storage.another;
  const { contentId } = expectSuccess(await store.put(generatedSource(size, 7)));
  store.release(contentId);
  const media: MediaSource = {
    kind: 'managed',
    contentId,
    byteLength: size,
    mediaType: 'audio/wav',
  };
  expectSuccess(await scene.session.run(addAssetInvocation(assetOf(media), { media })));
  return scene;
}

/** The operations the worker called on the page, in order. */
function pageCalls(pair: PortPair): string[] {
  return pair.toPage.flatMap((data) => {
    const read = readPortMessage(data);
    return read.ok && read.value.type === 'call' ? [read.value.operation] : [];
  });
}

/** How the worker answered the last call of `operation` the page made, once it has. */
function answerTo(pair: PortPair, operation: string): CallOutcome | undefined {
  const id = pair.toWorker.findLast((data) => {
    const read = readPortMessage(data);
    return read.ok && read.value.type === 'call' && read.value.operation === operation;
  });
  const called = readPortMessage(id);
  if (!called.ok || called.value.type !== 'call') return undefined;
  const { id: asked } = called.value;
  for (const data of pair.toPage) {
    const read = readPortMessage(data);
    if (read.ok && read.value.type === 'answer' && read.value.id === asked)
      return read.value.outcome;
  }
  return undefined;
}

/** A second page with storage of its own, as on another machine. */
function elsewhere(name: string, seed: number): MemoryStorage {
  return memoryStorage({ tab: { name, seed } });
}

function nameIn(storage: MemoryStorage, project: Parameters<typeof storedModel>[1]) {
  return storedModel(storage, project).then(({ state }) => state.project.displayName);
}

// jsdom's `File` clones to a plain object, where a browser clones the file
// itself, so these tests hold the platform's own.
beforeEach(() => {
  vi.stubGlobal('File', PlatformFile);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('taking projects out of the storage worker and bringing them in', () => {
  it('writes a bundle into a sink the page lent, which another page brings in', async () => {
    const { storage, project, session } = await projectScene();
    expectSuccess(await session.run(rename('Harbour')));
    const sink = memorySink();

    const attempt = expectSuccess(
      await storage.client.transfers.exportBundle(project, sink, { ...WHOLE, held: session }),
    );

    expect(expectSuccess(attempt.written).written.entries).toBeGreaterThan(0);
    expect(sink.ending).toBe('closed');
    expect(storage.lentPorts()).toBe(0);
    const other = elsewhere('other', 53);
    const bundle = new File([sink.bytes()], 'Harbour.zip', { type: 'application/zip' });
    const { header } = expectSuccess(
      await other.client.transfers.importBundle({ kind: 'file', file: bundle }, 'original'),
    );
    expect(header.id).toBe(project);
    expect(await nameIn(other, project)).toBe('Harbour');
    expect(pageCalls(other.pair)).toEqual([]);

    const { header: copy } = expectSuccess(
      await storage.client.transfers.importBundle(
        { kind: 'source', source: memorySource(sink.bytes()) },
        'copy',
      ),
    );
    expect(copy.id).not.toBe(project);
    expect(await nameIn(storage, copy.id)).toBe('Harbour');
    expect(pageCalls(storage.pair)).toContain('source.read');
    expect(storage.lentPorts()).toBe(0);
  });

  it('answers a write the page sink refused with that refusal, leaving nothing torn', async () => {
    const { storage, project } = await withMedia(300_000);
    const kept = memorySink();
    let writes = 0;
    const filling: ByteSink = {
      write: async (chunk) => {
        writes += 1;
        if (writes > 1) throw new TreeFailure(TreeFailureKind.Quota, 'The disc is full.');
        await kept.write(chunk);
      },
      close: () => kept.close(),
      abort: () => kept.abort(),
    };

    const attempt = expectSuccess(
      await storage.client.transfers.exportBundle(project, filling, WHOLE),
    );

    expect(attempt.written).toMatchObject({ ok: false, failures: [{ code: 'storage.full' }] });
    expect(writes).toBe(2);
    expect(kept.ending).toBe('aborted');
    expect(storage.lentPorts()).toBe(0);
  });

  it('writes an unpacked tree into a folder the page lent, and reads one from it', async () => {
    const { storage, project, session } = await projectScene();
    expectSuccess(await session.run(rename('Quay')));
    const folder = new MemoryDirectory();

    const attempt = expectSuccess(
      await storage.client.transfers.exportUnpacked(project, folder, { ...WHOLE, held: session }),
    );

    expect(expectSuccess(attempt.written)).toEqual([]);
    expect(storage.lentPorts()).toBe(0);
    const reading = elsewhere('reading', 59);
    const read = await reading.client.transfers.importUnpacked(
      { kind: 'reader', reader: folder },
      'original',
    );
    expect(expectSuccess(read).header.id).toBe(project);
    expect(await nameIn(reading, project)).toBe('Quay');
    expect(reading.lentPorts()).toBe(0);
  });

  it('brings a project in from the files a folder input gave, read in the worker', async () => {
    const { storage, project, session } = await projectScene();
    expectSuccess(await session.run(rename('Slipway')));
    const folder = new MemoryDirectory();
    const written = await exportUnpacked(project, folder, WHOLE, storage.another);
    expectSuccess(expectSuccess(written).written);
    const files = [...folder.files].map(([path, bytes]) => ({
      path,
      file: new File([bytes], path),
    }));
    const given = elsewhere('given', 61);

    const brought = await given.client.transfers.importUnpacked(
      { kind: 'files', files },
      'original',
    );

    expect(expectSuccess(brought).header.id).toBe(project);
    expect(await nameIn(given, project)).toBe('Slipway');
    expect(pageCalls(given.pair)).toEqual([]);
  });

  it('copies a linked file the page found into the project, by one undoable change', async () => {
    const { storage, session } = await projectScene();
    const audio = generatedSource(4_096, 3);
    const bytes = await audio.read(0, audio.size);
    const linked: PageFile = {
      bytes: { kind: 'file', file: new File([bytes], 'footstep.wav') },
      fileName: 'footstep.wav',
      mediaType: 'audio/wav',
      lastModified: 1_790_000_000_000,
      handleKey: 'handle-1',
    };
    const { bytes: _offered, ...described } = linked;
    const identity = expectSuccess(
      await observeFile({ ...described, source: memorySource(bytes) }, webDigest(crypto.subtle)),
    );
    const media: MediaSource = { kind: 'external', identity, policy: SourceChangePolicy.Prompt };
    expectSuccess(await session.run(addAssetInvocation(assetOf(media), { media })));
    const asked: AssetId[] = [];

    const outcomes = await storage.client.transfers.consolidate(session, (asset) => {
      asked.push(asset);
      return Promise.resolve({ kind: 'found', file: linked });
    });

    expect(asked).toEqual([ASSET]);
    expect(expectSuccess(outcomes)).toEqual([
      { asset: ASSET, kind: 'consolidated', contentId: expect.any(String) },
    ]);
    expect(session.getSnapshot().model.state.sources.get(ASSET)?.media.kind).toBe('managed');
    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.sources.get(ASSET)?.media.kind).toBe('external');
    expect(storage.lentPorts()).toBe(0);
  });

  it('stops the worker writing where the page abandons an export part of the way', async () => {
    const { storage, project } = await withMedia(4_000_000);
    const whole = memorySink();
    let wholeWrites = 0;
    const counted: ByteSink = {
      write: async (chunk) => {
        wholeWrites += 1;
        await whole.write(chunk);
      },
      close: () => whole.close(),
      abort: () => whole.abort(),
    };
    expectSuccess(await storage.client.transfers.exportBundle(project, counted, WHOLE));
    const controller = new AbortController();
    const reason = new Error('Stopped.');
    const kept = memorySink();
    let writes = 0;
    const abandoning: ByteSink = {
      write: async (chunk) => {
        writes += 1;
        await kept.write(chunk);
        if (writes === 2) controller.abort(reason);
      },
      close: () => kept.close(),
      abort: () => kept.abort(),
    };

    const exporting = storage.client.transfers.exportBundle(
      project,
      abandoning,
      WHOLE,
      controller.signal,
    );

    await expect(exporting).rejects.toBe(reason);
    // The worker answers once its work has stopped, and says it stopped for
    // the cancel rather than for the sink the page let go.
    const outcome = await vi.waitFor(() => {
      const answered = answerTo(storage.pair, 'transfers.exportBundle');
      if (answered === undefined) throw new Error('The worker has not answered yet.');
      return answered;
    });
    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(wholeWrites).toBeGreaterThanOrEqual(6);
    expect(writes).toBeLessThanOrEqual(3);
    expect(kept.ending).toBe('aborted');
    expect(storage.lentPorts()).toBe(0);
  });
});
