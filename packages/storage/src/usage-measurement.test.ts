import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { refOf } from '@audiogubbins/model-packs';
import { ANY_SHA256, sampleManifest } from '@audiogubbins/model-packs/testing';
import type { ByteSource, ContentId, MediaSource } from '@audiogubbins/project-format';

import { BackupScheduler } from './backup-scheduler.js';
import { CacheCategory } from './cache-store.js';
import type { ModelPackStore } from './model-pack-store.js';
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

/** A tree that notes every read of a file's bytes, whole or through a source. */
class ReadNotingTree extends MemoryStorageTree {
  readonly read = new Set<string>();

  override async readFile(path: string) {
    this.read.add(path);
    return await super.readFile(path);
  }

  override async openFile(path: string): Promise<ByteSource | undefined> {
    const source = await super.openFile(path);
    return source === undefined
      ? undefined
      : {
          size: source.size,
          read: async (offset, length, signal) => {
            this.read.add(path);
            return await source.read(offset, length, signal);
          },
        };
  }
}

/** Keeps a version of pack `id` whose one file holds `size` bytes, `kept` of them, sealed where whole. */
async function keptPack(packs: ModelPackStore, id: string, size: number, kept = size) {
  const manifest = sampleManifest({
    id,
    files: [{ path: 'model.onnx', bytes: size, sha256: ANY_SHA256 }],
  });
  expectSuccess(await packs.stage(manifest));
  const sink = expectSuccess(await packs.append(refOf(manifest), 0));
  await sink.write(new Uint8Array(kept));
  await sink.close();
  if (kept === size) expectSuccess(await packs.seal(refOf(manifest)));
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
      await measureUsage(storage.measuring, [session.getSnapshot().model.state]),
    );
    expect(open.journal).toBeGreaterThan(0);
    expect(open.sourceMedia).toBe(1_000);
    expect(open.retainedDeletedMedia).toEqual(keptElsewhere(2_000));
    expect(open.unreferencedMedia).toBe(4_000);

    expectSuccess(await session.close());
    const closed = expectSuccess(await measureUsage(storage.measuring));
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

    const without = expectSuccess(await measureUsage(storage.measuring));
    expect(without.retainedDeletedMedia).toEqual(keptElsewhere(1_500));
    const live = expectSuccess(
      await measureUsage(storage.measuring, [session.getSnapshot().model.state]),
    );
    expect(live.sourceMedia).toBe(1_500);

    const scheduler = new BackupScheduler(header.id, storage.exporting);
    expectSuccess(await scheduler.tick(test.clock.now(), session.getSnapshot().model));
    const backedUp = expectSuccess(await measureUsage(storage.measuring));
    expect(backedUp.backups).toBe(sizeUnder(tree, 'backups/'));
    expect(backedUp.backups).toBeGreaterThan(0);
  });

  it('counts installed model packs apart from partial downloads, by size alone', async () => {
    const test = harness(7);
    const tree = new ReadNotingTree();
    const storage = storageOf(test, tree);
    await keptPack(storage.packs, 'installed-pack', 4_000);
    await keptPack(storage.packs, 'paused-pack', 9_000, 2_500);
    await keptPack(storage.packs, 'torn-pack', 6_000, 1_000);
    const torn = 'packs/torn-pack/1.0.0/manifest.json';
    await tree.writeFile(torn, ((await tree.readFile(torn)) ?? new Uint8Array()).slice(0, 9));
    tree.read.clear();

    const usage = expectSuccess(await measureUsage(storage.measuring));
    expect(usage.packs).toEqual({
      installed: sizeUnder(tree, 'packs/installed-pack/'),
      partial: sizeUnder(tree, 'packs/paused-pack/') + sizeUnder(tree, 'packs/torn-pack/'),
    });
    expect(usage.packs.installed).toBeGreaterThan(4_000);
    expect(usage.packs.partial).toBeGreaterThan(3_500);
    expect([...tree.read].filter((path) => path.startsWith('packs/'))).not.toContainEqual(
      expect.stringContaining('/files/'),
    );
    expect(usage.sourceMedia + usage.unreferencedMedia + usage.backups).toBe(0);
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

    const usage = expectSuccess(await measureUsage(storage.measuring));
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
