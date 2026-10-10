/**
 * The MP3 writer on frames generated here: the information frame and LAME's
 * tag it writes as the head, the frames it leaves out and refuses, and every
 * metadata field through its ID3v2.4 tag and back through the MP3 metadata
 * reader, with ID3v2.2, 2.3 and ID3v1 tags written here read as well.
 */

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { concatenate } from './byte-writer.js';
import { lameCrc } from './mp3-info-frame.js';
import { readId3Metadata } from './id3-metadata-reader.js';
import { Mp3StreamWriter, type Mp3StreamSettings } from './mp3-stream-writer.js';
import { frames, fullMetadata, memoryBytes, random } from './testing/index.js';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** MPEG 1 Layer III bit rates by index, in kbit/s. */
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

/** A stereo MPEG 1 Layer III frame at 44.1 kHz with no CRC, its body filler. */
function mp3Frame(bitrateIndex: number, seed: number, padding = false): Uint8Array {
  const length =
    Math.floor((144 * (BITRATES[bitrateIndex] ?? 0) * 1_000) / 44_100) + (padding ? 1 : 0);
  const frame = Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 0xff);
  frame.set([0xff, 0xfb, (bitrateIndex << 4) | (padding ? 2 : 0), 0x00], 0);
  return frame;
}

const settings = (extra: Partial<Mp3StreamSettings> = {}): Mp3StreamSettings => ({
  metadata: {},
  encoderDelay: 576,
  encoder: 'LAME3.100',
  ...extra,
});

/** An MP3 file of `stream`'s bytes fed in pieces of random size, for `inputFrames` frames. */
function mp3File(
  stream: Uint8Array,
  inputFrames: number,
  extra: Partial<Mp3StreamSettings> = {},
  seed = 1,
) {
  const writer = expectSuccess(Mp3StreamWriter.create(settings(extra)));
  const next = random(seed);
  const body: Uint8Array[] = [];
  for (let offset = 0; offset < stream.length;) {
    const piece = 1 + Math.floor(next() * 900);
    body.push(...expectSuccess(writer.add(stream.subarray(offset, offset + piece))));
    offset += piece;
  }
  const finished = expectSuccess(writer.finish({ inputFrames }));
  return {
    file: concatenate([finished.head, ...body, ...finished.body, finished.tail]),
    finished,
    body,
  };
}

const constantFrames = Array.from({ length: 40 }, (_, index) =>
  mp3Frame(9, index, index % 3 === 0),
);
const constantStream = concatenate(constantFrames);
/** Forty frames of 1,152 samples, less the delay and 1,000 samples of padding. */
const INPUT_FRAMES = 40 * 1_152 - 576 - 1_000;

