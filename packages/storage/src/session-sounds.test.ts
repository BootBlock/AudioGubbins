import { describe, expect, it } from 'vitest';

import { openAudio } from '@audiogubbins/codecs';
import {
  FailureKind,
  StandardLayouts,
  derivedSampleCount,
  fail,
  failure,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';

import { writeWav } from '@audiogubbins/codecs/testing';
import type { FileDecoding } from './decoded-stream.js';
import { SessionSounds } from './session-sounds.js';
import { mediaSharingOf, whileAlone } from './storage-sharing.js';
import {
  ANALYSIS,
  FLAC_BYTES,
  FakeStream,
  block,
  fakeDecoding,
  wholeStream,
} from './testing/decoded-streams.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';

/**
 * A sound the session holds and no project does, decoded into the staging
 * (ADR-0090): refused as an import is refused, sized before anything is
 * written, written as it arrives and read back as the WAV file its threads
 * read, held under the storage-wide lock, and removed once let go.
 */

function fileOf(bytes: Uint8Array = FLAC_BYTES): ExternalFile {
  return {
    source: memorySource(bytes),
    fileName: 'Reel.webm',
    mediaType: 'video/webm',
    lastModified: 1_790_000_000_000,
  };
}

function setUp(room?: number) {
  const tree = new MemoryStorageTree();
  const coordinator = new MemoryLeaseCoordinator();
  let tokens = 0;
  const sounds = new SessionSounds({
    tree,
    nextToken: () => {
      tokens += 1;
      return `t${String(tokens)}`;
    },
    room: () => Promise.resolve(room),
    sharing: mediaSharingOf(coordinator),
  });
  return { tree, coordinator, sounds };
}

type Scene = ReturnType<typeof setUp>;

function staged(scene: Scene): readonly string[] {
  return scene.tree.paths().filter((path) => path.startsWith('cache/staging/'));
}

/** Whether a window starting now could take the storage-wide lock alone. */
async function startingAloneFinds(scene: Scene): Promise<string> {
  return (await whileAlone(scene.coordinator, () => Promise.resolve())).kind;
}

/** The file a sound's threads read: its header, then its data. */
async function fileOfSound(scene: Scene, header: Uint8Array, path: string) {
  const data = await scene.tree.openFile(path);
  if (data === undefined) throw new Error('The sound has no data.');
  const bytes = new Uint8Array(header.length + data.size);
  bytes.set(header);
  bytes.set(await data.read(0, data.size), header.length);
  return memorySource(bytes);
}

describe('a sound the session holds (ADR-0090)', () => {
  it('decodes the file into the staging, as a WAV file of the stream read back whole', async () => {
    const scene = setUp();

    const sound = expectSuccess(
      await scene.sounds.decode(fileOf(), fakeDecoding(new FakeStream(wholeStream()))),
    );

    expect(sound).toMatchObject({
      sampleRate: 48_000,
      layout: StandardLayouts.stereo,
      frames: 2_400,
      decoder: ANALYSIS.decoder,
    });
    expect(staged(scene)).toEqual([sound.dataPath]);
    expect(sound.dataPath).toMatch(/^cache\/staging\/session\//u);
    const reader = expectSuccess(
      await openAudio(await fileOfSound(scene, sound.header, sound.dataPath)),
    );
    const into = [new Float32Array(2_400), new Float32Array(2_400)];
    expect(expectSuccess(await reader.read(derivedSampleCount(0), 2_400, into))).toBe(2_400);
    const first = block(0, 1_000);
    expect(first.kind === 'block' && [...(into[1]?.subarray(0, 1_000) ?? [])]).toEqual(
      first.kind === 'block' && [...(first.channels[1] ?? [])],
    );
  });

  it('shares the storage-wide lock while it holds a sound, and removes it once let go', async () => {
    const scene = setUp();
    const sound = expectSuccess(
      await scene.sounds.decode(fileOf(), fakeDecoding(new FakeStream(wholeStream()))),
    );

    expect(await startingAloneFinds(scene)).toBe('busy');

    await scene.sounds.discard(sound.token);

    expect(staged(scene)).toEqual([]);
    expect(await startingAloneFinds(scene)).toBe('done');
  });

  it('refuses a file the codecs here cannot decode with the reason an import gives, decoding nothing', async () => {
    const scene = setUp();
    const stream = new FakeStream(wholeStream());
    const refusal = failure('codec-runtime.codec-unavailable', FailureKind.Rejected, 'No.');
    const decoding: FileDecoding = {
      analyse: () => Promise.resolve(fail(refusal)),
      decode: () => Promise.reject(new Error('A refused file is never decoded.')),
    };

    const refused = await scene.sounds.decode(fileOf(), decoding);

    expect(refused.ok ? refused.value : refused.failures[0]).toBe(refusal);
    expect(stream.read).toBe(0);
    expect(staged(scene)).toEqual([]);
    expect(await startingAloneFinds(scene)).toBe('done');
  });

  it('refuses a file that is not audio, as an import does', async () => {
    const scene = setUp();

    expect(
      expectFailureCode(
        await scene.sounds.decode(
          fileOf(new TextEncoder().encode('Not a sound.')),
          fakeDecoding(new FakeStream(wholeStream())),
        ),
      ),
    ).toBe('codecs.unsupported-format');
  });

  it('refuses audio read where it lies, which is imported rather than opened', async () => {
    const scene = setUp();
    const wav = writeWav({
      sampleRate: 48_000,
      encoding: { kind: 'integer', bits: 16 },
      channels: [new Float32Array(100)],
    });

    expect(
      expectFailureCode(
        await scene.sounds.decode(fileOf(wav), fakeDecoding(new FakeStream(wholeStream()))),
      ),
    ).toBe('import.sound-read-in-place');
  });

  it('refuses a sound the storage has no room for before decoding any of it', async () => {
    // Two channels of 2,400 32-bit frames need more than 19,200 bytes.
    const scene = setUp(19_200);
    const stream = new FakeStream(wholeStream());

    expect(expectFailureCode(await scene.sounds.decode(fileOf(), fakeDecoding(stream)))).toBe(
      'import.no-room',
    );
    expect(stream.read).toBe(0);
    expect(staged(scene)).toEqual([]);
  });

  it('keeps nothing of a stream that fails part way, and tells the codec worker', async () => {
    const scene = setUp();
    const broken = failure('codec-runtime.decode-failed', FailureKind.Rejected, 'It broke.');
    const stream = new FakeStream([
      ...wholeStream().slice(0, 2),
      { kind: 'failed', failure: broken },
    ]);

    const failed = await scene.sounds.decode(fileOf(), fakeDecoding(stream));

    expect(failed.ok ? failed.value : failed.failures[0]).toBe(broken);
    expect(staged(scene)).toEqual([]);
    expect(await startingAloneFinds(scene)).toBe('done');
  });

  it('keeps nothing of a stream that is not the one analysed', async () => {
    const scene = setUp();
    const stream = new FakeStream(wholeStream());

    expect(
      expectFailureCode(
        await scene.sounds.decode(
          fileOf(),
          fakeDecoding(stream, { ...ANALYSIS, layout: StandardLayouts.mono }),
        ),
      ),
    ).toBe('import.stream-out-of-order');
    expect(stream.refusals).toHaveLength(1);
    expect(staged(scene)).toEqual([]);
  });
});
