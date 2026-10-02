import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import { CONTENT_CHUNK_BYTES, type ByteSource, type Digest } from '@audiogubbins/project-format';

import { CacheCategory, type CacheKey } from './cache-store.js';
import { exportBundle, exportUnpacked, importBundle, importUnpacked } from './project-transfer.js';
import {
  MemoryDirectory,
  memorySink,
  storageOf,
  storedMedia,
  type TestStorage,
} from './testing/memory-ports.js';
import { harnessOver, madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset, setName } from './testing/test-commands.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * Bringing a project in from its tree (REQ-STOR-103, REQ-STOR-099,
 * REQ-STOR-027): the identity it is kept under, decided once the tree is read,
 * and the caches it carries, each checked against the identity the tree lists
 * for it and none kept over a cache of shared media the storage holds.
 */

const WHOLE = { scope: { kind: 'whole-history' }, includeCaches: false } as const;
const WITH_CACHES = { ...WHOLE, includeCaches: true } as const;

/** A project with media, a change and a cache of each kind it carries, closed, in its storage. */
async function cachedProject(seed: number, mediaSize?: number) {
  const test = harness(seed);
  const storage = storageOf(test, new MemoryStorageTree());
  const media = await storedMedia(storage.store, seed, mediaSize);
  const header = await madeProject(test, storage.tree);
  const session = await openToWrite(test, storage.tree, header.id);
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
  expectSuccess(await session.run(setName('Brought in')));
  expectSuccess(await session.close());
  const preview: CacheKey = {
    category: CacheCategory.Render,
    scope: { kind: 'project', project: header.id },
    name: 'preview',
  };
  const peaks: CacheKey = {
    category: CacheCategory.Waveform,
    scope: { kind: 'media', content: media },
    name: 'peaks',
  };
  expectSuccess(await storage.caches.put(preview, new Uint8Array([1, 2, 3])));
  expectSuccess(await storage.caches.put(peaks, new Uint8Array([4, 5, 6, 7])));
  return { project: header.id, storage, media, preview, peaks };
}

/** A project's bundle, with its caches where asked. */
async function bundleOf(
  storage: TestStorage,
  project: ProjectId,
  options: typeof WHOLE | typeof WITH_CACHES = WHOLE,
) {
  const sink = memorySink();
  expectSuccess(
    expectSuccess(await exportBundle(project, sink, options, storage.exporting)).written,
  );
  return sink.bytes();
}

/** A project with media and a change, closed, and its bundle. */
async function bundledProject(seed: number) {
  const { project, storage } = await cachedProject(seed);
  return { project, bundle: await bundleOf(storage, project) };
}

/** A project's unpacked tree, caches and all. */
async function unpackedTree(storage: TestStorage, project: ProjectId) {
  const directory = new MemoryDirectory();
  const attempt = expectSuccess(
    await exportUnpacked(project, directory, WITH_CACHES, storage.exporting),
  );
  expectSuccess(attempt.written);
  return directory;
}

/** The bytes of the cache kept under `key`, or `undefined` where none is kept. */
async function cacheBytes(storage: TestStorage, key: CacheKey) {
  const opened = expectSuccess(await storage.caches.open(key));
  return opened === undefined ? undefined : await opened.read(0, opened.size);
}

/** `bytes` as a source that counts every byte read from it. */
function countedSource(
  bytes: Uint8Array<ArrayBuffer>,
): ByteSource & { readonly bytesRead: number } {
  const source = memorySource(bytes);
  let read = 0;
  return {
    size: source.size,
    get bytesRead() {
      return read;
    },
    read: async (offset, length, signal) => {
      const chunk = await source.read(offset, length, signal);
      read += chunk.length;
      return chunk;
    },
  };
}

async function targetHolding(seed: number, bundle: Uint8Array<ArrayBuffer>): Promise<TestStorage> {
  const target = storageOf(harness(seed), new MemoryStorageTree());
  expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));
  return target;
}

