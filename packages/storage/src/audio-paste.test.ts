import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  type Asset,
  type AssetId,
  type EditOperation,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { completeIdentity, type ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource, observeFile } from '@audiogubbins/media-store/testing';
import {
  SourceChangePolicy,
  contentIdFrom,
  storageKeyOf,
  type AssetRecord,
  type MediaSource,
} from '@audiogubbins/project-format';

import { pasteAudio, type AudioPaste, type AudioPasteServices } from './audio-paste.js';
import type { LocatedFile } from './consolidation.js';
import { FillableTree } from './testing/fillable-tree.js';
import { storageOf } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addRecord, applyEdit } from './testing/test-commands.js';

/**
 * Running a planned paste (ADR-0053): the records of media from another
 * project are added only once their media is shown to be there, and the paste
 * is one change; a missing or changed source refuses it, leaving the project
 * as it was.
 */

const RATE = sampleRate(48_000);

function bytesOf(seed: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 2_048 }, (_, index) => (index * seed) & 0xff);
}

function recordOf(id: AssetId, name: string, media: MediaSource): AssetRecord {
  const asset: Asset = {
    id,
    displayName: name,
    origin: AssetOrigin.Imported,
    sampleRate: expectSuccess(RATE),
    channelLayout: StandardLayouts.mono,
    length: derivedSampleCount(100),
    storageKey: storageKeyOf(id, media),
    edits: [],
  };
  return { asset, source: { media } };
}

function fileOf(bytes: Uint8Array<ArrayBuffer>): ExternalFile {
  return {
    source: memorySource(bytes),
    fileName: 'rain.wav',
    mediaType: 'audio/wav',
    lastModified: 1_790_000_000_000,
    handleKey: 'handle-1',
  };
}

async function setUp(located: LocatedFile = { kind: 'absent', reason: 'not-found' }) {
  const test = harness(31);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const header = await madeProject(test, tree);
  const sessionTree = new FillableTree(tree);
  const session = await openToWrite(test, sessionTree, header.id);
  const services: AudioPasteServices = {
    store: storage.store,
    digest: nodeDigest,
    yieldToHost: () => Promise.resolve(),
    locate: () => Promise.resolve(located),
    addAsset: addRecord,
    applyEdit,
  };

  /** Stores `bytes` and lets them go, as an earlier import would have. */
  const kept = async (bytes: Uint8Array<ArrayBuffer>): Promise<MediaSource> => {
    const { contentId, byteLength } = expectSuccess(await storage.store.put(memorySource(bytes)));
    storage.store.release(contentId);
    return { kind: 'managed', contentId, byteLength, mediaType: 'audio/wav' };
  };
  const destination = recordOf(test.ids.next<'AssetId'>(), 'Footstep', await kept(bytesOf(3)));
  expectSuccess(await session.run(addRecord(destination.asset, destination.source)));
  const deletion: EditOperation = {
    id: test.ids.next<'EditOperationId'>(),
    kind: 'delete',
    range: { start: derivedSampleCount(0), end: derivedSampleCount(10) },
  };
  const paste = (records: readonly AssetRecord[]): AudioPaste => ({
    description: 'Paste into “Footstep”',
    records,
    asset: destination.asset.id,
    operations: [deletion],
  });
  return { test, session, services, storage, sessionTree, kept, destination, deletion, paste };
}

describe('running a planned paste (ADR-0053)', () => {
  it('applies the edits as one change when it needs no media brought', async () => {
    const scene = await setUp();
    const outcome = expectSuccess(await pasteAudio(scene.session, scene.paste([]), scene.services));

    expect(outcome.kind).toBe('applied');
    const asset = scene.session
      .getSnapshot()
      .model.state.project.assets.get(scene.destination.asset.id);
    expect(asset?.edits).toEqual([scene.deletion]);
  });

  it('adds a record whose stored media is there, holding it until the change is saved', async () => {
    const scene = await setUp();
    const media = await scene.kept(bytesOf(5));
    if (media.kind !== 'managed') throw new Error('Kept media is managed.');
    const record = recordOf(scene.test.ids.next<'AssetId'>(), 'Rain', media);

    scene.sessionTree.full = true;
    expectSuccess(await pasteAudio(scene.session, scene.paste([record]), scene.services));
    expect(scene.storage.store.isHeld(media.contentId)).toBe(true);
    expect(scene.session.getSnapshot().model.state.sources.get(record.asset.id)).toEqual(
      record.source,
    );
    scene.sessionTree.full = false;
    expect(await scene.session.retry()).toEqual({ kind: 'saved' });
    expect(scene.storage.store.isHeld(media.contentId)).toBe(false);
  });

  it('refuses a record whose stored media is gone, leaving the project as it was', async () => {
    const scene = await setUp();
    const present = await scene.kept(bytesOf(5));
    if (present.kind !== 'managed') throw new Error('Kept media is managed.');
    const stored = recordOf(scene.test.ids.next<'AssetId'>(), 'Rain', present);
    const missing = recordOf(scene.test.ids.next<'AssetId'>(), 'Thunder', {
      kind: 'managed',
      contentId: expectSuccess(contentIdFrom(`c1-${'e'.repeat(64)}`)),
      byteLength: 10,
      mediaType: 'audio/wav',
    });
    const before = scene.session.getSnapshot().model.state;

    const refused = await pasteAudio(scene.session, scene.paste([stored, missing]), scene.services);

    expect(expectFailureCode(refused)).toBe('paste.media-unavailable');
    expect(refused.ok ? '' : refused.failures[0].summary).toBe(
      'The copied audio reads “Thunder”, which this browser no longer stores, so nothing was pasted.',
    );
    expect(scene.session.getSnapshot().model.state).toEqual(before);
    expect(scene.storage.store.isHeld(present.contentId)).toBe(false);
  });

  it('adds a linked record whose file is unchanged, and refuses one whose file changed', async () => {
    const bytes = bytesOf(9);
    const observed = expectSuccess(await observeFile(fileOf(bytes), nodeDigest));
    const identity = expectSuccess(
      await completeIdentity(observed, memorySource(bytes), {
        digest: nodeDigest,
        yieldToHost: () => Promise.resolve(),
      }),
    );
    const linked = (scene: Awaited<ReturnType<typeof setUp>>) =>
      recordOf(scene.test.ids.next<'AssetId'>(), 'Rain', {
        kind: 'external',
        identity,
        policy: SourceChangePolicy.Prompt,
      });

    const same = await setUp({ kind: 'found', file: fileOf(bytes) });
    const record = linked(same);
    expectSuccess(await pasteAudio(same.session, same.paste([record]), same.services));
    expect(same.session.getSnapshot().model.state.project.assets.has(record.asset.id)).toBe(true);

    const changed = await setUp({ kind: 'found', file: fileOf(bytesOf(11)) });
    expect(
      expectFailureCode(
        await pasteAudio(changed.session, changed.paste([linked(changed)]), changed.services),
      ),
    ).toBe('paste.media-unavailable');
  });
});