describe('the MP3 writer', () => {
  it('checks LAME’s tag with CRC-16/ARC', () => {
    expect(lameCrc(ascii('123456789'))).toBe(0xbb3d);
  });

  it('writes an Info frame of the stream’s own bit rate stating the counts, the contents and the trims', () => {
    const { file, finished, body } = mp3File(constantStream, INPUT_FRAMES);
    expect(body).toEqual(constantFrames);
    const info = finished.head;
    expect(info.length).toBe(417);
    expect(Array.from(info.subarray(0, 4))).toEqual([0xff, 0xfb, 0x90, 0x00]);
    expect(text(info.subarray(36, 40))).toBe('Info');
    const view = viewOf(info);
    expect(view.getUint32(40)).toBe(15);
    expect(view.getUint32(44)).toBe(40);
    expect(view.getUint32(48)).toBe(file.length);
    const toc = Array.from(info.subarray(52, 152));
    expect(toc[0]).toBe(Math.floor((256 * 417) / file.length));
    expect(toc.every((value, index) => index === 0 || value >= (toc[index - 1] ?? 0))).toBe(true);

    const lame = 156;
    expect(text(info.subarray(lame, lame + 9))).toBe('LAME3.100');
    expect(info[lame + 9]).toBe(1);
    expect(info[lame + 20]).toBe(128);
    const trims = (view.getUint8(lame + 21) << 16) | view.getUint16(lame + 22);
    expect([trims >> 12, trims & 0xfff]).toEqual([576, 1_000]);
    expect(view.getUint32(lame + 28)).toBe(file.length);
    expect(view.getUint16(lame + 32)).toBe(lameCrc(constantStream));
    expect(view.getUint16(lame + 34)).toBe(lameCrc(info.subarray(0, 190)));
  });

  it('writes a Xing frame where the bit rate varies, of the smallest bit rate that holds it', () => {
    const varied = concatenate(
      Array.from({ length: 10 }, (_, index) => mp3Frame(index % 2 === 0 ? 9 : 11, index)),
    );
    const { finished } = mp3File(varied, 10 * 1_152 - 576 - 100);
    expect(text(finished.head.subarray(36, 40))).toBe('Xing');
    // 64 kbit/s, index 5, is the first whose 208 bytes hold the tag after 36 of header and side information.
    expect((finished.head[2] ?? 0) >> 4).toBe(5);
    expect(finished.head.length).toBe(208);
  });

  it('leaves out an information frame and ID3 tags the encoder wrote itself', () => {
    const lameInfo = mp3Frame(9, 99);
    lameInfo.set(ascii('Info'), 36);
    const id3 = Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0);
    const id3v1 = concatenate([ascii('TAG'), new Uint8Array(125)]);
    const { body } = mp3File(concatenate([id3, lameInfo, constantStream, id3v1]), INPUT_FRAMES);
    expect(body).toEqual(constantFrames);
  });

  it('refuses bytes that are not frames, a change of rate, a cut frame, and trims it cannot state', () => {
    const add = (bytes: Uint8Array) => expectSuccess(Mp3StreamWriter.create(settings())).add(bytes);
    const invalid = 'codecs.encoded-stream-invalid';
    expect(expectFailureCode(add(concatenate([constantStream, new Uint8Array(10)])))).toBe(invalid);
    const otherRate = mp3Frame(9, 1);
    otherRate[2] = (otherRate[2] ?? 0) | 0x04;
    expect(expectFailureCode(add(concatenate([constantStream, otherRate])))).toBe(invalid);

    const cut = expectSuccess(Mp3StreamWriter.create(settings()));
    expectSuccess(cut.add(constantStream.subarray(0, constantStream.length - 5)));
    expect(expectFailureCode(cut.finish({ inputFrames: 1_000 }))).toBe(invalid);
    expect(expectFailureCode(cut.add(new Uint8Array(1)))).toBe('codecs.writer-ended');

    const finish = (inputFrames: number) => {
      const writer = expectSuccess(Mp3StreamWriter.create(settings()));
      expectSuccess(writer.add(constantStream));
      return writer.finish({ inputFrames });
    };
    expect(expectFailureCode(finish(40 * 1_152 - 576 + 1))).toBe(invalid);
    expect(expectFailureCode(finish(40 * 1_152 - 576 - 4_096))).toBe(invalid);
    expect(expectFailureCode(Mp3StreamWriter.create(settings({ encoderDelay: 5_000 })))).toBe(
      'codecs.stream-unwritable',
    );
    expect(expectFailureCode(Mp3StreamWriter.create(settings({ encoder: 'LAME3.100-long' })))).toBe(
      'codecs.stream-unwritable',
    );
  });
});

