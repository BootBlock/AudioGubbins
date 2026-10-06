import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';

import { nobleSha256 } from './adapter/noble-sha256.js';
import { ImportedPackSource } from './imported-pack-source.js';
import type { InstallState } from './install-state.js';
import { refOf, type PackRef } from './manifest.js';
import { PackInstaller } from './pack-installer.js';
import { updatePack } from './pack-update.js';
import { MemoryPackStore } from './testing/memory-pack-store.js';
import { MemorySource } from './testing/memory-pack-source.js';
import { patterned, testPack, type TestPack } from './testing/node-sha256.js';

/** The value of a result that must have succeeded. */
function valueOf<TValue>(result: DomainResult<TValue>): TValue {
  if (!result.ok) throw new Error(result.failures.map((one) => one.summary).join(' '));
  return result.value;
}

function codes<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((failure) => failure.code);
}

/** An installer over a store in memory, and every state it entered, in order. */
function installerOver(store = new MemoryPackStore()) {
  const states: InstallState[] = [];
  const installer = new PackInstaller({
    store,
    sha256: nobleSha256,
    changed: (_ref, state) => states.push(state),
  });
  return { installer, store, states };
}

function kinds(states: readonly InstallState[]): readonly string[] {
  return states.map((state) => state.kind).filter((kind, index, all) => all[index - 1] !== kind);
}

/** The bytes the store keeps of each file of a pack, by path. */
async function keptFiles(store: MemoryPackStore, pack: TestPack) {
  const kept = new Map<string, readonly number[]>();
  for (const [index, file] of pack.manifest.files.entries()) {
    const source = valueOf(await store.open(refOf(pack.manifest), index));
    if (source !== undefined) kept.set(file.path, [...(await source.read(0, source.size))]);
  }
  return kept;
}

function bytesOf(pack: TestPack) {
  return new Map([...pack.files].map(([path, bytes]) => [path, [...bytes]]));
}

const PACK = testPack();
const REF = refOf(PACK.manifest);

