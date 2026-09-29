import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { BackupScheduler } from './backup-scheduler.js';
import { CacheCategory } from './cache-store.js';
import { storageOf, storedMedia } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset, setName } from './testing/test-commands.js';
import { measureUsage } from './usage-measurement.js';

/**
 * Usage by category (REQ-STOR-200): media in use, media only the history keeps
 * and media nothing keeps are told apart; so are the journal, the states of
 * snapshots, of alternative branches and of the line the project is on, the
 * caches and the backups; and every byte of a project's files is counted in
 * exactly one category.
 */

function sizeUnder(tree: MemoryStorageTree, prefix: string): number {
  return [...tree.snapshot()]
    .filter(([path]) => path.startsWith(prefix))
    .reduce((sum, [, bytes]) => sum + bytes.length, 0);
}

describe('usage by category (REQ-STOR-200)', () => {
  it('tells every category apart', async () => {
    const test = harness(3);
    const tree = new MemoryStorageTree();
    const storage = storageOf(test, tree);
    const inUse = await storedMedia(storage.store, 1, 1_000);
    const deleted = await storedMedia(storage.store, 2, 2_000);
    await storedMedia(storage.store, 3, 4_000);
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id, {
      cadence: { checkpointAfter: 1_000, keepStateEvery: 1 },
    });
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), inUse)));
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), deleted)));
    expectSuccess(await session.run(setName('A branch left behind')));
    expectSuccess(await session.undo());
    expectSuccess(await session.undo());
    expectSuccess(await session.run(setName('The line the project is on')));
    expectSuccess(await session.createSnapshot({ name: 'For the client' }));
    expectSuccess(
      await storage.caches.put(
        {
          category: CacheCategory.Waveform,
          scope: { kind: 'media', content: inUse },
          name: 'peaks',
        },
        new Uint8Array(64),
      ),
    );

    const open = expectSuccess(
      await measureUsage(storage.exporting, [session.getSnapshot().model.state]),
    );
    expect(open.journal).toBeGreaterThan(0);
    expect(open.sourceMedia).toBe(1_000);
    expect(open.retainedDeletedMedia).toBe(2_000);
    expect(open.unreferencedMedia).toBe(4_000);

    expectSuccess(await session.close());
    const closed = expectSuccess(await measureUsage(storage.exporting));
    expect(closed.journal).toBe(0);
    expect(closed.namedSnapshots).toBeGreaterThan(0);
    expect(closed.alternativeBranches).toBeGreaterThan(0);
    expect(closed.recoveryCheckpoints).toBeGreaterThan(0);
    expect(
      closed.journal +
        closed.namedSnapshots +
        closed.alternativeBranches +
        closed.recoveryCheckpoints,
    ).toBe(sizeUnder(tree, 'projects/'));
    expect(closed.caches.get(CacheCategory.Waveform)).toBe(sizeUnder(tree, 'cache/waveform/'));
    expect(closed.backups).toBe(0);
    expect(closed.unreadable).toEqual([]);
  });

  it('counts media added since the last checkpoint as in use where the open project says so', async () => {
    const test = harness(4);
    const tree = new MemoryStorageTree();
    const storage = storageOf(test, tree);
    const added = await storedMedia(storage.store, 5, 1_500);
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(
      await session.setBackupPolicy({
        kind: 'automatic',
        trigger: { everyChanges: 1 },
        retention: {},
      }),
    );
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), added)));

    const without = expectSuccess(await measureUsage(storage.exporting));
    expect(without.retainedDeletedMedia).toBe(1_500);
    const live = expectSuccess(
      await measureUsage(storage.exporting, [session.getSnapshot().model.state]),
    );
    expect(live.sourceMedia).toBe(1_500);

    const scheduler = new BackupScheduler(header.id, storage.exporting);
    expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
    const backedUp = expectSuccess(await measureUsage(storage.exporting));
    expect(backedUp.backups).toBe(sizeUnder(tree, 'backups/'));
    expect(backedUp.backups).toBeGreaterThan(0);
  });
});
