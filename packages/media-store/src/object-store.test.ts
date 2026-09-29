import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  CONTENT_CHUNK_BYTES,
  TreeFailure,
  TreeFailureKind,
  contentIdOf,
  type ByteSource,
  type ContentId,
} from '@audiogubbins/project-format';

import { MediaObjectStore } from './object-store.js';
import { intentBytes, sealBytes } from './store-records.js';
import type { StoreProgress } from './object-writing.js';
import {
  MemoryStorageTree,
  countingTokens,
  generatedBytes,
  generatedSource,
  memorySource,
  nodeDigest,
} from './testing/index.js';

function storeOver(tree: MemoryStorageTree): MediaObjectStore {
  return new MediaObjectStore({
    tree,
    root: 'media',
    digest: nodeDigest,
    nextToken: countingTokens(),
  });
}

async function identityOf(source: ByteSource): Promise<ContentId> {
  return expectSuccess(await contentIdOf(source, nodeDigest)).contentId;
}

async function allListed(store: MediaObjectStore): Promise<readonly ContentId[]> {
  const listed: ContentId[] = [];
  for await (const object of store.list()) listed.push(object.contentId);
  return listed;
}

describe('storing media by its content', () => {
  it('keeps the bytes under their content identity, sealed, with nothing left incoming', async () => {
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);
    const bytes = generatedBytes(0, 5_000, 7);

    const outcome = expectSuccess(await store.put(memorySource(bytes)));

    const id = await identityOf(memorySource(bytes));
    expect(outcome).toEqual({ contentId: id, byteLength: 5_000, deduplicated: false });
    const shard = id.slice(3, 5);
    expect(tree.paths()).toEqual([`media/${shard}/${id}`, `media/${shard}/${id}.seal`]);
    expect(tree.snapshot().get(`media/${shard}/${id}`)).toEqual(bytes);
  });

  it('keeps identical bytes stored twice once, and says it did', async () => {
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);

    const first = expectSuccess(await store.put(generatedSource(70_000, 3)));
    const second = expectSuccess(await store.put(generatedSource(70_000, 3)));

    expect(second).toEqual({ ...first, deduplicated: true });
    expect(tree.paths()).toHaveLength(2);
    expect(await allListed(store)).toEqual([first.contentId]);
  });

  it('streams a source of several chunks without reading any of it whole', async () => {
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);
    const size = 4 * CONTENT_CHUNK_BYTES + 12_345;
    const source = generatedSource(size, 11);
    const stages: StoreProgress[] = [];

    const outcome = expectSuccess(
      await store.put(source, { onProgress: (progress) => stages.push(progress) }),
    );

    expect(outcome.byteLength).toBe(size);
    expect(outcome.contentId).toBe(await identityOf(generatedSource(size, 11)));
    expect(source.largestRead).toBe(CONTENT_CHUNK_BYTES);
    expect(source.bytesRead).toBe(size);
    expect(stages.filter((one) => one.stage === 'receiving')).toHaveLength(5);
    expect(stages.filter((one) => one.stage === 'storing')).toHaveLength(5);
    expect(stages.at(-1)).toEqual({ stage: 'storing', done: size, total: size });
  });

  it('stores bytes of no length', async () => {
    const store = storeOver(new MemoryStorageTree());

    const outcome = expectSuccess(await store.put(memorySource(new Uint8Array(0))));

    expect(outcome.byteLength).toBe(0);
    expect(expectSuccess(await store.find(outcome.contentId))).toEqual({
      contentId: outcome.contentId,
      byteLength: 0,
    });
  });

  it('leaves nothing named by an identity when the store is aborted mid-way', async () => {
    for (const abortAt of [1, 3, 6, 8]) {
      const tree = new MemoryStorageTree();
      const store = storeOver(tree);
      const controller = new AbortController();
      let chunks = 0;

      const putting = store.put(generatedSource(4 * CONTENT_CHUNK_BYTES, 5), {
        signal: controller.signal,
        onProgress: () => {
          chunks += 1;
          if (chunks === abortAt) controller.abort(new Error('stopped'));
        },
      });

      await expect(putting).rejects.toThrow('stopped');
      expect(tree.paths(), `aborted after ${String(abortAt)} chunks`).toEqual([]);
    }
  });

  it('reports a full storage as a designed failure and harms nothing already stored', async () => {
    const tree = new MemoryStorageTree({ quotaBytes: 3 * CONTENT_CHUNK_BYTES });
    const store = storeOver(tree);
    const kept = expectSuccess(await store.put(generatedSource(100_000, 1)));
    const before = tree.snapshot();

    const refused = await store.put(generatedSource(2 * CONTENT_CHUNK_BYTES, 2));

    expect(expectFailureCode(refused)).toBe('media.storage-full');
    expect(refused.ok ? undefined : refused.failures[0].kind).toBe('retryable');
    expect(tree.snapshot()).toEqual(before);
    expect(expectSuccess(await store.verify(kept.contentId))).toEqual({
      contentId: kept.contentId,
      byteLength: 100_000,
    });
  });

  it('undoes an object whose seal the storage refuses, keeping nothing', async () => {
    const bytes = generatedBytes(0, 10_000, 12);
    const id = await identityOf(memorySource(bytes));
    const intent = await intentBytes(id, nodeDigest);
    const seal = await sealBytes({ contentId: id, byteLength: 10_000 }, nodeDigest);
    const tree = new MemoryStorageTree({
      quotaBytes: 2 * bytes.length + intent.length + seal.length - 1,
    });

    const refused = await storeOver(tree).put(memorySource(bytes));

    expect(expectFailureCode(refused)).toBe('media.storage-full');
    expect(tree.paths()).toEqual([]);
  });

  it('reports a source that changes while it is read, keeping nothing', async () => {
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);
    const whole = generatedSource(3 * CONTENT_CHUNK_BYTES, 4);
    let reads = 0;
    const shrinking: ByteSource = {
      size: whole.size,
      read: async (offset, length, signal) => {
        reads += 1;
        return (await whole.read(offset, length, signal)).subarray(0, reads === 2 ? 10 : length);
      },
    };

    expect(expectFailureCode(await store.put(shrinking))).toBe('media.source-changed');
    expect(tree.paths()).toEqual([]);
  });

  it('reports a storage that cannot be reached', async () => {
    class UnreachableTree extends MemoryStorageTree {
      override createFile(): Promise<never> {
        return Promise.reject(new TreeFailure(TreeFailureKind.Unavailable, 'private window'));
      }
    }

    const refused = await storeOver(new UnreachableTree()).put(
      memorySource(new Uint8Array([1, 2, 3])),
    );

    expect(expectFailureCode(refused)).toBe('media.storage-unavailable');
  });
});

