import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { ContentId } from '@audiogubbins/project-format';

import { BackupScheduler, type ExternalBackupTarget } from './backup-scheduler.js';
import { exportBundle, exportUnpacked } from './project-transfer.js';
import { MemoryDirectory, memorySink, storageOf, storedMedia } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addAsset } from './testing/test-commands.js';

/**
 * Media copied out of the store is proved to be the media its identity names
 * (REQ-STOR-099, REQ-STOR-103): an object damaged in the store since it was
 * stored, though of its sealed length, refuses the bundle, the unpacked tree
 * and the backup directory's copy, naming the object, rather than write a copy
 * that could never be brought in again.
 */

const WHOLE = { scope: { kind: 'whole-history' }, includeCaches: false } as const;

/** A closed project holding one piece of media, whose bytes in the store are then damaged. */
async function damagedMedia() {
  const test = harness(141);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const media = await storedMedia(storage.store, 141);
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  expectSuccess(
    await session.setBackupPolicy({
      kind: 'automatic',
      trigger: { everyChanges: 100 },
      retention: { count: 10 },
      external: true,
    }),
  );
  expectSuccess(await session.run(addAsset(test.ids.next<'AssetId'>(), media)));
  await damage(tree, media);
  return { test, storage, project: header.id, session, media };
}

/** Changes one byte of a stored object, keeping its length, as a disc might. */
async function damage(tree: MemoryStorageTree, media: ContentId): Promise<void> {
  const path = tree.paths().find((one) => one.startsWith('media/') && one.endsWith(media));
  if (path === undefined) throw new Error('The media is not stored.');
  const bytes = await tree.readFile(path);
  if (bytes === undefined) throw new Error('The media cannot be read.');
  bytes[bytes.length >> 1] = (bytes[bytes.length >> 1] ?? 0) ^ 0xff;
  await tree.writeFile(path, bytes);
}

describe('media damaged in the store, copied out', () => {
  it('refuses the bundle, naming the object, and abandons what was written', async () => {
    const { storage, project, session, media } = await damagedMedia();
    expectSuccess(await session.close());
    const sink = memorySink();
    const attempt = expectSuccess(await exportBundle(project, sink, WHOLE, storage.exporting));
    expect(attempt.written).toMatchObject({
      ok: false,
      failures: [{ code: 'storage.media-damaged', details: { contentId: media } }],
    });
    expect(sink.ending).toBe('aborted');
  });

  it('refuses the unpacked tree, naming the object, and keeps no file of it', async () => {
    const { storage, project, session, media } = await damagedMedia();
    expectSuccess(await session.close());
    const folder = new MemoryDirectory();
    const attempt = expectSuccess(await exportUnpacked(project, folder, WHOLE, storage.exporting));
    expect(attempt.written).toMatchObject({
      ok: false,
      failures: [{ code: 'storage.media-damaged', details: { contentId: media } }],
    });
    expect([...folder.files.keys()].some((path) => path.includes(media))).toBe(false);
  });

  it('refuses the copy in the backup directory, naming the object', async () => {
    const { test, storage, project, session, media } = await damagedMedia();
    const target: ExternalBackupTarget = { create: () => Promise.resolve(memorySink()) };
    const scheduler = new BackupScheduler(project, storage.exporting, target);
    const made = expectSuccess(
      await scheduler.backUpNow(test.clock.now(), session.getSnapshot().model),
    );
    expect(made).toMatchObject({
      kind: 'made',
      external: {
        kind: 'failed',
        failure: { code: 'storage.media-damaged', details: { contentId: media } },
      },
    });
  });
});
