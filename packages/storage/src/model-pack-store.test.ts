import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  PackInstaller,
  refOf,
  type FileRange,
  type ModelPackManifest,
  type PackSource,
  type ReceiveChunk,
  type Sha256,
} from '@audiogubbins/model-packs';
import { describePackStoreContract, sampleManifest } from '@audiogubbins/model-packs/testing';

import { ModelPackStore } from './model-pack-store.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { nodeDigest } from './testing/node-services.js';

/**
 * Model packs kept in the storage tree (ADR-0062): held to the pack store's
 * contract, kept across a restart, a torn record read as a damaged version, and
 * no crash at any point of an install leaves a version sealed over files that
 * are not its manifest's.
 */

describePackStoreContract(
  'over the storage tree',
  () => new ModelPackStore(new MemoryStorageTree(), nodeDigest),
);

const sha256: Sha256 = () => {
  const hash = createHash('sha256');
  return {
    update: (bytes) => {
      hash.update(bytes);
      return Promise.resolve();
    },
    digest: () => Promise.resolve(new Uint8Array(hash.digest())),
  };
};

const ENCODER = Uint8Array.from({ length: 10 }, (_, index) => index * 7);
const DECODER = Uint8Array.from({ length: 6 }, (_, index) => 200 - index);

const MANIFEST: ModelPackManifest = sampleManifest({
  files: [
    { path: 'encoder.onnx', bytes: 10, sha256: createHash('sha256').update(ENCODER).digest('hex') },
    {
      path: 'models/decoder.onnx',
      bytes: 6,
      sha256: createHash('sha256').update(DECODER).digest('hex'),
    },
  ],
});
const REF = refOf(MANIFEST);

/** The pack's files, served four bytes at a time. */
const SOURCE: PackSource = {
  catalogue: () => Promise.resolve({ ok: true, value: [MANIFEST] }),
  read: async (range: FileRange, receive: ReceiveChunk) => {
    const bytes = range.file.path === 'encoder.onnx' ? ENCODER : DECODER;
    for (let offset = range.offset; offset < bytes.length; offset += 4) {
      const taken = await receive(bytes.slice(offset, offset + 4));
      if (!taken.ok) return taken;
    }
    return { ok: true, value: undefined };
  },
};

