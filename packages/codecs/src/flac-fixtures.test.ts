/**
 * The FLAC writer on frames generated here, its stream information and
 * signature, the frames it refuses, and every metadata field through it and
 * back through the FLAC metadata reader, with and without the WAV chunks.
 */

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { concatenate } from './byte-writer.js';
import { readFlacMetadata } from './flac-metadata-reader.js';
import { FlacSampleDigest } from './flac-sample-digest.js';
import { FlacStreamWriter, type FlacStreamSettings } from './flac-stream-writer.js';
import { Md5 } from './md5.js';
import type { MetadataMap } from './metadata-map.js';
import { frames, fullMetadata, memoryBytes } from './testing/index.js';

const crc8 = (bytes: Uint8Array) => {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
};

/** A frame number coded as UTF-8 codes a character. */
const codedNumber = (value: number): number[] => {
  if (value < 0x80) return [value];
  if (value < 0x800) return [0xc0 | (value >> 6), 0x80 | (value & 0x3f)];
  return [0xe0 | (value >> 12), 0x80 | ((value >> 6) & 0x3f), 0x80 | (value & 0x3f)];
};

interface FrameShape {
  readonly number: number;
  readonly blockSize: number;
  readonly channelCode?: number;
  readonly sync?: number;
  readonly damageCrc?: boolean;
}

/** A frame of 16-bit audio at 48 kHz whose header is as the format defines and whose body is filler. */
function flacFrame(shape: FrameShape, payload = 40): Uint8Array {
  const header = [
    0xff,
    shape.sync ?? 0xf8,
    (7 << 4) | 10,
    ((shape.channelCode ?? 1) << 4) | (4 << 1),
    ...codedNumber(shape.number),
    (shape.blockSize - 1) >> 8,
    (shape.blockSize - 1) & 0xff,
  ];
  const crc = crc8(Uint8Array.from(header)) ^ (shape.damageCrc === true ? 1 : 0);
  return Uint8Array.from([
    ...header,
    crc,
    ...Array.from({ length: payload + shape.number }, (_, index) => index & 0xff),
  ]);
}

const settings = (extra: Partial<FlacStreamSettings> = {}): FlacStreamSettings => ({
  sampleRate: 48_000,
  channels: 2,
  bitsPerSample: 16,
  blockSize: 4_096,
  vendor: 'flacenc 0.4',
  metadata: {},
  keepRiffChunks: false,
  ...extra,
});

/** A sample map for the RIFF chunks: several loops of every kind, a tuning and named cues. */
const samplerMetadata = (): MetadataMap => ({
  ...fullMetadata(),
  loops: [
    { start: frames(100), length: frames(1_000), playCount: 'endless', direction: 'forward' },
    { start: frames(2_000), length: frames(500), playCount: 3, direction: 'alternating' },
    { start: frames(3_000), length: frames(1), playCount: 1, direction: 'backward' },
  ],
  tuning: { unityNote: 62, fineTuneCents: -12 },
  cues: [
    { position: frames(10), name: 'Attack' },
    { position: frames(5_000), name: '' },
    { position: frames(7_000), name: 'Rélease 終' },
  ],
});

/** The planar samples of a stream: a ramp per channel. */
const samples = (count: number) => [
  Int32Array.from({ length: count }, (_, index) => ((index * 37) % 65_536) - 32_768),
  Int32Array.from({ length: count }, (_, index) => 32_767 - ((index * 11) % 65_536)),
];

/** A FLAC file of `blockSizes` frames, written with these settings, and its parts. */
function flacFile(blockSizes: readonly number[], options: Partial<FlacStreamSettings> = {}) {
  const writer = expectSuccess(FlacStreamWriter.create(settings(options)));
  const total = blockSizes.reduce((sum, size) => sum + size, 0);
  const digest = new FlacSampleDigest(options.bitsPerSample ?? 16);
  digest.add(samples(total), total);
  const body = blockSizes.flatMap((blockSize, number) =>
    expectSuccess(writer.add(flacFrame({ number, blockSize }))),
  );
  const finished = expectSuccess(writer.finish({ samples: digest }));
  return {
    file: concatenate([finished.head, ...body, ...finished.body, finished.tail]),
    finished,
    body,
    total,
  };
}

/** The metadata blocks of a FLAC file: type, last flag and body. */
function blocksOf(file: Uint8Array) {
  const blocks: { type: number; last: boolean; body: Uint8Array }[] = [];
  for (let offset = 4; ;) {
    const flags = file[offset] ?? 0;
    const length =
      ((file[offset + 1] ?? 0) << 16) | ((file[offset + 2] ?? 0) << 8) | (file[offset + 3] ?? 0);
    blocks.push({
      type: flags & 0x7f,
      last: (flags & 0x80) !== 0,
      body: file.subarray(offset + 4, offset + 4 + length),
    });
    offset += 4 + length;
    if ((flags & 0x80) !== 0) return blocks;
  }
}

