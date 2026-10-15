import { createHash } from 'node:crypto';
import { Blob as PlatformBlob, File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrustedFolders } from '@audiogubbins/browser-storage';
import {
  FakeDirectoryHandle,
  FakeFileHandle,
  MemoryDatabases,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { sampleRate, type DomainFailure } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type {
  EncodedStreamMessage,
  ExportSettings,
  StreamReceiverMessage,
} from '@audiogubbins/import-export';
import { countingTokens } from '@audiogubbins/media-store/testing';
import {
  ExportDestinationKind,
  stateFingerprintFrom,
  type ExportCodec,
} from '@audiogubbins/project-format';
import type { ExportOrigin } from '@audiogubbins/storage';

import { projectScene, storedModel } from '../testing/project-scene.js';

/**
 * Exports through the storage worker (ADR-0092): the codec worker, played
 * here by a producer posting an encoded file on a real message channel and
 * keeping to the credit it is given, writes to the port the page hands the
 * worker; the page delivers what is staged into a folder or a trusted one,
 * the person asked through the prompt it lends, or as a download.
 */

const HEAD = Uint8Array.from([82, 73, 70, 70]);
const BODY = Uint8Array.from({ length: 300 }, (_, index) => index % 256);
const TAIL = Uint8Array.from([0]);
const WHOLE = Uint8Array.from([...HEAD, ...BODY, ...TAIL]);

const SETTINGS: ExportSettings = {
  format: 'wav',
  encoding: { kind: 'float', bits: 32 },
  sampleRate: expectSuccess(sampleRate(48_000)),
  channels: { kind: 'keep' },
  dither: { kind: 'none' },
  range: { kind: 'project' },
  metadata: { policy: 'full', edits: [] },
  fileName: '{project}',
};

/** The encoder the codec worker names once the file is encoded. */
const ENCODER: ExportCodec = { id: 'pcm', implementation: 'application', version: '0.1.0' };

const ORIGIN: ExportOrigin = {
  settings: SETTINGS,
  reproducible: true,
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'4'.repeat(64)}`)),
  engineVersions: new Map([['renderer', '1']]),
};

/** A codec worker's producer: it posts a message for each credit it is given, never more. */
class Producer {
  readonly credits: number[] = [];
  readonly refusals: DomainFailure[] = [];
  sent = 0;

  constructor(port: MessagePort, messages: readonly EncodedStreamMessage[]) {
    let credit = 0;
    port.start();
    port.addEventListener('message', (event: MessageEvent<StreamReceiverMessage>) => {
      const message = event.data;
      if (message.kind === 'refused') {
        this.refusals.push(message.failure);
        return;
      }
      this.credits.push(message.credit);
      credit += message.credit;
      while (credit > 0 && this.sent < messages.length) {
        const next = messages[this.sent];
        if (next === undefined) break;
        port.postMessage(next);
        this.sent += 1;
        credit -= 1;
      }
    });
  }
}

function encoded(): readonly EncodedStreamMessage[] {
  return [
    { kind: 'body', bytes: BODY.slice(0, 100) },
    { kind: 'body', bytes: BODY.slice(100, 200) },
    { kind: 'body', bytes: BODY.slice(200) },
    { kind: 'finished', file: { head: HEAD, tail: TAIL, dropped: [] } },
  ];
}

async function staged() {
  const scene = await projectScene();
  const channel = new MessageChannel();
  const producer = new Producer(channel.port2, encoded());
  const progress: number[] = [];
  const file = expectSuccess(
    await scene.storage.client.exports.stage(
      scene.session,
      { stream: channel.port1, origin: ORIGIN },
      (bytes) => progress.push(bytes),
    ),
  );
  return { ...scene, file, producer, progress };
}

async function bytesOf(handle: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

/** The name of every entry a fake folder holds. */
async function folderNames(folder: FakeDirectoryHandle): Promise<readonly string[]> {
  const names: string[] = [];
  for await (const handle of folder.values()) names.push(handle.name);
  return names;
}

beforeEach(() => {
  installFakeHandles();
  vi.stubGlobal('File', PlatformFile);
  vi.stubGlobal('Blob', PlatformBlob);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exports through the storage worker (ADR-0092)', () => {
  it('stages what the codec worker encodes, keeping it to the credit given', async () => {
    const { file, producer, progress } = await staged();
    expect(file).toMatchObject({
      bytes: WHOLE.length,
      sha256: createHash('sha256').update(WHOLE).digest('hex'),
    });
    expect(producer.credits[0]).toBe(1);
    expect(producer.sent).toBe(4);
    expect(progress).toEqual([100, 200, 300]);
  });

  it('delivers into a folder, asking about a taken name, and records the export', async () => {
    const { storage, project, session, file } = await staged();
    const taken = new FakeFileHandle(new File(['old'], 'Forest walk.wav'));
    const folder = new FakeDirectoryHandle('Game sounds', [taken]);
    const asked: string[] = [];
    const delivery = expectSuccess(
      await storage.client.exports.deliver(session, file.token, ENCODER, {
        kind: 'folder',
        handle: folder,
        wanted: { stem: 'Forest walk', extension: 'wav' },
        policy: 'prompt',
        remembered: undefined,
        prompt: (name) => {
          asked.push(name);
          return Promise.resolve({ answer: 'overwrite', applyToAll: false });
        },
      }),
    );

    expect(asked).toEqual(['Forest walk.wav']);
    expect(delivery).toMatchObject({ kind: 'delivered', replaced: 'chosen' });
    expect(await bytesOf(taken)).toEqual(WHOLE);
    const [record] = (await storedModel(storage, project)).exports;
    expect(record?.destination).toEqual({
      kind: ExportDestinationKind.Directory,
      label: 'Game sounds',
    });
    expect(storage.lentPorts()).toBe(0);
  });

  it('overwrites an unchanged earlier export in a trusted folder without asking, and keeps its record', async () => {
    const { storage, session, file } = await staged();
    const folders = new TrustedFolders(new MemoryDatabases(), countingTokens());
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const key = await folders.trust(folder);
    const asked: string[] = [];
    const destination = {
      kind: 'trusted-folder',
      folders,
      key,
      wanted: { stem: 'Forest walk', extension: 'wav' },
      policy: 'prompt',
      remembered: undefined,
      prompt: (name: string) => {
        asked.push(name);
        return Promise.resolve(undefined);
      },
    } as const;
    expect(
      expectSuccess(await storage.client.exports.deliver(session, file.token, ENCODER, destination))
        .kind,
    ).toBe('delivered');
    expect((await folders.find(key))?.records).toEqual([
      { name: 'Forest walk.wav', size: WHOLE.length, hash: file.sha256 },
    ]);

    // The same export again, staged anew, replaces the file it wrote silently.
    const channel = new MessageChannel();
    new Producer(channel.port2, encoded());
    const again = expectSuccess(
      await storage.client.exports.stage(
        session,
        { stream: channel.port1, origin: ORIGIN },
        () => undefined,
      ),
    );
    const second = expectSuccess(
      await storage.client.exports.deliver(session, again.token, ENCODER, destination),
    );
    expect(second).toMatchObject({ kind: 'delivered', replaced: 'trusted' });
    expect(asked).toEqual([]);
  });

  it('delivers into a relative folder inside the one chosen, made where it is not there', async () => {
    const { storage, project, session, file } = await staged();
    const old = new FakeFileHandle(new File(['old'], 'Forest walk.wav'));
    const folder = new FakeDirectoryHandle('Game sounds', [old]);
    const asked: string[] = [];
    const delivery = expectSuccess(
      await storage.client.exports.deliver(session, file.token, ENCODER, {
        kind: 'folder',
        handle: folder,
        path: ['sfx', 'ambience'],
        wanted: { stem: 'Forest walk', extension: 'wav' },
        policy: 'prompt',
        remembered: undefined,
        prompt: (name) => {
          asked.push(name);
          return Promise.resolve(undefined);
        },
      }),
    );

    expect(delivery).toMatchObject({
      kind: 'delivered',
      name: 'Forest walk.wav',
      replaced: 'none',
    });
    expect(asked).toEqual([]);
    const ambience = await (await folder.getDirectoryHandle('sfx')).getDirectoryHandle('ambience');
    expect(await bytesOf(await ambience.getFileHandle('Forest walk.wav'))).toEqual(WHOLE);
    expect(new TextDecoder().decode(await bytesOf(old))).toBe('old');
    expect((await storedModel(storage, project)).exports[0]?.destination).toEqual({
      kind: ExportDestinationKind.Directory,
      label: 'Game sounds',
    });
  });

  it('refuses a path that steps out of the folder, writing nothing and keeping the export', async () => {
    const { storage, session, file } = await staged();
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const destination = {
      kind: 'folder',
      handle: folder,
      path: ['sfx', '..', '..'],
      wanted: { stem: 'Forest walk', extension: 'wav' },
      policy: 'overwrite',
      remembered: undefined,
      prompt: () => Promise.resolve(undefined),
    } as const;
    const refused = expectSuccess(
      await storage.client.exports.deliver(session, file.token, ENCODER, destination),
    );
    expect(refused.kind === 'refused' ? refused.failure.code : refused.kind).toBe(
      'export.destination-path-invalid',
    );
    expect(await folderNames(folder)).toEqual([]);

    // Kept staged: the same export goes where the path is one inside the folder.
    expect(
      expectSuccess(
        await storage.client.exports.deliver(session, file.token, ENCODER, {
          ...destination,
          path: ['sfx'],
        }),
      ).kind,
    ).toBe('delivered');
  });

  it('keeps a trusted folder’s record by the path from it, so only that path overwrites silently', async () => {
    const { storage, session, file } = await staged();
    const folders = new TrustedFolders(new MemoryDatabases(), countingTokens());
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const key = await folders.trust(folder);
    const asked: string[] = [];
    const into = (path: readonly string[]) =>
      ({
        kind: 'trusted-folder',
        folders,
        key,
        path,
        wanted: { stem: 'Forest walk', extension: 'wav' },
        policy: 'prompt',
        remembered: undefined,
        prompt: (name: string) => {
          asked.push(name);
          return Promise.resolve(undefined);
        },
      }) as const;
    expect(
      expectSuccess(
        await storage.client.exports.deliver(
          session,
          file.token,
          ENCODER,
          into(['sfx', 'ambience']),
        ),
      ).kind,
    ).toBe('delivered');
    expect((await folders.find(key))?.records).toEqual([
      { name: 'sfx/ambience/Forest walk.wav', size: WHOLE.length, hash: file.sha256 },
    ]);

    const again = async (path: readonly string[]) => {
      const channel = new MessageChannel();
      new Producer(channel.port2, encoded());
      const restaged = expectSuccess(
        await storage.client.exports.stage(
          session,
          { stream: channel.port1, origin: ORIGIN },
          () => undefined,
        ),
      );
      return expectSuccess(
        await storage.client.exports.deliver(session, restaged.token, ENCODER, into(path)),
      );
    };
    expect(await again(['sfx', 'ambience'])).toMatchObject({
      kind: 'delivered',
      replaced: 'trusted',
    });
    expect(asked).toEqual([]);

    // The same file in the trusted folder itself is no export of that record: it is asked about.
    await folder.getFileHandle('Forest walk.wav', { create: true }).then(async (handle) => {
      const writable = await handle.createWritable();
      await writable.write(WHOLE);
      await writable.close();
    });
    expect((await again([])).kind).toBe('refused');
    expect(asked).toEqual(['Forest walk.wav']);
  });

  it('answers a download as a file of the staged parts, and keeps it staged until given up', async () => {
    const { storage, project, session, file } = await staged();
    const delivery = expectSuccess(
      await storage.client.exports.deliver(session, file.token, ENCODER, {
        kind: 'download',
        name: 'Forest walk.wav',
        mediaType: 'audio/wav',
      }),
    );
    if (delivery.kind !== 'download') throw new Error('A download is answered as a file.');
    expect(new Uint8Array(await delivery.file.arrayBuffer())).toEqual(WHOLE);
    expect(delivery.record.destination).toEqual({ kind: ExportDestinationKind.Download });
    expect((await storedModel(storage, project)).exports.map((record) => record.id)).toEqual([
      delivery.record.id,
    ]);

    await storage.client.exports.discard(file.token);
    expect(
      expectFailureCode(
        await storage.client.exports.deliver(session, file.token, ENCODER, {
          kind: 'download',
          name: 'Forest walk.wav',
          mediaType: 'audio/wav',
        }),
      ),
    ).toBe('export.staged-missing');
  });
});
