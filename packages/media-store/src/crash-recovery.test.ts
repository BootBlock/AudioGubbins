import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { CONTENT_CHUNK_BYTES, type ContentId } from '@audiogubbins/project-format';

import { collect, planCollection } from './collection.js';
import { MediaObjectStore } from './object-store.js';
import {
  MemoryStorageTree,
  SimulatedCrash,
  countingTokens,
  generatedSource,
  nodeDigest,
} from './testing/index.js';

/**
 * A crash at every operation of each change a store makes, each followed by a
 * restart and recovery, holds the store to its invariant: every object it
 * trusts is whole and hashes to its name, nothing it does not trust is left
 * behind, and nothing it trusted before the change is lost.
 */

type Files = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;

function storeOver(tree: MemoryStorageTree): MediaObjectStore {
  return new MediaObjectStore({
    tree,
    root: 'media',
    digest: nodeDigest,
    nextToken: countingTokens(),
  });
}

const LARGE = 2 * CONTENT_CHUNK_BYTES + 777;

/** A store holding one object of each of the given seeds, and their identities. */
async function storeHolding(
  ...seeds: readonly number[]
): Promise<[Files, (index: number) => ContentId]> {
  const tree = new MemoryStorageTree();
  const store = storeOver(tree);
  const ids: ContentId[] = [];
  for (const seed of seeds) {
    ids.push(expectSuccess(await store.put(generatedSource(LARGE, seed))).contentId);
  }
  const idAt = (index: number): ContentId => {
    const id = ids[index];
    if (id === undefined) throw new Error(`No object was stored at ${String(index)}.`);
    return id;
  };
  return [tree.snapshot(), idAt];
}

/** How many tree operations a change makes when nothing crashes. */
async function operationsOf(
  files: Files,
  change: (store: MediaObjectStore) => Promise<unknown>,
): Promise<number> {
  const tree = new MemoryStorageTree({}, files);
  await change(storeOver(tree));
  return tree.operations;
}

/**
 * Restarts and recovers a crashed tree, checks the invariant, and gives the
 * objects the recovered store trusts.
 */
async function recovered(crashed: MemoryStorageTree): Promise<readonly ContentId[]> {
  const tree = crashed.restarted();
  const store = storeOver(tree);
  expectSuccess(await store.recoverIncomplete());

  const trusted: ContentId[] = [];
  for await (const object of store.list()) {
    expect(expectSuccess(await store.verify(object.contentId))).toEqual(object);
    trusted.push(object.contentId);
  }
  const pairs = trusted.flatMap((id) => {
    const at = `media/${id.slice(3, 5)}/${id}`;
    return [at, `${at}.seal`];
  });
  expect(tree.paths()).toEqual(pairs.sort());
  return trusted;
}

async function crashesAt(
  crashAt: number,
  files: Files,
  change: (store: MediaObjectStore) => Promise<unknown>,
): Promise<MemoryStorageTree> {
  const tree = new MemoryStorageTree({ crashAt }, files);
  await expect(change(storeOver(tree))).rejects.toBeInstanceOf(SimulatedCrash);
  return tree;
}

describe('a crash while storing', () => {
  it('never leaves a trusted object whose bytes are not its name, whichever operation it hits', async () => {
    const [files, idAt] = await storeHolding(1);
    const kept = idAt(0);
    const change = (store: MediaObjectStore) => store.put(generatedSource(LARGE, 2));
    const added = (await storeHolding(2))[1](0);
    const total = await operationsOf(files, change);
    expect(total).toBeGreaterThan(15);

    for (let crashAt = 1; crashAt <= total; crashAt += 1) {
      const trusted = await recovered(await crashesAt(crashAt, files, change));

      expect(trusted, `crash at ${String(crashAt)}`).toContain(kept);
      expect(trusted.filter((id) => id !== kept && id !== added)).toEqual([]);
    }
  });

  it('keeps a deduplicated object whole, whichever operation it hits', async () => {
    const [files, idAt] = await storeHolding(3);
    const kept = idAt(0);
    const change = (store: MediaObjectStore) => store.put(generatedSource(LARGE, 3));
    const total = await operationsOf(files, change);

    for (let crashAt = 1; crashAt <= total; crashAt += 1) {
      expect(await recovered(await crashesAt(crashAt, files, change))).toEqual([kept]);
    }
  });

  it('recovers again after a crash during recovery itself', async () => {
    const [files] = await storeHolding(1);
    const change = (store: MediaObjectStore) => store.put(generatedSource(LARGE, 2));
    const total = await operationsOf(files, change);

    for (const putCrash of [4, Math.floor(total / 2), total - 3]) {
      const crashed = (await crashesAt(putCrash, files, change)).snapshot();
      const recovery = (store: MediaObjectStore) => store.recoverIncomplete();
      const steps = await operationsOf(crashed, recovery);
      for (let crashAt = 1; crashAt <= steps; crashAt += 1) {
        await recovered(await crashesAt(crashAt, crashed, recovery));
      }
    }
  });

  it('lets the store be made again once recovered', async () => {
    const [files] = await storeHolding(1);
    const change = (store: MediaObjectStore) => store.put(generatedSource(LARGE, 2));
    const crashed = await crashesAt(20, files, change);

    const tree = crashed.restarted();
    const store = storeOver(tree);
    expectSuccess(await store.recoverIncomplete());
    const again = expectSuccess(await store.put(generatedSource(LARGE, 2)));

    expect(expectSuccess(await store.verify(again.contentId))).toEqual({
      contentId: again.contentId,
      byteLength: LARGE,
    });
  });
});

describe('a crash while collecting', () => {
  it('removes an unreachable object whole or not at all, and keeps every rooted one', async () => {
    const [files, idAt] = await storeHolding(5, 6);
    const rooted = idAt(0);
    const unreachable = idAt(1);
    const planned = expectSuccess(
      await planCollection(storeOver(new MemoryStorageTree({}, files)), [rooted]),
    );
    expect(planned.unreachable.map(({ contentId }) => contentId)).toEqual([unreachable]);
    const change = (store: MediaObjectStore) =>
      collect(store, planned, { reclaimableBytes: planned.reclaimableBytes }, [rooted]);
    const total = await operationsOf(files, change);

    for (let crashAt = 1; crashAt <= total; crashAt += 1) {
      const trusted = await recovered(await crashesAt(crashAt, files, change));

      expect(trusted).toContain(rooted);
      expect(trusted.filter((id) => id !== rooted && id !== unreachable)).toEqual([]);
    }
  });
});
