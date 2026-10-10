import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import { ProvenanceLevel } from '@audiogubbins/project-format';
import type { StorageTree } from '@audiogubbins/project-format';

import { CacheCategory, type CacheKey } from './cache-store.js';

import type { CatalogueEntry } from './project-catalogue.js';
import { exportBundle, importBundle } from './project-transfer.js';
import { FillableTree } from './testing/fillable-tree.js';
import { memorySink, storageOf, storedMedia } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset } from './testing/test-commands.js';

/**
 * Bringing a bundle into a storage that fills up (REQ-EXEC-216, REQ-STOR-106):
 * the storage's refusal is a designed failure, nothing of the project is left
 * behind, and the same bundle comes in whole once there is room.
 */

async function listed(tree: StorageTree): Promise<readonly CatalogueEntry[]> {
  const entries: CatalogueEntry[] = [];
  for await (const entry of harness(62).repository(tree).list()) entries.push(entry);
  return entries;
}

describe('bringing a bundle into a full storage (REQ-EXEC-216)', () => {
  it('fails as storage full, leaves no project, and succeeds once there is room', async () => {
    const test = harness(61);
    const source = storageOf(test, new MemoryStorageTree());
    const media = await storedMedia(source.store, 61, 20_000);
    const header = await madeProject(test, source.tree);
    const session = await openToWrite(test, source.tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
    expectSuccess(await session.close());
    const sink = memorySink();
    expectSuccess(
      expectSuccess(
        await exportBundle(
          header.id,
          sink,
          {
            scope: { kind: 'whole-history', provenance: ProvenanceLevel.Full },
            includeCaches: false,
          },
          source.exporting,
        ),
      ).written,
    );

    const refusals: string[] = [];
    // The storage fills at each write of the import in turn, until one has room for all of it.
    for (let fullAtWrite = 1; ; fullAtWrite += 1) {
      const tree = new FillableTree(new MemoryStorageTree());
      tree.fullAtWrite = fullAtWrite;
      const target = storageOf(test, tree);
      const imported = await importBundle(memorySource(sink.bytes()), 'original', target.importing);
      if (imported.ok) break;
      refusals.push(imported.failures[0].code);
      expect(await listed(tree)).toEqual([]);

      // Room is made, and the same bundle comes in whole.
      tree.full = false;
      tree.fullAtWrite = undefined;
      expectSuccess(await importBundle(memorySource(sink.bytes()), 'original', target.importing));
      expect(await listed(tree)).toHaveLength(1);
    }
    // Full while the media was stored, and full while the project was written.
    expect(new Set(refusals)).toEqual(new Set(['media.storage-full', 'storage.full']));
  });
});

describe('bringing in a bundle whose caches the storage cannot hold (F-51)', () => {
  it('brings the project in whole, gives up the caches, and says which', async () => {
    const test = harness(63);
    const source = storageOf(test, new MemoryStorageTree());
    const media = await storedMedia(source.store, 63, 20_000);
    const header = await madeProject(test, source.tree);
    const session = await openToWrite(test, source.tree, header.id);
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
    expectSuccess(await session.close());
    const preview: CacheKey = {
      category: CacheCategory.Render,
      scope: { kind: 'project', project: header.id },
      name: 'preview',
    };
    expectSuccess(await source.caches.put(preview, new Uint8Array(4_096).fill(7)));
    const sink = memorySink();
    expectSuccess(
      expectSuccess(
        await exportBundle(
          header.id,
          sink,
          {
            scope: { kind: 'whole-history', provenance: ProvenanceLevel.Full },
            includeCaches: true,
          },
          source.exporting,
        ),
      ).written,
    );

    const memory = new MemoryStorageTree();
    const tree = new FillableTree(memory);
    tree.fullUnder = 'cache';
    const target = storageOf(test, tree);
    const imported = expectSuccess(
      await importBundle(memorySource(sink.bytes()), 'original', target.importing),
    );

    expect(imported.skippedCaches).toEqual([`render/${header.id}/preview`]);
    expect(await listed(tree)).toHaveLength(1);
    expect(expectSuccess(await target.caches.open(preview))).toBeUndefined();
    expect(memory.paths().filter((path) => path.startsWith('cache/'))).toEqual([]);
  });
});
