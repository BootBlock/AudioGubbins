import { describe, expect, it } from 'vitest';

import { writeWav } from '@audiogubbins/codecs/testing';
import type { ImportFileEvent, ImportJob } from '@audiogubbins/import-export';
import { SourceHandling, type ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import { succeed } from '@audiogubbins/domain';

import type { DecodedStream } from './decoded-stream.js';
import { importBatch, type BatchFile } from './import-batch.js';
import type { AudioImportServices } from './import-contracts.js';
import { storageOf } from './testing/memory-ports.js';
import { FLAC_BYTES, FakeStream, wholeStream } from './testing/decoded-streams.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { addMarker, addRecord, addRegion } from './testing/test-commands.js';

/**
 * A batch import (ADR-0090): one file at a time, the next prepared while the
 * one before is added, each with an outcome of its own, and a cancel stopping
 * the file under way and every file after it.
 */

const IMPORTED_AT = 1_790_000_000_000;

function wav(frames: number): Uint8Array {
  return Uint8Array.from(
    writeWav({
      sampleRate: 48_000,
      encoding: { kind: 'integer', bits: 16 },
      channels: [new Float32Array(frames).fill(0.5)],
    }),
  );
}

/** An Ogg page whose first packet is Speex, which no implementation decodes. */
function speex(): Uint8Array {
  const bytes = new Uint8Array(1_024);
  bytes.set([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
  bytes.set([0x01, 0x50], 26);
  bytes.set(
    Array.from('Speex   ', (character) => character.charCodeAt(0)),
    28,
  );
  return bytes;
}

function fileOf(bytes: Uint8Array, fileName: string): ExternalFile {
  return {
    source: memorySource(bytes),
    fileName,
    mediaType: '',
    lastModified: IMPORTED_AT - 1_000,
  };
}

async function setUp() {
  const test = harness(41);
  const tree = new MemoryStorageTree();
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
  const entry = (file: ExternalFile, stream?: DecodedStream): BatchFile => ({
    file,
    assetId: test.ids.next<'AssetId'>(),
    decode: () =>
      stream === undefined
        ? Promise.reject(new Error('Not a decoded file.'))
        : Promise.resolve(succeed(stream)),
  });
  return { session, services, entry };
}

describe('a batch import (ADR-0090)', () => {
  it('imports each file in order, the next begun as the one before is added, one refusal stopping nothing', async () => {
    const { session, services, entry } = await setUp();
    const files = [
      entry(fileOf(wav(480), 'One.wav')),
      entry(fileOf(speex(), 'Two.spx')),
      entry(fileOf(FLAC_BYTES, 'Three.flac'), new FakeStream(wholeStream())),
      entry(fileOf(wav(960), 'Four.wav')),
    ];
    const reported: string[] = [];
    let last: ImportJob | undefined;
    const ended = await importBatch(
      session,
      { files, choice: { mode: SourceHandling.Copy }, importedAt: IMPORTED_AT },
      services,
      (job, index, event: ImportFileEvent) => {
        last = job;
        reported.push(`${String(index)}:${event.kind}`);
      },
    );

    expect(ended.job.entries.map((each) => each.state.kind)).toEqual([
      'imported',
      'refused',
      'imported',
      'imported',
    ]);
    expect(last).toEqual(ended.job);
    expect(ended.outcomes.map((outcome) => outcome.kind)).toEqual([
      'imported',
      'refused',
      'imported',
      'imported',
    ]);
    const refused = ended.outcomes[1];
    expect(refused?.kind === 'refused' ? refused.failure.code : '').toBe(
      'codecs.unsupported-format',
    );
    const { project } = session.getSnapshot().model.state;
    expect([...project.assets.values()].map((asset) => asset.displayName)).toEqual([
      'One',
      'Three',
      'Four',
    ]);
    // The second file is analysed as the first is added, before it is imported.
    expect(reported.indexOf('1:analyse')).toBeGreaterThan(reported.indexOf('0:add'));
    expect(reported.indexOf('1:analyse')).toBeLessThan(reported.indexOf('0:imported'));
    expect(reported.indexOf('3:add')).toBeGreaterThan(reported.indexOf('2:imported'));
  });

  it('cancels the file under way and every file after it, keeping what was imported before', async () => {
    const { session, services, entry } = await setUp();
    const controller = new AbortController();
    const decoding = new FakeStream(wholeStream(), (read) => {
      if (read === 2) controller.abort(new Error('Called off.'));
    });
    const files = [
      entry(fileOf(wav(480), 'One.wav')),
      entry(fileOf(FLAC_BYTES, 'Two.flac'), decoding),
      entry(fileOf(wav(960), 'Three.wav')),
    ];
    const ended = await importBatch(
      session,
      { files, choice: { mode: SourceHandling.Copy }, importedAt: IMPORTED_AT },
      services,
      () => undefined,
      controller.signal,
    );

    expect(ended.job.entries.map((each) => each.state)).toEqual([
      { kind: 'imported' },
      { kind: 'cancelled', stage: 'decoding' },
      { kind: 'cancelled', stage: 'queued' },
    ]);
    expect(ended.outcomes.map((outcome) => outcome.kind)).toEqual([
      'imported',
      'cancelled',
      'cancelled',
    ]);
    expect(decoding.refusals.map((refusal) => refusal.code)).toEqual(['import.cancelled']);
    const { project } = session.getSnapshot().model.state;
    expect([...project.assets.values()].map((asset) => asset.displayName)).toEqual(['One']);
  });
});