describe('MP3 metadata', () => {
  it('carries every field through ID3v2.4 and reads it back', async () => {
    const { file, finished } = mp3File(constantStream, INPUT_FRAMES, { metadata: fullMetadata() });
    expect(finished.dropped).toEqual([]);
    expect(text(file.subarray(0, 5))).toBe('ID3\x04\x00');
    expect(expectSuccess(await readId3Metadata(memoryBytes(file)))).toEqual({
      ...fullMetadata(),
      foreign: [{ scheme: 'id3v2', key: 'MOOD', value: 'Calm' }],
    });
  });

  it('writes a foreign text frame as itself and reports what ID3v2.4 cannot state', async () => {
    const { file, finished } = mp3File(constantStream, INPUT_FRAMES, {
      metadata: {
        text: { date: 'last spring', trackTotal: '9' },
        foreign: [
          { scheme: 'id3v2', key: 'TBPM', value: '120' },
          { scheme: 'id3v2', key: 'TIT2', value: 'shadow' },
          { scheme: 'vorbis-comment', key: 'LOOP_START', value: '5' },
        ],
        loops: [{ start: frames(1), length: frames(2), playCount: 2, direction: 'forward' }],
      },
    });
    expect(finished.dropped).toEqual([
      { kind: 'text', key: 'date' },
      { kind: 'text', key: 'trackTotal' },
      { kind: 'loops' },
      { kind: 'foreign', scheme: 'vorbis-comment', key: 'LOOP_START' },
    ]);
    expect(expectSuccess(await readId3Metadata(memoryBytes(file)))).toEqual({
      foreign: [
        { scheme: 'id3v2', key: 'TBPM', value: '120' },
        { scheme: 'id3v2', key: 'TIT2', value: 'shadow' },
      ],
      loops: [{ start: 1, length: 2, playCount: 'endless', direction: 'forward' }],
    });
  });

  /** A version 2.3 frame: id, 32-bit size, no flags, body. */
  const frame23 = (id: string, body: Uint8Array) => {
    const header = new Uint8Array(10);
    header.set(ascii(id), 0);
    viewOf(header).setUint32(4, body.length);
    return concatenate([header, body]);
  };
  /** UTF-16 with a little-endian byte order mark. */
  const utf16 = (value: string) => {
    const bytes = new Uint8Array(2 + value.length * 2);
    bytes.set([0xff, 0xfe], 0);
    for (let index = 0; index < value.length; index += 1)
      viewOf(bytes).setUint16(2 + index * 2, value.charCodeAt(index), true);
    return bytes;
  };
  const tagOf = (version: number, flags: number, body: Uint8Array) => {
    const size = body.length;
    return concatenate([
      Uint8Array.of(
        0x49,
        0x44,
        0x33,
        version,
        0,
        flags,
        (size >> 21) & 0x7f,
        (size >> 14) & 0x7f,
        (size >> 7) & 0x7f,
        size & 0x7f,
      ),
      body,
    ]);
  };

  it('reads ID3v2.3: UTF-16, the year and day, a numbered genre, loop variants and unsynchronisation', async () => {
    const picture = Uint8Array.of(0xff, 0x00, 0xd8, 0xff, 0xe0);
    const frames23 = concatenate([
      frame23('TIT2', concatenate([Uint8Array.of(1), utf16('Héllo')])),
      frame23('TYER', concatenate([Uint8Array.of(0), ascii('1999')])),
      frame23('TDAT', concatenate([Uint8Array.of(0), ascii('3112')])),
      frame23('TCON', concatenate([Uint8Array.of(0), ascii('(17)')])),
      frame23('TRCK', concatenate([Uint8Array.of(0), ascii('4/10')])),
      frame23(
        'TXXX',
        concatenate([Uint8Array.of(0), ascii('loop_start'), Uint8Array.of(0), ascii('100')]),
      ),
      frame23(
        'TXXX',
        concatenate([Uint8Array.of(0), ascii('LOOPEND'), Uint8Array.of(0), ascii('300')]),
      ),
      frame23(
        'COMM',
        concatenate([
          Uint8Array.of(0),
          ascii('eng'),
          ascii('iTunNORM'),
          Uint8Array.of(0),
          ascii('x'),
        ]),
      ),
      // The picture's bytes hold 0xFF 0x00, which unsynchronisation writes as 0xFF 0x00 0x00.
      frame23(
        'APIC',
        concatenate([Uint8Array.of(0), ascii('image/jpeg'), Uint8Array.of(0, 3, 0), picture]),
      ),
    ]);
    const unsynchronised: number[] = [];
    for (const byte of frames23) {
      unsynchronised.push(byte);
      if (byte === 0xff) unsynchronised.push(0);
    }
    // An extended header of six bytes after its size.
    const extended = Uint8Array.of(0, 0, 0, 6, 0, 0, 0, 0, 0, 0);
    const file = concatenate([
      tagOf(3, 0x80 | 0x40, concatenate([extended, Uint8Array.from(unsynchronised)])),
      constantStream,
    ]);
    expect(expectSuccess(await readId3Metadata(memoryBytes(file)))).toEqual({
      text: {
        title: 'Héllo',
        genre: 'Rock',
        trackNumber: '4',
        trackTotal: '10',
        date: '1999-12-31',
      },
      foreign: [{ scheme: 'id3v2', key: 'COMM:iTunNORM', value: 'x' }],
      loops: [{ start: 100, length: 200, playCount: 'endless', direction: 'forward' }],
      coverArt: { mediaType: 'image/jpeg', description: '', bytes: picture },
    });
  });

  it('reads ID3v2.2 and fills what it lacks from ID3v1', async () => {
    const frame22 = (id: string, body: Uint8Array) =>
      concatenate([ascii(id), Uint8Array.of(0, 0, body.length), body]);
    const tag = tagOf(
      2,
      0,
      concatenate([
        frame22('TT2', concatenate([Uint8Array.of(0), ascii('Old')])),
        frame22('PIC', concatenate([Uint8Array.of(0), ascii('PNG'), Uint8Array.of(3, 0, 1, 2, 3)])),
      ]),
    );
    const v1 = new Uint8Array(128);
    v1.set(ascii('TAG'), 0);
    v1.set(ascii('Ignored'), 3);
    v1.set(ascii('Artist 1'), 33);
    v1.set(ascii('2001'), 93);
    v1.set(ascii('A comment'), 97);
    v1[126] = 7;
    v1[127] = 26;
    const file = concatenate([tag, constantStream, v1]);
    expect(expectSuccess(await readId3Metadata(memoryBytes(file)))).toEqual({
      text: {
        title: 'Old',
        artist: 'Artist 1',
        date: '2001',
        comment: 'A comment',
        trackNumber: '7',
        genre: 'Ambient',
      },
      coverArt: { mediaType: 'image/png', description: '', bytes: Uint8Array.of(1, 2, 3) },
    });
  });
});