describe('installing a pack', () => {
  it('downloads every file, checks it, seals it, and serves it checked', async () => {
    const { installer, store, states } = installerOver();
    const source = new MemorySource([PACK]);

    expect(valueOf(await installer.download(PACK.manifest, source))).toEqual({
      kind: 'installed',
    });

    expect(kinds(states)).toEqual(['downloading', 'verifying', 'installed']);
    expect(states.filter((state) => state.kind === 'downloading').at(-1)).toEqual({
      kind: 'downloading',
      received: 17,
      total: 17,
    });
    expect(valueOf(await store.kept())).toEqual([{ kind: 'sealed', manifest: PACK.manifest }]);
    expect([...valueOf(await installer.read(REF, 'models/decoder.onnx'))]).toEqual([
      ...(PACK.files.get('models/decoder.onnx') ?? []),
    ]);
  });

  it('transfers one file at a time, in the manifest’s order', async () => {
    const { installer } = installerOver();
    const source = new MemorySource([PACK]);
    await installer.download(PACK.manifest, source);
    expect(source.mostAtOnce).toBe(1);
    expect(source.reads).toEqual([
      { path: 'encoder.onnx', offset: 0 },
      { path: 'models/decoder.onnx', offset: 0 },
    ]);
  });

  it('pauses between two chunks, keeps what came, and resumes by range', async () => {
    const { installer, store, states } = installerOver();
    const pausing = new MemorySource([PACK], {
      afterChunk: (path, served) => {
        if (path === 'encoder.onnx' && served === 6) valueOf(installer.pause(REF));
      },
    });

    expect(valueOf(await installer.download(PACK.manifest, pausing))).toEqual({
      kind: 'paused',
      received: 6,
      total: 17,
    });
    expect(valueOf(await store.stagedBytes(REF, 0))).toBe(6);
    expect(states.some((state) => state.kind === 'verifying')).toBe(false);

    const resuming = new MemorySource([PACK]);
    expect(valueOf(await installer.resume(REF, resuming))).toEqual({ kind: 'installed' });
    expect(resuming.reads).toEqual([
      { path: 'encoder.onnx', offset: 6 },
      { path: 'models/decoder.onnx', offset: 0 },
    ]);
    expect(await keptFiles(store, PACK)).toEqual(bytesOf(PACK));
  });

  it('pauses when the caller’s signal aborts', async () => {
    const { installer } = installerOver();
    const controller = new AbortController();
    const source = new MemorySource([PACK], {
      afterChunk: (_path, served) => {
        if (served === 3) controller.abort();
      },
    });
    expect(valueOf(await installer.download(PACK.manifest, source, controller.signal))).toEqual({
      kind: 'paused',
      received: 3,
      total: 17,
    });
  });

  it('cancels a transfer in flight, keeping nothing', async () => {
    const { installer, store, states } = installerOver();
    const source = new MemorySource([PACK], {
      afterChunk: (path) => {
        if (path === 'models/decoder.onnx') void installer.cancel(REF);
      },
    });

    expect(valueOf(await installer.download(PACK.manifest, source))).toEqual({
      kind: 'available',
    });
    expect(kinds(states)).toEqual(['downloading', 'removing', 'available']);
    expect(valueOf(await store.kept())).toEqual([]);
    expect(store.heldBytes()).toBe(0);
  });

  it('cancels a paused download, keeping nothing', async () => {
    const { installer, store } = installerOver();
    const source = new MemorySource([PACK], {
      afterChunk: () => void installer.pause(REF),
    });
    await installer.download(PACK.manifest, source);
    expect(installer.stateOf(REF).kind).toBe('paused');

    expect(valueOf(await installer.cancel(REF))).toEqual({ kind: 'available' });
    expect(store.heldBytes()).toBe(0);
  });

  it('fails part way through a file, keeps what came, and retries from where it stopped', async () => {
    const { installer, store } = installerOver();
    const breaking = new MemorySource([PACK], {
      breakAt: { path: 'models/decoder.onnx', afterBytes: 3 },
    });

    const failed = valueOf(await installer.download(PACK.manifest, breaking));
    expect(failed).toMatchObject({ kind: 'failed', resumable: true, received: 13 });
    expect(failed.kind === 'failed' && failed.reason.code).toBe('model-pack.network-failed');
    expect(valueOf(await store.stagedBytes(REF, 1))).toBe(3);

    const again = new MemorySource([PACK]);
    expect(valueOf(await installer.retry(REF, again))).toEqual({ kind: 'installed' });
    expect(again.reads).toEqual([{ path: 'models/decoder.onnx', offset: 3 }]);
    expect(await keptFiles(store, PACK)).toEqual(bytesOf(PACK));
  });

  it('keeps nothing of a file whose source holds more than the manifest, and retries from nothing', async () => {
    const { installer, store } = installerOver();
    const longer = new MemorySource([PACK], {
      serve: new Map([['encoder.onnx', patterned(14, 1)]]),
    });

    const failed = valueOf(await installer.download(PACK.manifest, longer));
    expect(failed).toMatchObject({ kind: 'failed', resumable: false, received: 0 });
    expect(failed.kind === 'failed' && failed.reason.code).toBe('model-pack.source-overran');

    const again = new MemorySource([PACK]);
    expect(valueOf(await installer.retry(REF, again))).toEqual({ kind: 'installed' });
    expect(again.reads[0]).toEqual({ path: 'encoder.onnx', offset: 0 });
    expect(await keptFiles(store, PACK)).toEqual(bytesOf(PACK));
  });

  it('fails a check, names the file, and keeps nothing of the version', async () => {
    const { installer, store, states } = installerOver();
    const corrupted = patterned(7, 2);
    corrupted[4] = (corrupted[4] ?? 0) ^ 1;
    const lying = new MemorySource([PACK], {
      serve: new Map([['models/decoder.onnx', corrupted]]),
    });

    const failed = valueOf(await installer.download(PACK.manifest, lying));
    expect(kinds(states)).toEqual(['downloading', 'verifying', 'failed']);
    expect(failed).toMatchObject({ kind: 'failed', resumable: false });
    if (failed.kind === 'failed') {
      expect(failed.reason.code).toBe('model-pack.file-hash-mismatch');
      expect(failed.reason.details?.['file']).toBe('models/decoder.onnx');
    }
    expect(valueOf(await store.kept())).toEqual([]);
    expect(store.heldBytes()).toBe(0);
    expect(codes(await installer.read(REF, 'encoder.onnx'))).toEqual([
      'model-pack.file-unavailable',
    ]);
  });

  it('fails resumably where the storage refuses a write, keeping what it took', async () => {
    const { installer, store } = installerOver(new MemoryPackStore({ quotaBytes: 12 }));
    const failed = valueOf(await installer.download(PACK.manifest, new MemorySource([PACK])));
    expect(failed).toMatchObject({ kind: 'failed', resumable: true, received: 10 });
    expect(failed.kind === 'failed' && failed.reason.code).toBe('model-pack.storage-refused');
    expect(store.heldBytes()).toBe(10);
  });

  it('refuses a second operation on a version while one runs', async () => {
    const { installer } = installerOver();
    const first = installer.download(PACK.manifest, new MemorySource([PACK]));
    const second = await installer.download(PACK.manifest, new MemorySource([PACK]));
    expect(codes(second)).toEqual(['model-pack.busy']);
    expect(valueOf(await first)).toEqual({ kind: 'installed' });
  });

  it('refuses what a version’s state cannot take, with the reason', async () => {
    const { installer } = installerOver();
    expect(codes(await installer.resume(REF, new MemorySource([PACK])))).toEqual([
      'model-pack.transition-refused',
    ]);
    expect(codes(installer.pause(REF))).toEqual(['model-pack.not-transferring']);
    await installer.download(PACK.manifest, new MemorySource([PACK]));
    expect(codes(await installer.download(PACK.manifest, new MemorySource([PACK])))).toEqual([
      'model-pack.transition-refused',
    ]);
  });
});

