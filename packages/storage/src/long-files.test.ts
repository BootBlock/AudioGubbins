import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  type ChannelLayout,
  type DomainFailure,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type {
  DecodedStreamMessage,
  EncodedStreamMessage,
  ExportSettings,
} from '@audiogubbins/import-export';
import { SourceHandling } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import type { Sha256 } from '@audiogubbins/model-packs';
import { stateFingerprintFrom, type ExportCodec } from '@audiogubbins/project-format';

import type { DecodedStream } from './decoded-stream.js';
import type { EncodedStream } from './encoded-stream.js';
import { deliverStaged } from './export-delivery.js';
import { ExportStaging, type ExportOrigin } from './export-staging.js';
import type { AudioImportServices } from './import-contracts.js';
import { mediaSharingOf } from './storage-sharing.js';
import { ANALYSIS, FLAC_BYTES, fakeDecoding } from './testing/decoded-streams.js';
import { MeasuredTree } from './testing/measured-tree.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';
import { storageOf } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { importAudio } from './testing/one-file-import.js';
import { SizedTree } from './testing/sized-tree.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addMarker, addRecord, addRegion } from './testing/test-commands.js';

/**
 * Long files through the storage, never held whole (the packet's third
 * acceptance criterion, ADR-0090, ADR-0092): a decoded stream and an encoded
 * one, each made a message at a time as the storage asks for it, written
 * through trees that measure every write and read of the audio.
 *
 * - A decoded import of many blocks, stereo and 5.1, each block at the caps the
 *   codec worker keeps to (65,536 frames, 1 MiB), is written to its rendition
 *   in the staging a block at a time, the next block asked for only once the
 *   last is written, and stored and kept in reads and writes of at most 1 MiB,
 *   every frame kept.
 * - An export past four gibibytes is staged a body at a time, read back once
 *   for its SHA-256 and once for its delivery in chunks of at most 1 MiB, and
 *   delivered whole.
 */

/** Four gibibytes, past which a WAV file's sizes no longer fit its 32-bit fields. */
const FOUR_GIB = 2 ** 32;

/** The most bytes a block of the stream holds, and the most the storage reads or writes at once. */
const MOST_BLOCK_BYTES = 1_048_576;

const IMPORTED_AT = 1_790_000_000_000;

/**
 * A codec worker's decoded stream of `frames` frames of `layout`, each block
 * made only when the storage asks for it, recording how many blocks it made
 * before the storage had written the ones before them.
 */
class MadeDecodedStream implements DecodedStream {
  readonly refusals: DomainFailure[] = [];
  /** The most blocks made and not yet written. */
  mostAhead = 0;
  blocksWritten = 0;
  #made = 0;
  #sent = 0;
  #closed = false;
  readonly #frames: number;
  readonly #layout: ChannelLayout;
  readonly #blockFrames: number;

  constructor(frames: number, layout: ChannelLayout, blockFrames: number) {
    this.#frames = frames;
    this.#layout = layout;
    this.#blockFrames = blockFrames;
  }