describe('the model packs a storage keeps', () => {
  it('keeps a version under packs/, its runs named by where they start', async () => {
    const tree = new MemoryStorageTree();
    const store = new ModelPackStore(tree, nodeDigest);
    expectSuccess(await store.stage(MANIFEST));
    for (const bytes of [
      [1, 2, 3],
      [4, 5],
    ]) {
      const sink = expectSuccess(await store.append(REF, 0));
      await sink.write(new Uint8Array(bytes));
      await sink.close();
    }

    expect(tree.paths()).toEqual([
      'packs/sample-pack/1.0.0/files/000/000000000000',
      'packs/sample-pack/1.0.0/files/000/000000000003',
      'packs/sample-pack/1.0.0/manifest.json',
    ]);
    const source = expectSuccess(await store.open(REF, 0));
    expect([...((await source?.read(1, 3)) ?? [])]).toEqual([2, 3, 4]);
  });

  it('keeps what it holds across a restart', async () => {
    const tree = new MemoryStorageTree();
    const installer = new PackInstaller({ store: new ModelPackStore(tree, nodeDigest), sha256 });
    expect(expectSuccess(await installer.download(MANIFEST, SOURCE))).toEqual({
      kind: 'installed',
    });

    const restarted = new ModelPackStore(tree.restarted(), nodeDigest);
    expect(expectSuccess(await restarted.kept())).toEqual([{ kind: 'sealed', manifest: MANIFEST }]);
  });

  it('drops the runs past a gap when it appends', async () => {
    const tree = new MemoryStorageTree();
    const store = new ModelPackStore(tree, nodeDigest);
    expectSuccess(await store.stage(MANIFEST));
    await tree.writeFile('packs/sample-pack/1.0.0/files/000/000000000000', new Uint8Array([1, 2]));
    await tree.writeFile('packs/sample-pack/1.0.0/files/000/000000000005', new Uint8Array([9]));

    expect(expectSuccess(await store.stagedBytes(REF, 0))).toBe(2);
    const sink = expectSuccess(await store.append(REF, 0));
    await sink.write(new Uint8Array([3]));
    await sink.close();
    expect(tree.paths().filter((path) => path.includes('/files/'))).toEqual([
      'packs/sample-pack/1.0.0/files/000/000000000000',
      'packs/sample-pack/1.0.0/files/000/000000000002',
    ]);
  });

  it('reads a torn manifest as a damaged version, which can only be removed', async () => {
    const tree = new MemoryStorageTree();
    const store = new ModelPackStore(tree, nodeDigest);
    expectSuccess(await store.stage(MANIFEST));
    const path = 'packs/sample-pack/1.0.0/manifest.json';
    const whole = (await tree.readFile(path)) ?? new Uint8Array();
    await tree.writeFile(path, whole.slice(0, whole.length >> 1));

    const [found] = expectSuccess(await store.kept());
    expect(found).toMatchObject({
      kind: 'damaged',
      ref: REF,
      reason: { code: 'storage.pack-damaged' },
    });
    expect((await store.append(REF, 0)).ok).toBe(false);
    expectSuccess(await store.remove(REF));
    expect(tree.paths()).toEqual([]);
  });

  it('reads a seal of another manifest, or a torn one, as damaged, never as installed', async () => {
    const tree = new MemoryStorageTree();
    const store = new ModelPackStore(tree, nodeDigest);
    expectSuccess(await store.stage(MANIFEST));
    expectSuccess(await store.seal(REF));
    const sealPath = 'packs/sample-pack/1.0.0/seal.json';
    const seal = (await tree.readFile(sealPath)) ?? new Uint8Array();

    await tree.writeFile(sealPath, seal.slice(0, 10));
    expect(expectSuccess(await store.kept())[0]?.kind).toBe('damaged');

    // A seal written for another manifest, as a version staged again under a
    // changed manifest would hold were the seal not removed with it.
    const otherTree = new MemoryStorageTree();
    const other = new ModelPackStore(otherTree, nodeDigest);
    const changed = sampleManifest({
      files: [{ path: 'encoder.onnx', bytes: 5, sha256: 'e'.repeat(64) }],
    });
    expectSuccess(await other.stage(changed));
    expectSuccess(await other.seal(refOf(changed)));
    // Same pack and version, another manifest: its seal names another digest.
    await tree.writeFile(sealPath, (await otherTree.readFile(sealPath)) ?? new Uint8Array());
    expect(expectSuccess(await store.kept())[0]).toMatchObject({
      kind: 'damaged',
      reason: {
        summary: expect.stringMatching(/seal of sample-pack@1\.0\.0 is of another manifest/),
      },
    });
  });

  it('reads a manifest kept under another pack’s name as damaged', async () => {
    const tree = new MemoryStorageTree();
    const store = new ModelPackStore(tree, nodeDigest);
    expectSuccess(await store.stage(MANIFEST));
    await tree.writeFile(
      'packs/sample-pack/9.9.9/manifest.json',
      (await tree.readFile('packs/sample-pack/1.0.0/manifest.json')) ?? new Uint8Array(),
    );
    expect(expectSuccess(await store.kept()).map((pack) => pack.kind)).toEqual([
      'staged',
      'damaged',
    ]);
  });

  it('never leaves a version sealed over files that are not its manifest’s, whatever crash cuts an install short', async () => {
    const operations = await sweepCrashes({
      from: new MemoryStorageTree(),
      run: async (tree) => {
        const installer = new PackInstaller({
          store: new ModelPackStore(tree, nodeDigest),
          sha256,
        });
        return await installer.download(MANIFEST, SOURCE);
      },
      check: async (found, crash) => {
        const installer = new PackInstaller({
          store: new ModelPackStore(found, nodeDigest),
          sha256,
        });
        expectSuccess(await installer.restore());
        const state = installer.stateOf(REF);
        if (crash.at === undefined) expect(state).toEqual({ kind: 'installed' });
        if (state.kind !== 'installed') return;
        expect([...expectSuccess(await installer.read(REF, 'encoder.onnx'))]).toEqual([...ENCODER]);
        expect([...expectSuccess(await installer.read(REF, 'models/decoder.onnx'))]).toEqual([
          ...DECODER,
        ]);
      },
      tornWrites: ['short', 'full-length'],
    });
    expect(operations).toBeGreaterThan(20);
  });
});
