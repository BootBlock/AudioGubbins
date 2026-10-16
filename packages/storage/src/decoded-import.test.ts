import { describe, expect, it } from 'vitest';

import { openAudio } from '@audiogubbins/codecs';
import {
  DEFAULT_LOOP_CROSSFADE_SHAPE,
  StandardLayouts,
  derivedSampleCount,
  type AssetId,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { ImportFileEvent } from '@audiogubbins/import-export';
import { SourceHandling, type ExternalFile, type ImportChoice } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import { contentIdOf } from '@audiogubbins/project-format';

import { importAudio } from './testing/one-file-import.js';
import type { StreamAnalysis } from './decoded-stream.js';
import { bytesSource } from './byte-streams.js';
import type { AudioImportServices } from './import-contracts.js';
import { FillableTree } from './testing/fillable-tree.js';
import { storageOf } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import {
  ANALYSIS,
  DESCRIPTION,
  FLAC_BYTES,
  FakeStream,
  fakeDecoding,
  block,
  wholeStream,
} from './testing/decoded-streams.js';
import { addMarker, addRecord, addRegion } from './testing/test-commands.js';

/**
 * Importing a compressed file as a decoded rendition (ADR-0090): the codec
 * worker's stream, played here by a fake producer, is checked and sized before
 * anything is stored, written as a 32-bit float WAV file read back before it
 * is named, and added with the file kept as chosen and its loops and cues
 * placed, as one change; a stream refused, failed or cancelled keeps nothing.
 */

const IMPORTED_AT = 1_790_000_000_000;

function fileOf(bytes: Uint8Array = FLAC_BYTES): ExternalFile {
  return {
    source: memorySource(bytes),
    fileName: 'Rain.flac',
    mediaType: 'audio/flac',
    lastModified: IMPORTED_AT - 1_000,
    handleKey: 'handle-7',
  };
}

async function setUp(room?: number) {
  const test = harness(31);
  const memory = new MemoryStorageTree();
  const tree = new FillableTree(memory);
  const storage = storageOf(test, memory);
  const header = await madeProject(test, memory);
  const session = await openToWrite(test, memory, header.id);
  const services: AudioImportServices = {
    store: storage.store,
    digest: nodeDigest,
    yieldToHost: () => Promise.resolve(),
    commands: { addAsset: addRecord, addRegion, addMarker },
    tree,
    ids: test.ids,
    nextToken: () => test.ids.next<'AssetId'>(),
    room: () => Promise.resolve(room),
  };
  const assetId: AssetId = test.ids.next<'AssetId'>();
  return { session, services, storage, tree, memory, assetId };
}

type Scene = Awaited<ReturnType<typeof setUp>>;

async function storedObjects(scene: Scene) {
  const listed = [];
  for await (const object of scene.storage.store.list()) listed.push(object.contentId);
  return listed;
}

function staged(scene: Scene): readonly string[] {
  return scene.memory.paths().filter((path) => path.startsWith('cache/staging/'));
}

async function imported(
  scene: Scene,
  stream: FakeStream,
  options: {
    readonly analysis?: StreamAnalysis;
    readonly choice?: ImportChoice;
    readonly events?: ImportFileEvent[];
    readonly signal?: AbortSignal;
  } = {},
) {
  return await importAudio(
    scene.session,
    {
      file: fileOf(),
      choice: options.choice ?? { mode: SourceHandling.Copy },
      assetId: scene.assetId,
      importedAt: IMPORTED_AT,
      decoding: fakeDecoding(stream, options.analysis),
    },
    scene.services,
    (event) => options.events?.push(event),
    options.signal,
  );
}

describe('importing a compressed file as a decoded rendition (ADR-0090)', () => {
  it('stores the stream as a float WAV rendition the read contract reads, and keeps the file copied', async () => {
    const scene = await setUp();
    const events: ImportFileEvent[] = [];
    const stream = new FakeStream(wholeStream());
    const result = expectSuccess(await imported(scene, stream, { events }));

    expect(result.asset).toMatchObject({ displayName: 'Rain', sampleRate: 48_000, length: 2_400 });
    expect(result.asset.channelLayout).toEqual(StandardLayouts.stereo);
    const state = scene.session.getSnapshot().model.state;
    const source = state.sources.get(scene.assetId);
    if (source?.media.kind !== 'managed') throw new Error('A rendition is managed media.');
    expect(source.media.mediaType).toBe('audio/wav');
    const file = expectSuccess(await contentIdOf(bytesSource(FLAC_BYTES), nodeDigest));
    expect(source.provenance).toMatchObject({
      originalFileName: 'Rain.flac',
      byteLength: FLAC_BYTES.length,
      mediaType: 'audio/flac',
      rendition: {
        container: 'flac',
        codec: 'flac',
        sampleRate: 48_000,
        frames: 2_400,
        statedFrames: 2_400,
        bitRate: 900_000,
        leadingFrames: 0,
        decoder: { implementation: 'codec-module', name: 'Symphonia', version: '0.6.1' },
        kept: { kind: 'copied', contentId: file.contentId },
      },
      metadata: { text: { title: 'Rain on tin' } },
    });

    // The rendition reads back sample for sample as the stream decoded it.
    const reader = expectSuccess(
      await openAudio(expectSuccess(await scene.storage.store.open(source.media.contentId))),
    );
    expect(reader.format.encoding).toMatchObject({ kind: 'float', bits: 32 });
    const into = [new Float32Array(2_400), new Float32Array(2_400)];
    expect(expectSuccess(await reader.read(derivedSampleCount(0), 2_400, into))).toBe(2_400);
    const expected = [block(0, 1_000), block(1_000, 1_400)].flatMap((message) =>
      message.kind === 'block' ? [message.channels] : [],
    );
    for (const channel of [0, 1]) {
      const joined = Float32Array.from([
        ...(expected[0]?.[channel] ?? []),
        ...(expected[1]?.[channel] ?? []),
      ]);
      expect(into[channel]).toEqual(joined);
    }

    expect((await storedObjects(scene)).sort()).toEqual(
      [source.media.contentId, file.contentId].sort(),
    );
    expect(staged(scene)).toEqual([]);
    expect(stream.refusals).toEqual([]);
    expect(events[1]).toEqual({
      kind: 'recognised',
      format: { kind: 'audio', container: 'flac', codec: { kind: 'named', codec: 'flac' } },
    });
    // The file copied and the 2,400-frame stereo float rendition with its 58-byte header (with `fact`).
    expect(events[2]).toEqual({
      kind: 'room',
      needed: { kind: 'known', bytes: FLAC_BYTES.length + 2_400 * 2 * 4 + 58 },
    });
    expect(events.map((event) => event.kind)).toEqual([
      'analyse',
      'recognised',
      'room',
      'copy',
      'copy-progress',
      'decode',
      'decode-progress',
      'decode-progress',
      'add',
    ]);
  });

  it('places the file’s loops and cues as a region and a marker, undone with the asset as one change', async () => {
    const scene = await setUp();
    const result = expectSuccess(await imported(scene, new FakeStream(wholeStream())));
    expect(result.placed).toEqual({ regions: 1, markers: 1 });
    const { project } = scene.session.getSnapshot().model.state;
    expect([...project.regions.values()]).toEqual([
      expect.objectContaining({
        assetId: scene.assetId,
        displayName: 'Body',
        start: 0,
        end: 2_400,
        loop: {
          basis: 0,
          start: 600,
          end: 1_800,
          crossfadeLength: 0,
          crossfadeShape: DEFAULT_LOOP_CROSSFADE_SHAPE,
        },
      }),
    ]);
    expect([...project.markers.values()]).toEqual([
      expect.objectContaining({ assetId: scene.assetId, displayName: 'Drip', position: 300 }),
    ]);

    expectSuccess(await scene.session.undo());
    const undone = scene.session.getSnapshot().model.state.project;
    expect([undone.assets.size, undone.regions.size, undone.markers.size]).toEqual([0, 0, 0]);
  });

  it('places the file’s positions after the priming the decoder trimmed, leaving out those before it', async () => {
    const scene = await setUp();
    const analysis: StreamAnalysis = {
      ...ANALYSIS,
      leadingFrames: derivedSampleCount(400),
      metadata: {
        kind: 'read',
        metadata: {
          loops: DESCRIPTION.metadata.loops ?? [],
          cues: [
            { position: derivedSampleCount(300), name: 'Before the stream' },
            { position: derivedSampleCount(900), name: 'Drip' },
          ],
        },
      },
    };
    const result = expectSuccess(
      await imported(scene, new FakeStream(wholeStream()), { analysis }),
    );
    expect(result.skipped).toEqual({ loops: 0, cues: 1 });
    const { project } = scene.session.getSnapshot().model.state;
    expect([...project.regions.values()][0]?.loop).toMatchObject({ start: 200, end: 1_400 });
    expect([...project.markers.values()].map((marker) => marker.position)).toEqual([500]);
  });

  it('refuses a file the codec worker refuses, keeping nothing, and keeps the audio of one whose metadata is broken', async () => {
    const scene = await setUp();
    const unsupported = {
      code: 'codecs.unavailable',
      kind: 'rejected',
      summary: 'This browser cannot decode HE-AAC; use AAC-LC or Opus.',
    } as const;
    const refused = await importAudio(
      scene.session,
      {
        file: fileOf(),
        choice: { mode: SourceHandling.Copy },
        assetId: scene.assetId,
        importedAt: IMPORTED_AT,
        decoding: {
          analyse: () => Promise.resolve({ ok: false, failures: [unsupported] }),
          decode: () => Promise.reject(new Error('A refused file is never decoded.')),
        },
      },
      scene.services,
    );
    expect(expectFailureCode(refused)).toBe('codecs.unavailable');
    expect(await storedObjects(scene)).toEqual([]);

    const broken = {
      code: 'codecs.malformed',
      kind: 'integrity-violation',
      summary: 'Bad tag.',
    } as const;
    const kept = expectSuccess(
      await imported(scene, new FakeStream(wholeStream()), {
        analysis: { ...ANALYSIS, metadata: { kind: 'refused', failure: broken } },
      }),
    );
    expect(kept.metadataRefused).toEqual(broken);
    expect(kept.placed).toEqual({ regions: 0, markers: 0 });
  });

  it('keeps a linked file by its identity, storing the rendition alone', async () => {
    const scene = await setUp();
    const events: ImportFileEvent[] = [];
    expectSuccess(
      await imported(scene, new FakeStream(wholeStream()), {
        choice: { mode: SourceHandling.Link, keepProtectedCopy: false },
        events,
      }),
    );
    expect(events.find((event) => event.kind === 'room')).toEqual({
      kind: 'room',
      needed: { kind: 'known', bytes: 2_400 * 2 * 4 + 58 },
    });
    const source = scene.session.getSnapshot().model.state.sources.get(scene.assetId);
    expect(source?.provenance?.rendition?.kept).toMatchObject({
      kind: 'linked',
      identity: { handleKey: 'handle-7', fileName: 'Rain.flac', byteLength: FLAC_BYTES.length },
    });
    expect(await storedObjects(scene)).toHaveLength(1);
  });

  it('states the room needed as unknown beyond the copy where the stream states no length, and goes ahead', async () => {
    const scene = await setUp(FLAC_BYTES.length);
    const events: ImportFileEvent[] = [];
    expectSuccess(
      await imported(scene, new FakeStream(wholeStream()), {
        analysis: { ...ANALYSIS, statedFrames: undefined },
        events,
      }),
    );
    expect(events.find((event) => event.kind === 'room')).toEqual({
      kind: 'room',
      needed: { kind: 'unknown', atLeast: FLAC_BYTES.length },
    });
  });

  it('refuses a file the storage has no room for before storing anything or decoding at all', async () => {
    // The file and a 2,400-frame stereo rendition need about 23 kB.
    const scene = await setUp(20_000);
    const stream = new FakeStream(wholeStream());
    const result = await imported(scene, stream);

    expect(expectFailureCode(result)).toBe('import.no-room');
    // Refused on the codec worker's analysis, before any decoding begins.
    expect(stream.read).toBe(0);
    expect(await storedObjects(scene)).toEqual([]);
    expect(staged(scene)).toEqual([]);
  });

  it.each([
    [
      'a decode that fails part way',
      [
        { kind: 'description', description: DESCRIPTION },
        block(0, 1_000),
        {
          kind: 'failed',
          failure: {
            code: 'codec.corrupt',
            kind: 'integrity-violation',
            summary: 'The stream is corrupt.',
          },
        },
      ],
      'codec.corrupt',
    ],
    [
      'a block of the wrong channels',
      [
        { kind: 'description', description: DESCRIPTION },
        { kind: 'block', channels: [new Float32Array(10)], frames: 10 },
        { kind: 'end', frames: derivedSampleCount(10) },
      ],
      'import.stream-out-of-order',
    ],
    [
      'an end that is not the frames sent',
      [
        { kind: 'description', description: DESCRIPTION },
        block(0, 1_000),
        { kind: 'end', frames: derivedSampleCount(2_000) },
      ],
      'import.stream-out-of-order',
    ],
    [
      'a stream that stops before its end',
      [{ kind: 'description', description: DESCRIPTION }, block(0, 1_000)],
      'import.stream-out-of-order',
    ],
    [
      'a stream of no audio at all',
      [
        { kind: 'description', description: DESCRIPTION },
        { kind: 'end', frames: derivedSampleCount(0) },
      ],
      'import.stream-empty',
    ],
    [
      'a stream that does not begin with its description',
      [block(0, 1_000)],
      'import.stream-out-of-order',
    ],
    [
      'a stream at another rate than the one analysed',
      wholeStream({ ...DESCRIPTION, sampleRate: 44_100 }),
      'import.stream-out-of-order',
    ],
  ] as const)('keeps nothing of %s', async (_case, messages, code) => {
    const scene = await setUp();
    const stream = new FakeStream(messages);
    const result = await imported(scene, stream);

    expect(expectFailureCode(result)).toBe(code);
    expect(scene.session.getSnapshot().model.state.project.assets.size).toBe(0);
    expect(staged(scene)).toEqual([]);
    for (const contentId of await storedObjects(scene)) {
      expect(scene.storage.store.isHeld(contentId)).toBe(false);
    }
  });

  it('keeps nothing when cancelled while it decodes, and tells the codec worker', async () => {
    const scene = await setUp();
    const controller = new AbortController();
    const stream = new FakeStream(wholeStream(), (read) => {
      if (read === 3) controller.abort(new Error('Called off.'));
    });
    await expect(imported(scene, stream, { signal: controller.signal })).rejects.toThrow(
      'Called off.',
    );

    expect(stream.refusals.map((refusal) => refusal.code)).toEqual(['import.cancelled']);
    expect(scene.session.getSnapshot().model.state.project.assets.size).toBe(0);
    expect(staged(scene)).toEqual([]);
    for (const contentId of await storedObjects(scene)) {
      expect(scene.storage.store.isHeld(contentId)).toBe(false);
    }
  });

  it('keeps nothing when the storage fills while it decodes, and says the storage is full', async () => {
    const scene = await setUp();
    const stream = new FakeStream(wholeStream(), (read) => {
      // Full once the description is read and the file kept, as the blocks arrive.
      if (read === 3) scene.tree.full = true;
    });
    const result = await imported(scene, stream);

    expect(expectFailureCode(result)).toBe('storage.full');
    expect(stream.refusals.map((refusal) => refusal.code)).toEqual(['storage.full']);
    scene.tree.full = false;
    expect(staged(scene)).toEqual([]);
    expect(scene.session.getSnapshot().model.state.project.assets.size).toBe(0);
  });
});