describe('one pack downloading at a time', () => {
  const OTHER = testPack({ id: 'other-pack' });
  const OTHER_REF = refOf(OTHER.manifest);

  /**
   * An installer whose every state is logged, in order, as `<pack>:<state>`,
   * so the order of several packs' lives can be read; `lifeOf` is one pack's,
   * a repeated state once.
   */
  function loggedInstaller(store = new MemoryPackStore()) {
    const log: string[] = [];
    const states = new Map<string, InstallState[]>();
    const installer = new PackInstaller({
      store,
      sha256: nobleSha256,
      changed: (ref, state) => {
        log.push(`${ref.id}:${state.kind}`);
        states.set(ref.id, [...(states.get(ref.id) ?? []), state]);
      },
    });
    const lifeOf = (id: string): readonly string[] =>
      kinds(states.get(id) ?? []).map((kind) => `${id}:${kind}`);
    /** Where a pack first entered a state in the log. */
    const at = (line: string): number => {
      const index = log.indexOf(line);
      if (index < 0) throw new Error(`${line} was never entered.`);
      return index;
    };
    return { installer, store, log, states, lifeOf, at };
  }

  it('queues a second pack while the first downloads, and starts it when the first ends', async () => {
    const { installer, lifeOf, at } = loggedInstaller();
    const second = new MemorySource([OTHER]);
    const first = installer.download(PACK.manifest, new MemorySource([PACK]));
    const queued = installer.download(OTHER.manifest, second);

    expect(valueOf(await first)).toEqual({ kind: 'installed' });
    expect(valueOf(await queued)).toEqual({ kind: 'installed' });
    expect(lifeOf('other-pack')).toEqual([
      'other-pack:queued',
      'other-pack:downloading',
      'other-pack:verifying',
      'other-pack:installed',
    ]);
    expect(at('other-pack:queued')).toBeLessThan(at('sample-pack:verifying'));
    expect(at('other-pack:downloading')).toBeGreaterThan(at('sample-pack:installed'));
    expect(second.reads[0]).toEqual({ path: 'encoder.onnx', offset: 0 });
  });

  it('reports what a queued resume has kept while it waits', async () => {
    const { installer, store, states } = loggedInstaller();
    await installer.download(
      OTHER.manifest,
      new MemorySource([OTHER], { afterChunk: () => void installer.pause(OTHER_REF) }),
    );
    expect(installer.stateOf(OTHER_REF)).toEqual({ kind: 'paused', received: 3, total: 17 });

    const first = installer.download(PACK.manifest, new MemorySource([PACK]));
    const resuming = new MemorySource([OTHER]);
    const resumed = installer.resume(OTHER_REF, resuming);
    await first;
    expect(valueOf(await resumed)).toEqual({ kind: 'installed' });
    expect(states.get('other-pack')).toContainEqual({ kind: 'queued', received: 3, total: 17 });
    expect(resuming.reads[0]).toEqual({ path: 'encoder.onnx', offset: 3 });
    expect(await keptFiles(store, OTHER)).toEqual(bytesOf(OTHER));
  });

  it('cancels a queued download, keeping nothing of it and never reading it', async () => {
    const { installer, store, lifeOf } = loggedInstaller();
    const second = new MemorySource([OTHER]);
    const first = installer.download(
      PACK.manifest,
      new MemorySource([PACK], {
        afterChunk: (_path, served) => {
          if (served === 3) void installer.cancel(OTHER_REF);
        },
      }),
    );
    const queued = installer.download(OTHER.manifest, second);

    expect(valueOf(await queued)).toEqual({ kind: 'available' });
    expect(valueOf(await first)).toEqual({ kind: 'installed' });
    expect(lifeOf('other-pack')).toEqual([
      'other-pack:queued',
      'other-pack:removing',
      'other-pack:available',
    ]);
    expect(second.reads).toEqual([]);
    expect(valueOf(await store.kept())).toEqual([{ kind: 'sealed', manifest: PACK.manifest }]);
    expect(installer.installations().map((one) => one.ref)).toEqual([REF]);
  });

  it('pauses a queued download, which leaves the queue and resumes later', async () => {
    const { installer } = loggedInstaller();
    const first = installer.download(
      PACK.manifest,
      new MemorySource([PACK], {
        afterChunk: (path, served) => {
          if (path === 'encoder.onnx' && served === 3) valueOf(installer.pause(OTHER_REF));
        },
      }),
    );
    const queued = installer.download(OTHER.manifest, new MemorySource([OTHER]));
    expect(valueOf(await queued)).toEqual({ kind: 'paused', received: 0, total: 17 });
    await first;
    expect(valueOf(await installer.resume(OTHER_REF, new MemorySource([OTHER])))).toEqual({
      kind: 'installed',
    });
  });

  it('starts the next download when the first fails', async () => {
    const { installer, at } = loggedInstaller();
    const first = installer.download(
      PACK.manifest,
      new MemorySource([PACK], { breakAt: { path: 'encoder.onnx', afterBytes: 3 } }),
    );
    const queued = installer.download(OTHER.manifest, new MemorySource([OTHER]));

    expect(valueOf(await first)).toMatchObject({ kind: 'failed', resumable: true });
    expect(valueOf(await queued)).toEqual({ kind: 'installed' });
    expect(at('other-pack:queued')).toBeLessThan(at('sample-pack:failed'));
    expect(at('other-pack:downloading')).toBeGreaterThan(at('sample-pack:failed'));
  });

  it('starts the next download when the first is cancelled, and keeps the bound after', async () => {
    const { installer, lifeOf, at } = loggedInstaller();
    const THIRD = testPack({ id: 'third-pack' });
    const first = installer.download(
      PACK.manifest,
      new MemorySource([PACK], {
        afterChunk: (_path, served) => {
          if (served === 3) void installer.cancel(REF);
        },
      }),
    );
    const second = installer.download(OTHER.manifest, new MemorySource([OTHER]));
    const third = installer.download(THIRD.manifest, new MemorySource([THIRD]));

    expect(valueOf(await first)).toEqual({ kind: 'available' });
    expect(valueOf(await second)).toEqual({ kind: 'installed' });
    expect(valueOf(await third)).toEqual({ kind: 'installed' });
    expect(lifeOf('sample-pack')).toEqual([
      'sample-pack:downloading',
      'sample-pack:removing',
      'sample-pack:available',
    ]);
    expect(at('third-pack:queued')).toBeLessThan(at('sample-pack:removing'));
    expect(at('other-pack:downloading')).toBeGreaterThan(at('sample-pack:available'));
    expect(at('third-pack:downloading')).toBeGreaterThan(at('other-pack:installed'));
  });
});