describe('the identity a project is brought in under', () => {
  it('keeps its own where the storage does not hold it, given either', async () => {
    const { project, bundle } = await bundledProject(301);
    const target = storageOf(harness(302), new MemoryStorageTree());

    const imported = expectSuccess(
      await importBundle(memorySource(bundle), 'original-or-copy', target.importing),
    );

    expect(imported.asCopy).toBe(false);
    expect(imported.header.id).toBe(project);
  });

  it('comes in as a copy where the storage holds it, reading the bundle once', async () => {
    const { project, bundle } = await bundledProject(303);
    const target = await targetHolding(304, bundle);
    const asCopy = countedSource(bundle);
    expectSuccess(await importBundle(asCopy, 'copy', target.importing));
    const either = countedSource(bundle);

    const imported = expectSuccess(
      await importBundle(either, 'original-or-copy', target.importing),
    );

    expect(imported.asCopy).toBe(true);
    expect(imported.header.id).not.toBe(project);
    expect(imported.header.imported?.from).toBe(project);
    expect(either.bytesRead).toBe(asCopy.bytesRead);
  });

  it('comes in as a copy while another window brings the same project in', async () => {
    const { project, bundle } = await bundledProject(305);
    const test = harness(306);
    const target = storageOf(test, new MemoryStorageTree());
    const other = await test.coordinator.acquire(project, {
      steal: false,
      owner: { instance: 'other', label: 'Another window' },
    });
    if (other.kind !== 'held') throw new Error('The other window should hold the lease.');

    const imported = expectSuccess(
      await importBundle(memorySource(bundle), 'original-or-copy', target.importing),
    );
    const refused = await importBundle(memorySource(bundle), 'original', target.importing);

    expect(imported.asCopy).toBe(true);
    expect(expectFailureCode(refused)).toBe('storage.project-busy');
    await other.lease.release();
  });

  it('refuses itself where the storage holds it and only itself is asked for', async () => {
    const { bundle } = await bundledProject(307);
    const target = await targetHolding(308, bundle);
    const listed = async (): Promise<readonly string[]> =>
      (await target.tree.list('projects')).map(({ name }) => name);
    const before = await listed();

    const refused = await importBundle(memorySource(bundle), 'original', target.importing);

    expect(expectFailureCode(refused)).toBe('storage.project-exists');
    expect(await listed()).toEqual(before);
  });
});

describe('the caches a project brings in', () => {
  it('keeps a cache of the project under the identity of the copy, beside the original one', async () => {
    const { project, storage, preview } = await cachedProject(311);
    const bundle = await bundleOf(storage, project, WITH_CACHES);
    const target = storageOf(harness(312), new MemoryStorageTree());
    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));
    expectSuccess(await target.caches.put(preview, new Uint8Array([9])));

    const { header } = expectSuccess(
      await importBundle(memorySource(bundle), 'copy', target.importing),
    );

    const copied: CacheKey = { ...preview, scope: { kind: 'project', project: header.id } };
    expect(await cacheBytes(target, copied)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await cacheBytes(target, preview)).toEqual(new Uint8Array([9]));
  });

  it('keeps a cache of media the project carries', async () => {
    const { project, storage, peaks } = await cachedProject(313);
    const bundle = await bundleOf(storage, project, WITH_CACHES);
    const target = storageOf(harness(314), new MemoryStorageTree());

    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));

    expect(await cacheBytes(target, peaks)).toEqual(new Uint8Array([4, 5, 6, 7]));
  });

  it('refuses a cache of media the project does not carry, and keeps nothing', async () => {
    const { project, storage, media } = await cachedProject(315);
    const elsewhere = await storedMedia(storage.store, 316);
    const directory = await unpackedTree(storage, project);
    moveCache(directory, `waveform/${media}/peaks`, `waveform/${elsewhere}/peaks`);
    const target = storageOf(harness(317), new MemoryStorageTree());

    const refused = await importUnpacked(directory, 'original', target.importing);

    expect(expectFailureCode(refused)).toBe('storage.bundle-cache-foreign');
    expect(await target.tree.list('projects')).toEqual([]);
  });

  it('never replaces a cache of media the storage holds already', async () => {
    const { project, storage, peaks } = await cachedProject(318);
    const bundle = await bundleOf(storage, project, WITH_CACHES);
    const target = storageOf(harness(319), new MemoryStorageTree());
    expectSuccess(await target.caches.put(peaks, new Uint8Array([8, 8])));

    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));

    expect(await cacheBytes(target, peaks)).toEqual(new Uint8Array([8, 8]));
  });

  it('refuses a cache of an unpacked tree whose bytes are not the ones the tree lists', async () => {
    const { project, storage, preview } = await cachedProject(320);
    const directory = await unpackedTree(storage, project);
    const path = `caches/render/${project}/preview`;
    expect(directory.files.get(path)).toEqual(new Uint8Array([1, 2, 3]));
    directory.files.set(path, new Uint8Array([1, 2, 4]));
    const target = storageOf(harness(321), new MemoryStorageTree());

    const refused = await importUnpacked(directory, 'original', target.importing);

    expect(expectFailureCode(refused)).toBe('storage.cache-damaged');
    expect(await target.tree.list('projects')).toEqual([]);
    expect(await cacheBytes(target, preview)).toBeUndefined();
  });
});

