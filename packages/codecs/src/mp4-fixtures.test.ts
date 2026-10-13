/**
 * The M4A writer on access units generated here: its boxes, its sample tables
 * pointing at the units, its gapless statements, its 64-bit forms, and every
 * metadata field through it and back through the MP4 metadata reader.
 */

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { readAacConfig } from './aac-config.js';
import { concatenate } from './byte-writer.js';
import type { MetadataMap } from './metadata-map.js';
import { box, fullBox } from './mp4-box.js';
import { Mp4AacWriter, type Mp4AacSettings } from './mp4-aac-writer.js';
import { readMp4Metadata } from './mp4-metadata-reader.js';
import { fullMetadata, memoryBytes } from './testing/index.js';

/** AAC-LC, 44.1 kHz (index 4), stereo: 00010 0100 0010 0 0 0. */
const ASC_44100_STEREO = Uint8Array.of(0x12, 0x10);

interface Box {
  readonly type: string;
  readonly offset: number;
  readonly body: Uint8Array;
}

/** The bytes before each container's children: a full box's version and flags, and an entry count. */
const CHILDREN_AFTER: ReadonlyMap<string, number> = new Map([
  ['meta', 4],
  ['stsd', 8],
]);
const CONTAINERS = new Set([
  'stsd',
  'moov',
  'trak',
  'edts',
  'mdia',
  'minf',
  'dinf',
  'stbl',
  'udta',
  'meta',
  'ilst',
]);

/** Every box of a file, depth first, with its offset in the file. */
function boxesOf(file: Uint8Array, start = 0, end = file.length, found: Box[] = []): Box[] {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  for (let offset = start; offset + 8 <= end;) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      header = 16;
    }
    const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8));
    const bodyStart = offset + header;
    found.push({
      type,
      offset,
      body: file.subarray(bodyStart, Math.min(offset + size, file.length)),
    });
    if (CONTAINERS.has(type))
      boxesOf(file, bodyStart + (CHILDREN_AFTER.get(type) ?? 0), offset + size, found);
    offset += size;
  }
  return found;
}

const find = (boxes: readonly Box[], type: string): Box => {
  const found = boxes.find((one) => one.type === type);
  if (found === undefined) throw new Error(`No '${type}' box.`);
  return found;
};

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const unit = (index: number) =>
  Uint8Array.from({ length: 100 + ((index * 13) % 200) }, (_, at) => (at + index) & 0xff);

const settings = (extra: Partial<Mp4AacSettings> = {}): Mp4AacSettings => ({
  audioSpecificConfig: ASC_44100_STEREO,
  primingFrames: 2_112,
  metadata: {},
  ...extra,
});

/** An M4A file of `count` units for `inputFrames` frames, and its parts. */
function m4a(count: number, inputFrames: number, extra: Partial<Mp4AacSettings> = {}) {
  const writer = expectSuccess(Mp4AacWriter.create(settings(extra)));
  const units = Array.from({ length: count }, (_, index) => unit(index));
  const body = units.flatMap((one) => expectSuccess(writer.add(one)));
  const finished = expectSuccess(writer.finish({ inputFrames }));
  return {
    file: concatenate([finished.head, ...body, ...finished.body, finished.tail]),
    finished,
    units,
  };
}

