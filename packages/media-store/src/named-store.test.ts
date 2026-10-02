import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  CONTENT_CHUNK_BYTES,
  contentIdOf,
  type ByteSink,
  type ByteSource,
  type ContentId,
  type Digest,
} from '@audiogubbins/project-format';

import { MediaObjectStore } from './object-store.js';
import {
  MemoryStorageTree,
  countedSharing,
  countingTokens,
  generatedBytes,
  memorySource,
} from './testing/index.js';
import { nodeDigest } from './testing/node-digest.js';

/**
 * Storing bytes under the name they are given, as media a bundle lists is
 * (REQ-STOR-099, REQ-EXEC-216): read, hashed and written once where the store
 * lacks them; where it holds them, proved where they lie with the bytes given
 * never read, and replaced where they were damaged in place.
 */

/** Media of three whole chunks and a part of one. */
const SIZE = 3 * CONTENT_CHUNK_BYTES + 1_234;

/** A tree that counts the bytes written into each object of the store, seals and intents aside. */
class CountingTree extends MemoryStorageTree {
  objectBytes = 0;

  override async createFile(path: string): Promise<ByteSink> {
    const sink = await super.createFile(path);
    const counted = /^media\/[0-9a-f]{2}\/c1-[0-9a-f]{64}$/u.test(path);
    return {
      write: async (chunk) => {
        if (counted) this.objectBytes += chunk.length;
        await sink.write(chunk);
      },
      close: async () => {
        await sink.close();
      },
      abort: async (reason) => {
        await sink.abort(reason);
      },
    };
  }
}

/** A digest that counts the whole chunks it hashes, each one pass over a chunk of media. */
function countedDigest(): { readonly digest: Digest; readonly chunks: () => number } {
  let chunks = 0;
  return {
    digest: async (bytes) => {
      if (bytes.length === CONTENT_CHUNK_BYTES) chunks += 1;
      return await nodeDigest(bytes);
    },
    chunks: () => chunks,
  };
}

function storeOver(tree: MemoryStorageTree, digest: Digest = nodeDigest): MediaObjectStore {
  return new MediaObjectStore({
    tree,
    root: 'media',
    digest,
    nextToken: countingTokens(),
    sharing: countedSharing(),
  });
}

async function identityOf(bytes: Uint8Array<ArrayBuffer>): Promise<ContentId> {
  return expectSuccess(await contentIdOf(memorySource(bytes), nodeDigest)).contentId;
}

/** A source that fails the test if it is read at all. */
function unread(size: number): ByteSource {
  return {
    size,
    read: () => Promise.reject(new Error('The bytes given were read.')),
  };
}

describe('storing bytes under the name they are given', () => {
  it('reads, hashes and writes them once where the store lacks them', async () => {
    const bytes = generatedBytes(0, SIZE, 5);
    const contentId = await identityOf(bytes);
    const tree = new CountingTree();
    const counted = countedDigest();
    const store = storeOver(tree, counted.digest);

    const stored = expectSuccess(await store.putNamed(memorySource(bytes), contentId));

    expect(stored).toEqual({ contentId, byteLength: SIZE, deduplicated: false });
    expect(counted.chunks()).toBe(3);
    expect(tree.objectBytes).toBe(SIZE);
    expect(tree.paths()).toHaveLength(2);
    expect(expectSuccess(await store.verify(contentId)).contentId).toBe(contentId);
  });

  it('refuses bytes that are not the media they are named as, keeping nothing', async () => {
    const named = await identityOf(generatedBytes(0, 4_000, 6));
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);

    const refused = await store.putNamed(memorySource(generatedBytes(0, 4_000, 7)), named);

    expect(expectFailureCode(refused)).toBe('media.not-as-named');
    expect(expectSuccess(await store.find(named))).toBeUndefined();
    expect(tree.paths()).toEqual([]);
    expect(store.isHeld(named)).toBe(false);
  });

  it('proves an object it holds where it lies, never reading the bytes given', async () => {
    const bytes = generatedBytes(0, SIZE, 8);
    const contentId = await identityOf(bytes);
    const tree = new CountingTree();
    const counted = countedDigest();
    const store = storeOver(tree, counted.digest);
    expectSuccess(await store.put(memorySource(bytes)));
    store.release(contentId);
    const [chunksBefore, bytesBefore] = [counted.chunks(), tree.objectBytes];

    const found = expectSuccess(await store.putNamed(unread(SIZE), contentId));

    expect(found).toEqual({ contentId, byteLength: SIZE, deduplicated: true });
    expect(counted.chunks() - chunksBefore).toBe(3);
    expect(tree.objectBytes - bytesBefore).toBe(0);
    expect(store.isHeld(contentId)).toBe(true);
  });

  it('replaces an object damaged in place with the bytes given', async () => {
    const bytes = generatedBytes(0, 9_000, 9);
    const contentId = await identityOf(bytes);
    const tree = new MemoryStorageTree();
    const store = storeOver(tree);
    expectSuccess(await store.put(memorySource(bytes)));
    store.release(contentId);
    const object = `media/${contentId.slice(3, 5)}/${contentId}`;
    const damaged = bytes.slice();
    damaged[100] = (damaged[100] ?? 0) ^ 0xff;
    await tree.writeFile(object, damaged);

    const repaired = expectSuccess(await store.putNamed(memorySource(bytes), contentId));

    expect(repaired.deduplicated).toBe(false);
    expect(expectSuccess(await store.verify(contentId)).contentId).toBe(contentId);
    expect(tree.snapshot().get(object)).toEqual(bytes);
  });
});