describe('importing a pack a person has', () => {
  it('installs by the same path, checking every hash', async () => {
    const { installer, store } = installerOver();
    const files = new Map(
      [...PACK.files].map(([path, bytes]) => [
        path,
        {
          size: bytes.length,
          read: (offset: number, length: number) =>
            Promise.resolve(bytes.slice(offset, offset + length)),
        },
      ]),
    );
    const imported = new ImportedPackSource(PACK.manifest, files);
    expect(valueOf(await installer.download(PACK.manifest, imported))).toEqual({
      kind: 'installed',
    });
    expect(await keptFiles(store, PACK)).toEqual(bytesOf(PACK));
  });

  it('keeps nothing of an import whose file is not the one named', async () => {
    const { installer, store } = installerOver();
    const wrong = patterned(10, 9);
    const files = new Map([
      [
        'encoder.onnx',
        { size: 10, read: (o: number, l: number) => Promise.resolve(wrong.slice(o, o + l)) },
      ],
      [
        'models/decoder.onnx',
        {
          size: 7,
          read: (o: number, l: number) =>
            Promise.resolve((PACK.files.get('models/decoder.onnx') ?? wrong).slice(o, o + l)),
        },
      ],
    ]);
    const failed = valueOf(
      await installer.download(PACK.manifest, new ImportedPackSource(PACK.manifest, files)),
    );
    expect(failed.kind === 'failed' && failed.reason.details?.['file']).toBe('encoder.onnx');
    expect(store.heldBytes()).toBe(0);
  });

  it('refuses an import that lacks a file', async () => {
    const { installer } = installerOver();
    const failed = valueOf(
      await installer.download(PACK.manifest, new ImportedPackSource(PACK.manifest, new Map())),
    );
    expect(failed.kind === 'failed' && failed.reason.code).toBe('model-pack.import-file-missing');
  });
});