describe('the FLAC writer', () => {
  it('states the block sizes, frame sizes, format, length and the signature of the samples', () => {
    const { file, body, total } = flacFile([4_096, 4_096, 4_096, 1_000]);
    expect(Array.from(file.subarray(0, 4))).toEqual([0x66, 0x4c, 0x61, 0x43]);
    const [info] = blocksOf(file);
    const view = new DataView(info?.body.buffer ?? new ArrayBuffer(0), info?.body.byteOffset, 34);
    expect(info?.body.length).toBe(34);
    expect(view.getUint16(0)).toBe(4_096);
    expect(view.getUint16(2)).toBe(4_096);
    const sizes = body.map((frame) => frame.length);
    expect(view.getUint32(4) >>> 8).toBe(Math.min(...sizes));
    expect(view.getUint32(7) >>> 8).toBe(Math.max(...sizes));
    expect(view.getUint32(10) >>> 12).toBe(48_000);
    expect(((view.getUint32(10) >>> 9) & 0x7) + 1).toBe(2);
    expect(((view.getUint32(10) >>> 4) & 0x1f) + 1).toBe(16);
    expect((view.getUint32(10) & 0xf) * 2 ** 32 + view.getUint32(14)).toBe(total);

    // The signature is of the samples interleaved, each a signed little-endian 16-bit integer.
    const [left, right] = samples(total);
    const interleaved = new Uint8Array(total * 4);
    const out = new DataView(interleaved.buffer);
    for (let frame = 0; frame < total; frame += 1) {
      out.setInt16(frame * 4, left?.[frame] ?? 0, true);
      out.setInt16(frame * 4 + 2, right?.[frame] ?? 0, true);
    }
    const md5 = new Md5();
    md5.update(interleaved);
    expect(info?.body.subarray(18)).toEqual(md5.digest());
  });

  it('signs samples of 24 and 12 bits in three and two bytes each', () => {
    const digest = new FlacSampleDigest(24);
    digest.add([Int32Array.of(-1, 0x123456)], 2);
    const md5 = new Md5();
    md5.update(Uint8Array.of(0xff, 0xff, 0xff, 0x56, 0x34, 0x12));
    expect(digest.digest()).toEqual(md5.digest());

    const twelve = new FlacSampleDigest(12);
    twelve.add([Int32Array.of(-2048), Int32Array.of(2047)], 1);
    const expected = new Md5();
    expected.update(Uint8Array.of(0x00, 0xf8, 0xff, 0x07));
    expect(twelve.digest()).toEqual(expected.digest());
  });

  it('ends its metadata with padding and writes the body as the frames', () => {
    const { file, finished, body } = flacFile([4_096, 10]);
    const blocks = blocksOf(file);
    expect(blocks.map((block) => block.type)).toEqual([0, 4, 1]);
    expect(blocks.at(-1)?.last).toBe(true);
    expect(blocks.at(-1)?.body.length).toBe(8_192);
    expect(finished.head.length + body.reduce((sum, frame) => sum + frame.length, 0)).toBe(
      file.length,
    );
  });

  it('refuses frames that are not the stream’s, out of order, or short before the last', () => {
    const add = (frames: readonly FrameShape[]) => {
      const writer = expectSuccess(FlacStreamWriter.create(settings()));
      for (const shape of frames.slice(0, -1)) expectSuccess(writer.add(flacFrame(shape)));
      const last = frames.at(-1);
      return writer.add(flacFrame(last ?? { number: 0, blockSize: 16 }));
    };
    const invalid = 'codecs.encoded-stream-invalid';
    expect(expectFailureCode(add([{ number: 0, blockSize: 4_096, sync: 0xf0 }]))).toBe(invalid);
    expect(expectFailureCode(add([{ number: 0, blockSize: 4_096, damageCrc: true }]))).toBe(
      invalid,
    );
    expect(expectFailureCode(add([{ number: 0, blockSize: 4_096, channelCode: 0 }]))).toBe(invalid);
    expect(expectFailureCode(add([{ number: 1, blockSize: 4_096 }]))).toBe(invalid);
    expect(expectFailureCode(add([{ number: 0, blockSize: 4_096, sync: 0xf9 }]))).toBe(invalid);
    expect(expectFailureCode(add([{ number: 0, blockSize: 5_000 }]))).toBe(invalid);
    expect(
      expectFailureCode(
        add([
          { number: 0, blockSize: 100 },
          { number: 1, blockSize: 100 },
        ]),
      ),
    ).toBe(invalid);
  });

  it('refuses a signature of a count of samples the frames do not hold, and settings it cannot state', () => {
    const writer = expectSuccess(FlacStreamWriter.create(settings()));
    expectSuccess(writer.add(flacFrame({ number: 0, blockSize: 4_096 })));
    expect(expectFailureCode(writer.finish({ samples: new FlacSampleDigest(16) }))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expect(expectFailureCode(writer.add(flacFrame({ number: 1, blockSize: 4_096 })))).toBe(
      'codecs.writer-ended',
    );
    for (const bad of [
      { channels: 9 },
      { bitsPerSample: 3 },
      { blockSize: 15 },
      { sampleRate: 2 ** 20 },
    ]) {
      expect(expectFailureCode(FlacStreamWriter.create(settings(bad)))).toBe(
        'codecs.stream-unwritable',
      );
    }
  });
});

describe('FLAC metadata', () => {
  it('carries every field, every loop, the tuning and the cues through the WAV chunks', async () => {
    const map = samplerMetadata();
    const { file, finished } = flacFile([4_096, 500], { metadata: map, keepRiffChunks: true });
    expect(finished.dropped).toEqual([]);
    const blocks = blocksOf(file);
    expect(blocks.map((block) => block.type)).toEqual([0, 4, 6, 2, 2, 2, 2, 2, 2, 1]);
    const ascii = (bytes: Uint8Array | undefined) => String.fromCharCode(...(bytes ?? []));
    expect(
      blocks.filter((block) => block.type === 2).map((block) => ascii(block.body.subarray(0, 8))),
    ).toEqual(['riffRIFF', 'rifffmt ', 'riffcue ', 'riffLIST', 'riffsmpl', 'riffdata']);
    // The form's size counts every chunk and the samples the stream decodes to, as a WAV file would.
    const riffBlocks = blocks.filter((block) => block.type === 2);
    const chunkBytes = riffBlocks
      .slice(1, -1)
      .reduce((sum, block) => sum + block.body.length - 4, 0);
    const formSize = new DataView(
      riffBlocks[0]?.body.buffer ?? new ArrayBuffer(0),
      (riffBlocks[0]?.body.byteOffset ?? 0) + 8,
      4,
    ).getUint32(0, true);
    expect(formSize).toBe(4 + chunkBytes + 8 + 4_596 * 4);

    expect(expectSuccess(await readFlacMetadata(memoryBytes(file)))).toEqual(map);
  });

  it('carries every field without the chunks, reporting what only they hold', async () => {
    const map = samplerMetadata();
    const { file, finished } = flacFile([4_096], { metadata: map });
    expect(finished.dropped).toEqual([{ kind: 'loops' }, { kind: 'cues' }, { kind: 'tuning' }]);
    expect(expectSuccess(await readFlacMetadata(memoryBytes(file)))).toEqual({
      ...fullMetadata(),
      loops: [map.loops?.[0]],
    });
  });

  it('reads the full map written without the chunks exactly', async () => {
    const { file, finished } = flacFile([4_096], { metadata: fullMetadata() });
    expect(finished.dropped).toEqual([]);
    expect(expectSuccess(await readFlacMetadata(memoryBytes(file)))).toEqual(fullMetadata());
  });

  it('reports what no FLAC field holds', () => {
    const { finished } = flacFile([4_096], {
      metadata: {
        broadcast: {
          description: '',
          originator: '',
          originatorReference: '',
          originationDate: '2026-01-01',
          originationTime: '00:00:00',
          timeReference: frames(0),
          codingHistory: '',
        },
        foreign: [{ scheme: 'riff-info', key: 'BAD=KEY', value: 'x' }],
        coverArt: { mediaType: 'image/pngé', description: '', bytes: new Uint8Array(1) },
      },
    });
    expect(finished.dropped).toEqual([
      { kind: 'foreign', scheme: 'riff-info', key: 'BAD=KEY' },
      { kind: 'coverArt' },
      { kind: 'broadcast' },
    ]);
  });

  it('skips an ID3v2 tag before the marker', async () => {
    const { file } = flacFile([4_096], { metadata: { text: { title: 'Tagged' } } });
    const tag = Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0]);
    expect(expectSuccess(await readFlacMetadata(memoryBytes(concatenate([tag, file]))))).toEqual({
      text: { title: 'Tagged' },
    });
  });

  it('reads a fine tuning of fifty cents above a note back on the note the chunk states', async () => {
    const { file } = flacFile([4_096], {
      metadata: { tuning: { unityNote: 60, fineTuneCents: 50 } },
      keepRiffChunks: true,
    });
    expect(expectSuccess(await readFlacMetadata(memoryBytes(file))).tuning).toEqual({
      unityNote: 60,
      fineTuneCents: 50,
    });
  });

  it('reports a fine tuning of part of a cent, which the WAV chunk is read back from in whole cents', () => {
    const { finished } = flacFile([4_096], {
      metadata: { tuning: { unityNote: 62, fineTuneCents: -12.5 } },
      keepRiffChunks: true,
    });
    expect(finished.dropped).toEqual([{ kind: 'tuning' }]);
  });
});
