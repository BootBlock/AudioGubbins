import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import type { ByteSource } from '@audiogubbins/project-format';

import { exportBundle, importBundle } from './project-transfer.js';
import { memorySink, storageOf, storedMedia, type TestStorage } from './testing/memory-ports.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset, setName } from './testing/test-commands.js';
import { harness } from './testing/node-services.js';

/**
 * Bringing a project in from its tree (REQ-STOR-103, REQ-STOR-099): the
 * identity it is kept under, decided once the tree is read.
 */

const WHOLE = { scope: { kind: 'whole-history' }, includeCaches: false } as const;

/** A project with media and a change, closed, and its bundle. */
async function bundledProject(seed: number) {
  const test = harness(seed);
  const storage = storageOf(test, new MemoryStorageTree());
  const media = await storedMedia(storage.store, seed);
  const header = await madeProject(test, storage.tree);
  const session = await openToWrite(test, storage.tree, header.id);
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
  expectSuccess(await session.run(setName('Brought in')));
  expectSuccess(await session.close());
  const sink = memorySink();
  expectSuccess(
    expectSuccess(await exportBundle(header.id, sink, WHOLE, storage.exporting)).written,
  );
  return { project: header.id, bundle: sink.bytes() };
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
