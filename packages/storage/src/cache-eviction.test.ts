import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';

import { evictUnused } from './cache-eviction.js';
import { CacheCategory } from './cache-store.js';
import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { SessionSounds } from './session-sounds.js';
import { renditionScratchPath } from './staging-paths.js';
import { relieveStoragePressure } from './storage-pressure.js';
import { mediaSharingOf } from './storage-sharing.js';
import { FLAC_BYTES, FakeStream, fakeDecoding, wholeStream } from './testing/decoded-streams.js';
import { storageOf } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';

/**
 * Giving up the staging under storage pressure or in the person's cleanup
 * (REQ-STOR-106): its files are work in progress still used while anyone
 * shares the storage-wide lock, a sound the session holds, an export staged
 * or being staged and a rendition being decoded among them, so the staging is
 * kept whole while the lock is shared in any window, and given up once no one
 * shares it. Every other category goes at once.
 */

async function scene() {
  const test = harness(61);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  expectSuccess(
    await storage.caches.put(
      {
        category: CacheCategory.Temporary,
        scope: { kind: 'unstored', source: 'a'.repeat(64) },
        name: 'n',
      },
      new Uint8Array(32),
    ),
  );
  let tokens = 0;
  const sounds = new SessionSounds({
    tree,
    nextToken: () => {
      tokens += 1;
      return `t${String(tokens)}`;
    },
    room: () => Promise.resolve(undefined),
    sharing: mediaSharingOf(test.coordinator),
  });
  const held = expectSuccess(
    await sounds.decode(
      {
        source: memorySource(FLAC_BYTES),
        fileName: 'Reel.webm',
        mediaType: 'video/webm',
        lastModified: 0,
      },
      fakeDecoding(new FakeStream(wholeStream())),
    ),
  );
  return { test, tree, storage, sounds, held };
}

type Scene = Awaited<ReturnType<typeof scene>>;

function staged(world: Scene): readonly string[] {
  return world.tree.paths().filter((path) => path.startsWith('cache/staging/'));
}

describe('giving up the staging while it is in use (REQ-STOR-106)', () => {
  it('keeps a held sound under storage pressure, giving up every other cache', async () => {
    const world = await scene();

    const relief = expectSuccess(
      await relieveStoragePressure(world.storage.caches, world.test.coordinator),
    );

    expect(relief.kept).toEqual([CacheCategory.Staging]);
    expect(staged(world)).toEqual([world.held.dataPath]);
    expect(world.tree.paths().filter((path) => path.startsWith('cache/temporary/'))).toEqual([]);
  });

  it('gives up the staging once nothing in it is held, what was left in it with it', async () => {
    const world = await scene();
    const left = renditionScratchPath(world.test.ids.next<'ProjectId'>(), 'left');
    await world.tree.writeFile(left, new Uint8Array(16));
    await world.sounds.discard(world.held.token);

    const relief = expectSuccess(
      await relieveStoragePressure(world.storage.caches, world.test.coordinator),
    );

    expect(relief.kept).toEqual([]);
    expect(relief.freed.get(CacheCategory.Staging)).toBe(16);
    expect(staged(world)).toEqual([]);
  });

  it('keeps the staging while another window shares the lock, as one staging an export does', async () => {
    const world = await scene();
    await world.sounds.discard(world.held.token);
    const release = await mediaSharingOf(world.test.coordinator).share();
    const left = renditionScratchPath(world.test.ids.next<'ProjectId'>(), 'export');
    await world.tree.writeFile(left, new Uint8Array(16));

    const kept = expectSuccess(
      await evictUnused(world.storage.caches, CacheCategory.Staging, world.test.coordinator),
    );
    release();

    expect(kept).toEqual({ kind: 'in-use' });
    expect(staged(world)).toEqual([left]);
  });

  it('keeps the staging where windows cannot be told apart', async () => {
    const world = await scene();
    await world.sounds.discard(world.held.token);
    const left = renditionScratchPath(world.test.ids.next<'ProjectId'>(), 'left');
    await world.tree.writeFile(left, new Uint8Array(16));

    expect(
      expectSuccess(await evictUnused(world.storage.caches, CacheCategory.Staging, undefined)),
    ).toEqual({ kind: 'in-use' });
    expect(staged(world)).toEqual([left]);
  });

  it('says a cleanup of the staging removed nothing while a sound is held', async () => {
    const world = await scene();
    const services = world.storage.cleaning;
    const plan = expectSuccess(
      await planCleanup([{ kind: 'cache', category: CacheCategory.Staging }], services, 0),
    );

    const [outcome] = expectSuccess(await runCleanup(plan, undefined, services));

    expect(outcome).toMatchObject({ step: 'cache', freed: 0, refused: { kind: 'storing' } });
    expect(staged(world)).toEqual([world.held.dataPath]);
  });
});