describe('removing and updating', () => {
  const NEXT = testPack({ version: '1.1.0', files: { 'encoder.onnx': patterned(12, 3) } });
  const NEXT_REF: PackRef = refOf(NEXT.manifest);

  async function installed() {
    const harness = installerOver();
    valueOf(await harness.installer.download(PACK.manifest, new MemorySource([PACK])));
    return harness;
  }

  it('removes an installed version, keeping nothing', async () => {
    const { installer, store } = await installed();
    expect(valueOf(await installer.remove(REF, { pinned: [] }))).toEqual({ kind: 'available' });
    expect(store.heldBytes()).toBe(0);
    expect(codes(await installer.read(REF, 'encoder.onnx'))).toEqual([
      'model-pack.file-unavailable',
    ]);
  });

  it('keeps a version a project needs until it is removed knowingly', async () => {
    const { installer } = await installed();
    expect(codes(await installer.remove(REF, { pinned: [REF] }))).toEqual([
      'model-pack.version-pinned',
    ]);
    expect(installer.stateOf(REF)).toEqual({ kind: 'installed' });
    expect(valueOf(await installer.remove(REF, { pinned: [REF], knowingly: true }))).toEqual({
      kind: 'available',
    });
  });

  it('updates to a later version and removes the earlier', async () => {
    const { installer, store } = await installed();
    const outcome = valueOf(
      await updatePack(installer, REF, NEXT.manifest, new MemorySource([NEXT]), { pinned: [] }),
    );
    expect(outcome).toEqual({ state: { kind: 'installed' }, previousRetained: false });
    expect(valueOf(await store.kept())).toEqual([{ kind: 'sealed', manifest: NEXT.manifest }]);
    expect(installer.stateOf(REF)).toEqual({ kind: 'available' });
  });

  it('retains the earlier version through an update where a project pins it', async () => {
    const { installer, store } = await installed();
    const outcome = valueOf(
      await updatePack(installer, REF, NEXT.manifest, new MemorySource([NEXT]), { pinned: [REF] }),
    );
    expect(outcome).toEqual({ state: { kind: 'installed' }, previousRetained: true });
    expect(valueOf(await store.kept())).toEqual([
      { kind: 'sealed', manifest: PACK.manifest },
      { kind: 'sealed', manifest: NEXT.manifest },
    ]);
    expect(installer.stateOf(NEXT_REF)).toEqual({ kind: 'installed' });
  });

  it('keeps the earlier version where the update does not install', async () => {
    const { installer } = await installed();
    const lying = new MemorySource([NEXT], {
      serve: new Map([['encoder.onnx', patterned(12, 4)]]),
    });
    const outcome = valueOf(await updatePack(installer, REF, NEXT.manifest, lying, { pinned: [] }));
    expect(outcome.previousRetained).toBe(true);
    expect(installer.stateOf(REF)).toEqual({ kind: 'installed' });
  });

  it('refuses an update that is not a later version of the same pack', async () => {
    const { installer } = await installed();
    const other = testPack({ id: 'other-pack', version: '2.0.0' });
    for (const next of [
      other.manifest,
      testPack({ version: '1.0.0' }).manifest,
      testPack({ version: '0.9.0' }).manifest,
    ]) {
      expect(
        codes(await updatePack(installer, REF, next, new MemorySource([]), { pinned: [] })),
      ).toEqual(['model-pack.not-an-update']);
    }
  });
});