  next(): Promise<DecodedStreamMessage | undefined> {
    if (this.#closed) return Promise.resolve(undefined);
    if (this.#made === 0 && this.#sent === 0) {
      this.#sent = -1;
      return Promise.resolve({
        kind: 'description',
        description: {
          sampleRate: 48_000,
          layout: this.#layout,
          statedFrames: derivedSampleCount(this.#frames),
          metadata: {},
        },
      });
    }
    const from = this.#made * this.#blockFrames;
    if (from >= this.#frames) {
      return Promise.resolve({ kind: 'end', frames: derivedSampleCount(this.#frames) });
    }
    const frames = Math.min(this.#blockFrames, this.#frames - from);
    this.#made += 1;
    this.mostAhead = Math.max(this.mostAhead, this.#made - this.blocksWritten);
    const channels = this.#layout.roles.map((_, channel) =>
      Float32Array.from({ length: frames }, (_unused, index) => sampleAt(from + index, channel)),
    );
    return Promise.resolve({ kind: 'block', channels, frames });
  }

  refuse(failure: DomainFailure): void {
    this.refusals.push(failure);
    this.#closed = true;
  }

  close(): void {
    this.#closed = true;
  }
}

/** The sample at `frame` of `channel`, exact in 32-bit float. */
function sampleAt(frame: number, channel: number): number {
  return ((frame + channel * 257) % 4_096) / 4_096 - 0.5;
}

describe('a long decoded import through the storage', () => {
  it.each([
    { layout: StandardLayouts.stereo, name: 'stereo', blockFrames: 65_536, blocks: 24 },
    { layout: StandardLayouts.surround5_1, name: '5.1', blockFrames: 43_690, blocks: 24 },
  ])(
    'writes a $name rendition a block at a time and stores it in reads and writes of at most a block',
    async ({ layout, blockFrames, blocks }) => {
      const frames = blocks * blockFrames + 1_000;
      const stream = new MadeDecodedStream(frames, layout, blockFrames);
      const tree = new MeasuredTree(new MemoryStorageTree(), (path) => {
        if (path.includes('/rendition-')) stream.blocksWritten += 1;
      });
      const test = harness(31);
      const storage = storageOf(test, tree);
      const header = await madeProject(test, tree);
      const session = await openToWrite(test, tree, header.id);
      const services: AudioImportServices = {
        store: storage.store,
        digest: nodeDigest,
        yieldToHost: () => Promise.resolve(),
        commands: { addAsset: addRecord, addRegion, addMarker },
        tree,
        ids: test.ids,
        nextToken: () => test.ids.next<'AssetId'>(),
        room: () => Promise.resolve(undefined),
      };
      const analysis = {
        ...ANALYSIS,
        layout,
        statedFrames: derivedSampleCount(frames),
      };

      const imported = expectSuccess(
        await importAudio(
          session,
          {
            file: {
              source: memorySource(FLAC_BYTES),
              fileName: 'Long.flac',
              mediaType: 'audio/flac',
              lastModified: IMPORTED_AT - 1_000,
              handleKey: 'handle-long',
            },
            choice: { mode: SourceHandling.Copy },
            assetId: test.ids.next<'AssetId'>(),
            importedAt: IMPORTED_AT,
            decoding: fakeDecoding(stream, analysis),
          },
          services,
        ),
      );

      expect(imported.asset.length).toBe(frames);
      expect(stream.refusals).toEqual([]);
      // Each block was written before the next was asked for.
      expect(stream.mostAhead).toBe(1);
      expect(stream.blocksWritten).toBe(blocks + 1);
      expect(tree.largestWrite).toBeLessThanOrEqual(MOST_BLOCK_BYTES);
      expect(tree.largestRead).toBeLessThanOrEqual(MOST_BLOCK_BYTES);

      // Every frame is in the stored rendition, as it was decoded.
      const media = session.getSnapshot().model.state.sources.get(imported.asset.id)?.media;
      if (media?.kind !== 'managed') throw new Error('A rendition is managed media.');
      const object = expectSuccess(await storage.store.open(media.contentId));
      const channels = layout.roles.length;
      const dataBytes = frames * channels * 4;
      const data = await object.read(object.size - dataBytes, dataBytes);
      const samples = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let wrong = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const at = (frame * channels + channel) * 4;
          if (samples.getFloat32(at, true) !== sampleAt(frame, channel)) wrong += 1;
        }
      }
      expect(wrong).toBe(0);
      expect(tree.written).toBeGreaterThan(dataBytes);
    },
  );
});

/** A SHA-256 that counts what it is handed; what the test measures is the reading, not the hash. */
function countingSha256(counted: { bytes: number }): Sha256 {
  return () => ({
    update: (bytes) => {
      counted.bytes += bytes.length;
      return Promise.resolve();
    },
    digest: () => Promise.resolve(new Uint8Array(32)),
  });
}

/**
 * A codec worker's encoded stream of `bodies` bodies of 1 MiB, each made only
 * when the storage asks for it, then a head and a tail, recording how many
 * bodies it made before the storage had written the ones before them.
 */
class MadeEncodedStream implements EncodedStream {
  readonly refusals: DomainFailure[] = [];
  mostAhead = 0;
  bodiesWritten = 0;
  #made = 0;
  #closed = false;
  readonly #bodies: number;

  constructor(bodies: number) {
    this.#bodies = bodies;
  }

  next(): Promise<EncodedStreamMessage | undefined> {
    if (this.#closed) return Promise.resolve(undefined);
    if (this.#made === this.#bodies) {
      return Promise.resolve({
        kind: 'finished',
        file: { head: new Uint8Array(80).fill(1), tail: new Uint8Array(0), dropped: [] },
      });
    }
    this.#made += 1;
    this.mostAhead = Math.max(this.mostAhead, this.#made - this.bodiesWritten);
    return Promise.resolve({ kind: 'body', bytes: new Uint8Array(MOST_BLOCK_BYTES) });
  }

  refuse(failure: DomainFailure): void {
    this.refusals.push(failure);
    this.#closed = true;
  }

  close(): void {
    this.#closed = true;
  }
}

const SETTINGS: ExportSettings = {
  format: 'wav',
  encoding: { kind: 'float', bits: 64 },
  sampleRate: expectSuccess(sampleRate(48_000)),
  channels: { kind: 'keep' },
  dither: { kind: 'none' },
  range: { kind: 'project' },
  metadata: { policy: 'full', edits: [] },
  fileName: '{project}',
};

const ORIGIN: ExportOrigin = {
  settings: SETTINGS,
  reproducible: true,
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'3'.repeat(64)}`)),
  engineVersions: new Map([['renderer', '1']]),
};

const ENCODER: ExportCodec = { id: 'pcm', implementation: 'application', version: '0.1.0' };

describe('a long export through the storage', () => {
  it(
    'stages an export past four gibibytes a body at a time, reads it back once for its hash and once to deliver it, a chunk at a time',
    { timeout: 300_000 },
    async () => {
      const bodies = FOUR_GIB / MOST_BLOCK_BYTES + 1;
      const stream = new MadeEncodedStream(bodies);
      const tree = new MeasuredTree(new SizedTree(), (path) => {
        if (path.endsWith('.body')) stream.bodiesWritten += 1;
      });
      const hashed = { bytes: 0 };
      const sha256 = countingSha256(hashed);
      const test = harness(53);
      const projects = new MemoryStorageTree();
      const header = await madeProject(test, projects);
      const session = await openToWrite(test, projects, header.id);
      const staging = new ExportStaging({
        tree,
        sha256,
        nextToken: () => test.ids.next<'AssetId'>(),
        sharing: mediaSharingOf(new MemoryLeaseCoordinator()),
      });

      const staged = expectSuccess(await staging.stage(header.id, ORIGIN, stream, () => undefined));
      const bodyBytes = bodies * MOST_BLOCK_BYTES;
      expect(bodyBytes).toBeGreaterThan(FOUR_GIB);
      expect(staged.bytes).toBe(80 + bodyBytes);
      expect(stream.refusals).toEqual([]);
      // Each body was written before the next was asked for.
      expect(stream.mostAhead).toBe(1);
      expect(stream.bodiesWritten).toBe(bodies);
      expect(hashed.bytes).toBe(staged.bytes);
      expect(tree.largestWrite).toBeLessThanOrEqual(MOST_BLOCK_BYTES);
      expect(tree.largestRead).toBeLessThanOrEqual(MOST_BLOCK_BYTES);
      // The body read back once, for the hash; the head and tail were hashed as they came.
      expect(tree.read).toBe(bodyBytes);

      const delivered = { bytes: 0, largest: 0, closed: false };
      const result = expectSuccess(
        await deliverStaged(
          session,
          staging,
          staged.token,
          ENCODER,
          {
            kind: 'file',
            file: {
              name: 'Long night.wav',
              access: () => Promise.resolve('granted'),
              open: () =>
                Promise.resolve({
                  write: (chunk) => {
                    delivered.bytes += chunk.length;
                    delivered.largest = Math.max(delivered.largest, chunk.length);
                    return Promise.resolve();
                  },
                  close: () => {
                    delivered.closed = true;
                    return Promise.resolve();
                  },
                  abort: () => Promise.resolve(),
                }),
            },
          },
          { sha256, ids: test.ids, clock: { now: () => IMPORTED_AT } },
        ),
      );

      expect(result.kind).toBe('delivered');
      expect(delivered).toEqual({ bytes: staged.bytes, largest: MOST_BLOCK_BYTES, closed: true });
      // The body read back twice in all, for the hash and for the delivery, and the head once.
      expect(tree.read).toBe(2 * bodyBytes + 80);
      expect(tree.largestRead).toBeLessThanOrEqual(MOST_BLOCK_BYTES);
    },
  );
});