/** Moves a cache of an unpacked tree from one path under `caches/` to another, index and all. */
function moveCache(directory: MemoryDirectory, from: string, to: string): void {
  const bytes = directory.files.get(`caches/${from}`);
  const index = directory.files.get('caches/index.json');
  if (bytes === undefined || index === undefined) throw new Error('The tree carries no cache.');
  directory.files.delete(`caches/${from}`);
  directory.files.set(`caches/${to}`, bytes);
  const text = new TextDecoder().decode(index).replace(`"${from}"`, `"${to}"`);
  directory.files.set('caches/index.json', new TextEncoder().encode(text));
}

describe('the media a bundle brings in', () => {
  /** Media of three whole chunks and a part of one. */
  const SIZE = 3 * CONTENT_CHUNK_BYTES + 1_234;

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

  it('reads and hashes each piece once, and none the storage holds already', async () => {
    const { project, storage, media } = await cachedProject(341, SIZE);
    const bundle = await bundleOf(storage, project);
    const lacking = countedDigest();
    const target = storageOf(harnessOver(lacking.digest, 342), new MemoryStorageTree());
    const holding = countedDigest();
    const other = storageOf(harnessOver(holding.digest, 343), new MemoryStorageTree());
    expect(await storedMedia(other.store, 341, SIZE)).toBe(media);
    const heldBefore = holding.chunks();
    const first = countedSource(bundle);
    const again = countedSource(bundle);

    expectSuccess(await importBundle(first, 'original', target.importing));
    expectSuccess(await importBundle(again, 'original', other.importing));

    expect(lacking.chunks()).toBe(3);
    // Where the store holds it, the object is proved where it lies, once.
    expect(holding.chunks() - heldBefore).toBe(3);
    expect(again.bytesRead).toBeLessThanOrEqual(first.bytesRead - SIZE);
  });

  it('mends media the storage holds that was damaged in place, from the bundle', async () => {
    const { project, storage, media } = await cachedProject(343);
    const bundle = await bundleOf(storage, project);
    const tree = new MemoryStorageTree();
    const target = storageOf(harness(344), tree);
    const kept = await storedMedia(target.store, 343);
    expect(kept).toBe(media);
    const object = `media/${media.slice(3, 5)}/${media}`;
    const damaged = tree.snapshot().get(object)?.slice();
    if (damaged === undefined) throw new Error('The store holds no such object.');
    damaged[10] = (damaged[10] ?? 0) ^ 0xff;
    await tree.writeFile(object, damaged);
    expect(expectFailureCode(await target.store.verify(media))).toBe('media.object-damaged');

    expectSuccess(await importBundle(memorySource(bundle), 'original', target.importing));

    expect(expectSuccess(await target.store.verify(media)).contentId).toBe(media);
  });
});