describe('a pack found damaged, and a restart', () => {
  it('marks an installed version damaged when a read finds a byte changed, and serves nothing', async () => {
    const { installer, store } = installerOver();
    valueOf(await installer.download(PACK.manifest, new MemorySource([PACK])));
    store.rot(REF, 1, 2);

    expect(codes(await installer.read(REF, 'models/decoder.onnx'))).toEqual([
      'model-pack.file-hash-mismatch',
    ]);
    expect(installer.stateOf(REF)).toMatchObject({ kind: 'failed', resumable: false });
    expect(codes(await installer.read(REF, 'encoder.onnx'))).toEqual([
      'model-pack.file-unavailable',
    ]);
  });

  it('learns from the store what was installed and what was stopped part way', async () => {
    const store = new MemoryPackStore();
    const first = installerOver(store).installer;
    const other = testPack({ id: 'other-pack' });
    valueOf(await first.download(PACK.manifest, new MemorySource([PACK])));
    await first.download(
      other.manifest,
      new MemorySource([other], { afterChunk: () => void first.pause(refOf(other.manifest)) }),
    );

    const restarted = installerOver(store).installer;
    valueOf(await restarted.restore());
    expect(restarted.installations()).toEqual([
      {
        ref: refOf(other.manifest),
        manifest: other.manifest,
        state: { kind: 'paused', received: 3, total: 17 },
      },
      { ref: REF, manifest: PACK.manifest, state: { kind: 'installed' } },
    ]);

    const resuming = new MemorySource([other]);
    expect(valueOf(await restarted.resume(refOf(other.manifest), resuming))).toEqual({
      kind: 'installed',
    });
    expect(resuming.reads[0]).toEqual({ path: 'encoder.onnx', offset: 3 });
  });
});