describe('reading stored media', () => {
  it('opens an object at its sealed length, and refuses one it does not hold', async () => {
    const store = storeOver(new MemoryStorageTree());
    const bytes = generatedBytes(0, 1_000, 9);
    const { contentId } = expectSuccess(await store.put(memorySource(bytes)));

    const opened = expectSuccess(await store.open(contentId));

    expect(opened.size).toBe(1_000);
    expect(await opened.read(0, 1_000)).toEqual(bytes);
    const absent = await identityOf(memorySource(new Uint8Array([1])));
    expect(expectFailureCode(await store.open(absent))).toBe('media.object-missing');
    expect(expectSuccess(await store.find(absent))).toBeUndefined();
  });

  it('proves damage by hashing again, and trusts no object whose length is not its seal’s', async () => {
    const tree = new MemoryStorageTree();
    const { contentId } = expectSuccess(
      await storeOver(tree).put(memorySource(generatedBytes(0, 2_000, 8))),
    );
    const objectPath = tree.paths().find((path) => !path.endsWith('.seal')) ?? '';

    const flipped = new Map(tree.snapshot());
    const bytes = flipped.get(objectPath) ?? new Uint8Array(0);
    bytes[1_000] = (bytes[1_000] ?? 0) ^ 1;
    const damaged = storeOver(new MemoryStorageTree({}, flipped));
    expect(expectFailureCode(await damaged.verify(contentId))).toBe('media.object-damaged');

    const shortened = new Map(tree.snapshot());
    shortened.set(objectPath, bytes.subarray(0, 1_999));
    const short = storeOver(new MemoryStorageTree({}, shortened));
    expect(expectSuccess(await short.find(contentId))).toBeUndefined();
    expect(expectFailureCode(await short.open(contentId))).toBe('media.object-missing');
  });

  it('lists sealed objects in identifier order, and nothing unsealed or torn', async () => {
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);
    const ids: ContentId[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      ids.push(expectSuccess(await store.put(generatedSource(300 + seed, seed))).contentId);
    }
    const [unsealed, torn] = ids;
    const files = new Map(tree.snapshot());
    files.delete(`media/${(unsealed ?? '').slice(3, 5)}/${unsealed ?? ''}.seal`);
    const tornSeal = `media/${(torn ?? '').slice(3, 5)}/${torn ?? ''}.seal`;
    files.set(tornSeal, (files.get(tornSeal) ?? new Uint8Array(0)).subarray(0, 40));

    const listed = await allListed(storeOver(new MemoryStorageTree({}, files)));

    expect(listed).toEqual(ids.filter((id) => id !== unsealed && id !== torn).sort());
  });
});

describe('holding what a store returned until its reference is recorded', () => {
  it('holds each store until it is released, once per store', async () => {
    const store = storeOver(new MemoryStorageTree());
    const { contentId } = expectSuccess(await store.put(memorySource(new Uint8Array([5]))));
    expectSuccess(await store.put(memorySource(new Uint8Array([5]))));

    store.release(contentId);
    expect(store.isHeld(contentId)).toBe(true);
    store.release(contentId);
    expect(store.isHeld(contentId)).toBe(false);
    expect(() => {
      store.release(contentId);
    }).toThrow('Only a held media object can be released.');
  });
});
