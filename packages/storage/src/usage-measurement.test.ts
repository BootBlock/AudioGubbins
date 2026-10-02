import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { ContentId, MediaSource } from '@audiogubbins/project-format';

import { BackupScheduler } from './backup-scheduler.js';
import { CacheCategory } from './cache-store.js';
import { storageOf, storedMedia } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset, setMedia, setName } from './testing/test-commands.js';
import { measureUsage } from './usage-measurement.js';

/**
 * Usage by category (REQ-STOR-200): media in use, media only the history keeps,
 * by what keeps it, and media nothing keeps are told apart; so are the journal,
 * the states of snapshots, of alternative branches and of the line the project
 * is on, the history of other branches, the caches and the backups; and every
 * byte of a project's files is counted in exactly one category.
 */

/** Media kept by nothing but `elsewhere`, a backup or the journal. */
function keptElsewhere(elsewhere: number) {
  return { namedSnapshots: 0, undo: 0, alternativeBranches: 0, elsewhere };
}

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
    expect(open.retainedDeletedMedia).toEqual(keptElsewhere(2_000));
    expect(open.unreferencedMedia).toBe(4_000);

    expectSuccess(await session.close());
    const closed = expectSuccess(await measureUsage(storage.exporting));
    expect(closed.journal).toBe(0);
    expect(closed.retainedDeletedMedia).toEqual({
      namedSnapshots: 0,
      undo: 0,
      alternativeBranches: 2_000,
      elsewhere: 0,
    });
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
    expect(without.retainedDeletedMedia).toEqual(keptElsewhere(1_500));
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

  it('tells apart the media a snapshot, the line and another branch alone keep, and the history of other branches', async () => {
    const test = harness(6);
    const tree = new MemoryStorageTree();
    const storage = storageOf(test, tree);
    const snapshotted = await storedMedia(storage.store, 11, 1_100);
    const undone = await storedMedia(storage.store, 12, 1_200);
    const branched = await storedMedia(storage.store, 13, 1_300);
    const inUse = await storedMedia(storage.store, 14, 1_400);
    const managed = (contentId: ContentId): MediaSource => ({
      kind: 'managed',
      contentId,
      byteLength: 1,
      mediaType: 'audio/wav',
    });
    const header = await madeProject(test, tree);
    // No state is kept beside the checkpoints, so only the history's own
    // segments hold the branch.
    const session = await openToWrite(test, tree, header.id, {
      cadence: { checkpointAfter: 1_000, keepStateEvery: 1_000 },
    });
    const asset = test.ids.next<'AssetId'>();
    expectSuccess(await session.run(addAsset(asset, snapshotted)));
    expectSuccess(await session.createSnapshot({ name: 'First take' }));
    expectSuccess(await session.run(setMedia(asset, managed(undone))));
    expectSuccess(await session.run(setMedia(asset, managed(inUse))));
    expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), branched)));
    expectSuccess(await session.run(setName('Left behind')));
    expectSuccess(await session.undo());
    expectSuccess(await session.undo());
    expectSuccess(await session.run(setName('The line the project is on')));
    expectSuccess(await session.close());

    const usage = expectSuccess(await measureUsage(storage.exporting));
    expect(usage.sourceMedia).toBe(1_400);
    expect(usage.alternativeBranches).toBeGreaterThan(0);
    expect(usage.retainedDeletedMedia).toEqual({
      namedSnapshots: 1_100,
      undo: 1_200,
      alternativeBranches: 1_300,
      elsewhere: 0,
    });
    expect(
      usage.journal + usage.namedSnapshots + usage.alternativeBranches + usage.recoveryCheckpoints,
    ).toBe(sizeUnder(tree, 'projects/'));
  });
});
