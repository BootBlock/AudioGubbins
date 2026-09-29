import { describe, expect, it } from 'vitest';

import type { AssetId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { observeFile, type ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import {
  SourceChangePolicy,
  contentIdOf,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type MediaSource,
} from '@audiogubbins/project-format';

import { bytesSource } from './byte-streams.js';
import { consolidate, type ConsolidationServices } from './consolidation.js';
import { storageOf } from './testing/memory-ports.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setMedia } from './testing/test-commands.js';
import { FillableTree } from './testing/fillable-tree.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * Consolidation (REQ-STOR-099): each linked asset becomes managed media by one
 * undoable change, taking the version the project uses and never a newer one; a
 * changed file is passed over for the person to decide, and a missing one falls
 * back to a retained copy of the same content.
 */

const AUDIO = new Uint8Array(Array.from({ length: 4_096 }, (_, index) => (index * 7) & 0xff));

function fileOf(bytes: Uint8Array<ArrayBuffer>): ExternalFile {
  return {
    source: memorySource(bytes),
    fileName: 'footstep.wav',
    mediaType: 'audio/wav',
    lastModified: 1_790_000_000_000,
    handleKey: 'handle-1',
  };
}

async function setUp(
  located: ExternalFile | undefined,
  media: (identity: ExternalSourceIdentity) => ExternalMedia,
) {
  const test = harness(8);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const header = await madeProject(test, tree);
  // The session writes through a tree that can fill up; the store does not.
  const sessionTree = new FillableTree(tree);
  const session = await openToWrite(test, sessionTree, header.id);
  const identity = expectSuccess(await observeFile(fileOf(AUDIO), nodeDigest));
  const asset = test.ids.next<'AssetId'>();
  expectSuccess(await session.run(setMedia(asset, media(identity))));
  const services: ConsolidationServices = {
    store: storage.store,
    digest: nodeDigest,
    locate: () => Promise.resolve(located),
    setMedia: (id: AssetId, managed: MediaSource) => setMedia(id, managed),
  };
  return { session, services, asset, storage, sessionTree };
}

const following = (identity: ExternalSourceIdentity): ExternalMedia => ({
  kind: 'external',
  identity,
  policy: SourceChangePolicy.Prompt,
});

describe('consolidation (REQ-STOR-099)', () => {
  it('copies an unchanged linked file into the store by one undoable change', async () => {
    const { session, services, asset, storage } = await setUp(fileOf(AUDIO), following);
    const { contentId } = expectSuccess(await contentIdOf(bytesSource(AUDIO), nodeDigest));
    const outcomes = expectSuccess(await consolidate(session, services));
    expect(outcomes).toEqual([{ asset, kind: 'consolidated', contentId }]);
    expect(session.getSnapshot().model.state.sources.get(asset)?.media).toMatchObject({
      kind: 'managed',
      contentId,
      byteLength: AUDIO.length,
    });
    expect(storage.store.isHeld(contentId)).toBe(false);
    expectSuccess(await storage.store.verify(contentId));

    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.sources.get(asset)?.media.kind).toBe('external');
  });

  it('holds what it copied, keeping every purge off it, until the change is saved', async () => {
    const { session, services, storage, sessionTree } = await setUp(fileOf(AUDIO), following);
    const { contentId } = expectSuccess(await contentIdOf(bytesSource(AUDIO), nodeDigest));
    sessionTree.full = true;
    expectSuccess(await consolidate(session, services));
    expect(session.getSnapshot().save.kind).toBe('not-saved');
    expect(storage.store.isHeld(contentId)).toBe(true);

    sessionTree.full = false;
    expect(await session.retry()).toEqual({ kind: 'saved' });
    expect(storage.store.isHeld(contentId)).toBe(false);
  });

  it('passes over a file that changed, and one that is missing with nothing retained', async () => {
    const changed = AUDIO.slice();
    changed[0] = 0xff;
    for (const located of [fileOf(changed), undefined]) {
      const { session, services, asset } = await setUp(located, following);
      const outcomes = expectSuccess(await consolidate(session, services));
      expect(outcomes).toEqual([
        { asset, kind: 'passed-over', reason: located === undefined ? 'missing' : 'changed' },
      ]);
      expect(session.getSnapshot().model.state.sources.get(asset)?.media.kind).toBe('external');
    }
  });

  it('takes the retained copy of a frozen asset, and of a missing file of the same content', async () => {
    const test = harness(9);
    const probe = storageOf(test, new MemoryStorageTree());
    const { contentId } = expectSuccess(await probe.store.put(memorySource(AUDIO)));
    for (const [located, media] of [
      [
        fileOf(AUDIO),
        (identity: ExternalSourceIdentity): ExternalMedia => ({
          kind: 'external',
          identity,
          policy: SourceChangePolicy.Freeze,
          retainedCopy: contentId,
        }),
      ],
      [
        undefined,
        (identity: ExternalSourceIdentity): ExternalMedia => ({
          kind: 'external',
          identity: { ...identity, contentId },
          policy: SourceChangePolicy.Prompt,
          retainedCopy: contentId,
        }),
      ],
    ] as const) {
      const { session, services, asset, storage } = await setUp(located, media);
      expectSuccess(await storage.store.put(memorySource(AUDIO)));
      storage.store.release(contentId);
      const outcomes = expectSuccess(await consolidate(session, services));
      expect(outcomes).toEqual([{ asset, kind: 'consolidated', contentId }]);
    }
  });
});
