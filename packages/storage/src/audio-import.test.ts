import { describe, expect, it } from 'vitest';

import { writeAiff, writeWav } from '@audiogubbins/codecs/testing';
import { StandardLayouts, type AssetId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { SourceHandling, type ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import { contentIdOf, type ByteSource } from '@audiogubbins/project-format';

import { importAudio, type AudioImportServices } from './audio-import.js';
import { bytesSource } from './byte-streams.js';
import { FillableTree } from './testing/fillable-tree.js';
import { storageOf } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addRecord } from './testing/test-commands.js';

/**
 * Importing an audio file into an open project (ADR-0052, REQ-AUDIO-220): the
 * file is read by the codecs before anything is stored, brought in by copy or
 * link, and added as one asset whose shape is what the reader found.
 */

const IMPORTED_AT = 1_790_000_000_000;

/** `value` rounded to the nearest sample an integer of `bits` holds exactly. */
function coded(value: number, bits: number): number {
  const scale = 2 ** (bits - 1);
  return Math.round(value * scale) / scale;
}

/** A stereo 24-bit WAV of `frames` frames, cut short by `truncate` bytes. */
function stereoWav(frames: number, truncate = 0): Uint8Array<ArrayBuffer> {
  const channel = (seed: number) =>
    Float32Array.from({ length: frames }, (_, frame) => coded(Math.sin(frame * seed) * 0.5, 24));
  return Uint8Array.from(
    writeWav({
      sampleRate: 44_100,
      encoding: { kind: 'integer', bits: 24 },
      channels: [channel(0.01), channel(0.02)],
      truncate,
    }),
  );
}

function fileOf(source: ByteSource, fileName = 'Gravel footstep.wav'): ExternalFile {
  return {
    source,
    fileName,
    mediaType: 'audio/wav',
    lastModified: IMPORTED_AT - 1_000,
    handleKey: 'handle-1',
  };
}

async function setUp() {
  const test = harness(11);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const header = await madeProject(test, tree);
  const sessionTree = new FillableTree(tree);
  const session = await openToWrite(test, sessionTree, header.id);
  const services: AudioImportServices = {
    store: storage.store,
    digest: nodeDigest,
    yieldToHost: () => Promise.resolve(),
    invocation: addRecord,
  };
  const assetId: AssetId = test.ids.next<'AssetId'>();
  return { session, services, storage, sessionTree, assetId, tree };
}

/** Every sealed object the store holds. */
async function storedObjects(setUpOf: Awaited<ReturnType<typeof setUp>>) {
  const listed = [];
  for await (const object of setUpOf.storage.store.list()) listed.push(object.contentId);
  return listed;
}

describe('importing an audio file (ADR-0052)', () => {
  it('copies the file in and adds an asset of the shape the reader found, with that shape in its provenance', async () => {
    const scene = await setUp();
    const bytes = stereoWav(1_000);
    const imported = expectSuccess(
      await importAudio(
        scene.session,
        {
          file: fileOf(memorySource(bytes)),
          choice: { mode: SourceHandling.Copy },
          assetId: scene.assetId,
          importedAt: IMPORTED_AT,
        },
        scene.services,
      ),
    );

    const { contentId } = expectSuccess(await contentIdOf(bytesSource(bytes), nodeDigest));
    const state = scene.session.getSnapshot().model.state;
    expect(imported.outcome.kind).toBe('applied');
    expect(imported.shortfall).toBe(0);
    expect(state.project.assets.get(scene.assetId)).toEqual(imported.asset);
    expect(imported.asset).toMatchObject({
      displayName: 'Gravel footstep',
      sampleRate: 44_100,
      channelLayout: StandardLayouts.stereo,
      length: 1_000,
      edits: [],
    });
    const source = state.sources.get(scene.assetId);
    expect(source?.media).toEqual({
      kind: 'managed',
      contentId,
      byteLength: bytes.length,
      mediaType: 'audio/wav',
    });
    expect(source?.provenance?.audio).toEqual({
      container: 'wav',
      sampleRate: 44_100,
      encoding: 'integer',
      bitDepth: 24,
      byteOrder: 'little',
      frames: 1_000,
      declaredFrames: 1_000,
    });
    expect(source?.provenance?.originalFileName).toBe('Gravel footstep.wav');
    expect(await storedObjects(scene)).toEqual([contentId]);
    expect(scene.storage.store.isHeld(contentId)).toBe(false);
  });

  it('links the file where it lies, storing nothing, and records the layout the header states', async () => {
    const scene = await setUp();
    const bytes = Uint8Array.from(
      writeAiff({
        sampleSize: 16,
        sampleRate: 48_000,
        channels: [Float32Array.from({ length: 480 }, (_, frame) => coded(frame / 960, 16))],
      }),
    );
    const imported = expectSuccess(
      await importAudio(
        scene.session,
        {
          file: fileOf(memorySource(bytes), 'Kick.aiff'),
          choice: { mode: SourceHandling.Link, keepProtectedCopy: false },
          assetId: scene.assetId,
          importedAt: IMPORTED_AT,
        },
        scene.services,
      ),
    );

    const source = scene.session.getSnapshot().model.state.sources.get(scene.assetId);
    expect(imported.asset.displayName).toBe('Kick');
    expect(imported.asset.channelLayout).toEqual(StandardLayouts.mono);
    expect(source?.media.kind).toBe('external');
    expect(source?.provenance?.audio).toMatchObject({
      container: 'aiff',
      byteOrder: 'big',
      bitDepth: 16,
      frames: 480,
    });
    expect(await storedObjects(scene)).toEqual([]);
  });

  it('refuses a file it does not read before storing anything, naming what the file is', async () => {
    const scene = await setUp();
    const flac = new Uint8Array(4_096);
    flac.set([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
    const result = await importAudio(
      scene.session,
      {
        file: fileOf(memorySource(flac), 'Rain.flac'),
        choice: { mode: SourceHandling.Copy },
        assetId: scene.assetId,
        importedAt: IMPORTED_AT,
      },
      scene.services,
    );

    expect(expectFailureCode(result)).toBe('codecs.unsupported-format');
    expect(result.ok ? '' : result.failures[0].summary).toContain('FLAC');
    expect(await storedObjects(scene)).toEqual([]);
    expect(scene.session.getSnapshot().model.state.project.assets.size).toBe(0);
  });

  it('reads a file cut short to its last whole frame and says how far short it fell', async () => {
    const scene = await setUp();
    // Two frames and one byte of a 24-bit stereo file: two frames gone, one torn.
    const imported = expectSuccess(
      await importAudio(
        scene.session,
        {
          file: fileOf(memorySource(stereoWav(1_000, 13))),
          choice: { mode: SourceHandling.Copy },
          assetId: scene.assetId,
          importedAt: IMPORTED_AT,
        },
        scene.services,
      ),
    );

    expect(imported.asset.length).toBe(997);
    expect(imported.shortfall).toBe(3);
  });

  it('holds what it copied until the change is saved, and releases it at once where the change is refused', async () => {
    const scene = await setUp();
    const bytes = stereoWav(500);
    const { contentId } = expectSuccess(await contentIdOf(bytesSource(bytes), nodeDigest));
    const request = {
      file: fileOf(memorySource(bytes)),
      choice: { mode: SourceHandling.Copy },
      assetId: scene.assetId,
      importedAt: IMPORTED_AT,
    } as const;

    scene.sessionTree.full = true;
    expectSuccess(await importAudio(scene.session, request, scene.services));
    expect(scene.session.getSnapshot().save.kind).toBe('not-saved');
    expect(scene.storage.store.isHeld(contentId)).toBe(true);
    scene.sessionTree.full = false;
    expect(await scene.session.retry()).toEqual({ kind: 'saved' });
    expect(scene.storage.store.isHeld(contentId)).toBe(false);

    // The same identity again is refused by the command, so nothing refers to the copy.
    const refused = await importAudio(scene.session, request, scene.services);
    expect(expectFailureCode(refused)).toBe('test.asset-taken');
    expect(scene.storage.store.isHeld(contentId)).toBe(false);
  });

  it('keeps nothing when it is called off part of the way through the copy', async () => {
    const scene = await setUp();
    const bytes = stereoWav(200_000);
    const controller = new AbortController();
    const honest = memorySource(bytes);
    // Called off once the header is read and the copy has begun.
    const source: ByteSource = {
      size: honest.size,
      read: async (offset, length, signal) => {
        if (offset > 600_000) controller.abort(new Error('Called off.'));
        return await honest.read(offset, length, signal);
      },
    };

    await expect(
      importAudio(
        scene.session,
        {
          file: fileOf(source),
          choice: { mode: SourceHandling.Copy },
          assetId: scene.assetId,
          importedAt: IMPORTED_AT,
        },
        scene.services,
        controller.signal,
      ),
    ).rejects.toThrow('Called off.');

    expect(await storedObjects(scene)).toEqual([]);
    expect(scene.session.getSnapshot().model.state.project.assets.size).toBe(0);
    expect(scene.tree.paths().filter((path) => path.startsWith('media/'))).toEqual([]);
  });
});