describe('the M4A writer', () => {
  it('writes ftyp, then the movie, then the samples, the sample tables finding every unit', () => {
    const { file, units } = m4a(100, 100 * 1_024 - 2_112 - 500);
    const boxes = boxesOf(file);
    expect(
      boxes.filter((one) => ['ftyp', 'moov', 'mdat'].includes(one.type)).map((one) => one.type),
    ).toEqual(['ftyp', 'moov', 'mdat']);
    expect(String.fromCharCode(...find(boxes, 'ftyp').body.subarray(0, 4))).toBe('M4A ');
    expect(find(boxes, 'mdat').offset + 8 + units.reduce((sum, one) => sum + one.length, 0)).toBe(
      file.length,
    );

    const stsz = viewOf(find(boxes, 'stsz').body);
    expect(stsz.getUint32(8)).toBe(100);
    const stts = viewOf(find(boxes, 'stts').body);
    expect([stts.getUint32(4), stts.getUint32(8), stts.getUint32(12)]).toEqual([1, 100, 1_024]);
    // 44.1 kHz in units of 1,024 frames: 44 units a chunk, so three chunks, the last of 12.
    const stsc = viewOf(find(boxes, 'stsc').body);
    expect(Array.from({ length: 7 }, (_, index) => stsc.getUint32(4 + index * 4))).toEqual([
      2, 1, 44, 1, 3, 12, 1,
    ]);
    const stco = viewOf(find(boxes, 'stco').body);
    expect(stco.getUint32(4)).toBe(3);
    let index = 0;
    for (let chunk = 0; chunk < 3; chunk += 1) {
      let offset = stco.getUint32(8 + chunk * 4);
      for (let inChunk = 0; inChunk < 44 && index < 100; inChunk += 1, index += 1) {
        const size = stsz.getUint32(12 + index * 4);
        expect(file.subarray(offset, offset + size)).toEqual(units[index]);
        offset += size;
      }
    }
  });

  it('states the priming in an edit list and in iTunSMPB, and the configuration in esds', () => {
    const inputFrames = 100 * 1_024 - 2_112 - 500;
    const { file } = m4a(100, inputFrames);
    const boxes = boxesOf(file);
    const elst = viewOf(find(boxes, 'elst').body);
    expect([elst.getUint32(4), elst.getUint32(8), elst.getUint32(12), elst.getUint32(16)]).toEqual([
      1,
      inputFrames,
      2_112,
      0x00010000,
    ]);
    const mdhd = viewOf(find(boxes, 'mdhd').body);
    expect([mdhd.getUint32(12), mdhd.getUint32(16)]).toEqual([44_100, 102_400]);
    expect(viewOf(find(boxes, 'mvhd').body).getUint32(16)).toBe(inputFrames);
    const text = new TextDecoder().decode(file);
    expect(text).toContain('iTunSMPB');
    expect(text).toContain(
      ` 00000000 00000840 000001F4 ${inputFrames.toString(16).toUpperCase().padStart(16, '0')} 00000000`,
    );
    const esds = find(boxes, 'mp4a').body;
    const at = esds.findIndex((byte, index) => byte === 0x05 && esds[index + 1] === 2);
    expect(esds.subarray(at + 2, at + 4)).toEqual(ASC_44100_STEREO);
    const entry = viewOf(esds);
    expect([entry.getUint16(16), entry.getUint32(24) / 65_536]).toEqual([2, 44_100]);
  });

  it('gives the same bytes every time, at the time it is given', () => {
    expect(m4a(10, 5_000).file).toEqual(m4a(10, 5_000).file);
    const timed = boxesOf(m4a(10, 5_000, { time: 3_000_000_000 }).file);
    expect(viewOf(find(timed, 'mvhd').body).getUint32(4)).toBe(3_000_000_000);
    expect(viewOf(find(timed, 'mvhd').body).getUint32(8)).toBe(3_000_000_000);
  });

  it('takes 64-bit chunk offsets and the 64-bit mdat size past four gibibytes', () => {
    const writer = expectSuccess(Mp4AacWriter.create(settings()));
    const huge = () => Object.defineProperty(new Uint8Array(1), 'length', { value: 2 ** 31 });
    for (let index = 0; index < 50; index += 1)
      expectSuccess(writer.add(index % 10 === 0 ? huge() : unit(index)));
    const finished = expectSuccess(writer.finish({ inputFrames: 40_000 }));
    const boxes = boxesOf(finished.head);
    expect(boxes.some((one) => one.type === 'co64')).toBe(true);
    expect(boxes.some((one) => one.type === 'stco')).toBe(false);
    const head = viewOf(finished.head);
    const mdat = finished.head.length - 16;
    expect(head.getUint32(mdat)).toBe(1);
    expect(String.fromCharCode(...finished.head.subarray(mdat + 4, mdat + 8))).toBe('mdat');
  });

  it('refuses a configuration that is not AAC-LC, priming it cannot state, and a length its units miss', () => {
    expect(expectSuccess(readAacConfig(Uint8Array.of(0x12, 0x14))).frameLength).toBe(960);
    expect(expectFailureCode(readAacConfig(Uint8Array.of(0x2a, 0x10)))).toBe(
      'codecs.stream-unwritable',
    );
    expect(expectFailureCode(readAacConfig(Uint8Array.of(0x12, 0x00)))).toBe(
      'codecs.stream-unwritable',
    );
    expect(expectFailureCode(readAacConfig(Uint8Array.of(0x12)))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expect(expectFailureCode(Mp4AacWriter.create(settings({ primingFrames: -1 })))).toBe(
      'codecs.stream-unwritable',
    );
    const writer = expectSuccess(Mp4AacWriter.create(settings()));
    expectSuccess(writer.add(unit(0)));
    expect(expectFailureCode(writer.finish({ inputFrames: 1_024 }))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expect(expectFailureCode(writer.add(unit(1)))).toBe('codecs.writer-ended');
  });
});

describe('MP4 metadata', () => {
  const pictureless = (): MetadataMap => ({
    ...fullMetadata(),
    coverArt: { ...fullMetadata().coverArt!, description: '' },
  });

  it('carries every field it holds and reads them back', async () => {
    const map: MetadataMap = {
      ...pictureless(),
      foreign: [
        { scheme: 'ilst', key: '©wrt', value: 'A Composer' },
        { scheme: 'ilst', key: '----:org.example:Thing', value: 'x' },
        { scheme: 'ilst', key: 'MOODINESS', value: 'Calm' },
      ],
    };
    const { file, finished } = m4a(5, 1_000, { metadata: map });
    expect(finished.dropped).toEqual([]);
    expect(expectSuccess(await readMp4Metadata(memoryBytes(file)))).toEqual(map);
  });

  it('reports the cover’s description, numbers its items cannot hold and reserved names', async () => {
    const { file, finished } = m4a(5, 1_000, {
      metadata: {
        ...fullMetadata(),
        text: { ...fullMetadata().text, trackNumber: 'A side' },
        foreign: [
          { scheme: 'vorbis-comment', key: 'MOOD', value: 'Calm' },
          { scheme: 'ilst', key: 'trkn', value: '1' },
          { scheme: 'id3v2', key: 'ISRC', value: 'x' },
        ],
      },
    });
    expect(finished.dropped).toEqual([
      { kind: 'text', key: 'trackNumber' },
      { kind: 'foreign', scheme: 'ilst', key: 'trkn' },
      { kind: 'foreign', scheme: 'id3v2', key: 'ISRC' },
      { kind: 'coverArt' },
    ]);
    const read = expectSuccess(await readMp4Metadata(memoryBytes(file)));
    expect(read.coverArt?.description).toBe('');
    expect(read.text?.trackNumber).toBeUndefined();
    // A four-character free-form name says how it is written, so it is not taken for an item's type.
    expect(read.foreign).toEqual([
      { scheme: 'ilst', key: '----:com.apple.iTunes:MOOD', value: 'Calm' },
    ]);
  });

  it('reads a QuickTime meta box, a numbered genre and items it does not map', async () => {
    const data = (type: number, value: Uint8Array) =>
      box('data', Uint8Array.of(0, 0, 0, type, 0, 0, 0, 0), value);
    const ilst = box(
      'ilst',
      box('gnre', data(0, Uint8Array.of(0, 18))),
      box('©nam', data(1, new TextEncoder().encode('Plain'))),
      box('tmpo', data(21, Uint8Array.of(0, 120))),
    );
    const hdlr = fullBox('hdlr', 0, 0, new Uint8Array(21));
    const file = concatenate([
      box('ftyp', new Uint8Array(8)),
      box('moov', box('udta', box('meta', hdlr, ilst))),
    ]);
    expect(expectSuccess(await readMp4Metadata(memoryBytes(file)))).toEqual({
      text: { genre: 'Rock', title: 'Plain' },
    });
  });

  it('reads a file with no metadata as an empty map and refuses one with no movie', async () => {
    const empty = concatenate([
      box('ftyp', new Uint8Array(8)),
      box('moov', box('mvhd', new Uint8Array(100))),
    ]);
    expect(expectSuccess(await readMp4Metadata(memoryBytes(empty)))).toEqual({});
    expect(
      expectFailureCode(await readMp4Metadata(memoryBytes(box('ftyp', new Uint8Array(8))))),
    ).toBe('codecs.malformed');
  });
});
