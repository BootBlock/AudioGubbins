/**
 * The Ogg page reader and writer and the Ogg Opus writer, on streams generated
 * here, and every metadata field through each of them and back through the Ogg
 * metadata reader. The Ogg Vorbis writer has its own file.
 */

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { concatenate } from './byte-writer.js';
import { OggPacketAssembler } from './ogg-packet-assembly.js';
import { readOggMetadata } from './ogg-metadata-reader.js';
import { OggOpusWriter, type OggOpusSettings } from './ogg-opus-writer.js';
import {
  BEGINNING_OF_STREAM,
  CONTINUED_PACKET,
  END_OF_STREAM,
  encodeOggPage,
  oggCrc,
  readOggPage,
} from './ogg-page.js';
import { OggPageWriter } from './ogg-page-writer.js';
import {
  encodeOpusHead,
  opusPacketDuration,
  readOpusHead,
  type OpusHeadSettings,
} from './opus-header.js';
import { fullMetadata, memoryBytes, oggPages, random } from './testing/index.js';
import { encodeVorbisComment } from './vorbis-comment.js';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

const filled = (length: number, seed: number) =>
  Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 0xff);

/** The packets of a stream's pages, in order. */
function packetsOf(file: Uint8Array): Uint8Array[] {
  const assembler = new OggPacketAssembler(1 << 26);
  return oggPages(file).flatMap((page) => [...expectSuccess(assembler.add(page)).packets]);
}

/** An Opus packet of one 20 ms CELT frame (config 31, code 0), 960 samples at 48 kHz. */
const opusPacket = (seed: number) => concatenate([Uint8Array.of(31 << 3), filled(60, seed)]);

const opusSettings = (extra: Partial<OggOpusSettings> = {}): OggOpusSettings => ({
  channels: 2,
  preSkip: 312,
  inputRate: 44_100,
  outputGain: 0,
  mapping: { family: 0 },
  vendor: 'opus-rs 0.1',
  metadata: fullMetadata(),
  ...extra,
});

/** An Ogg Opus file written from `packets` packets for `inputFrames` frames. */
function opusFile(packets: number, inputFrames: number, settings = opusSettings()) {
  const writer = expectSuccess(OggOpusWriter.create(settings));
  const body: Uint8Array[] = [];
  for (let index = 0; index < packets; index += 1)
    body.push(...expectSuccess(writer.add(opusPacket(index))));
  const finished = expectSuccess(writer.finish({ inputFrames }));
  return { file: concatenate([finished.head, ...body, ...finished.body, finished.tail]), finished };
}

describe('Ogg pages', () => {
  it('checks with the CRC-32 Ogg defines: unreflected 0x04C11DB7 from zero', () => {
    // CRC-32/CKSUM's check value is 0x765E7680, which inverts its result; Ogg's does not.
    expect(oggCrc(ascii('123456789'))).toBe(~0x765e7680 >>> 0);
  });

  it('round-trips a page and refuses one whose checksum disagrees', () => {
    const bytes = encodeOggPage({
      headerType: BEGINNING_OF_STREAM,
      granule: 2 ** 40 + 5,
      serial: 0xdeadbeef,
      sequence: 7,
      lacing: Uint8Array.of(255, 3),
      body: filled(258, 1),
    });
    const page = expectSuccess(readOggPage(bytes));
    expect(page).toMatchObject({
      headerType: BEGINNING_OF_STREAM,
      granule: 2 ** 40 + 5,
      serial: 0xdeadbeef,
      sequence: 7,
    });
    const damaged = bytes.slice();
    damaged[40] = (damaged[40] ?? 0) ^ 1;
    expect(expectFailureCode(readOggPage(damaged))).toBe('codecs.malformed');
  });

  it('laces packets into segments, continues long packets over pages and marks the stream ends', () => {
    const writer = new OggPageWriter(9);
    const packets = [
      filled(255, 1),
      filled(600, 2),
      filled(0, 3),
      filled(70_000, 4),
      filled(10, 5),
    ];
    const out = packets.flatMap((packet, index) => writer.addPacket(packet, (index + 1) * 100));
    out.push(...writer.flush(true));
    const file = concatenate(out);
    const pages = oggPages(file);

    expect(pages[0]?.lacing.slice(0, 6)).toEqual(Uint8Array.of(255, 0, 255, 255, 90, 0));
    expect(pages[0]?.headerType).toBe(BEGINNING_OF_STREAM);
    expect(pages.at(-1)?.headerType ?? 0).toBe(END_OF_STREAM | CONTINUED_PACKET);
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, index) => index));
    // Every page in the middle of the long packet ends no packet, so states no granule position.
    expect(
      pages
        .slice(1, -1)
        .every((page) => page.granule === 'none' && (page.headerType & CONTINUED_PACKET) !== 0),
    ).toBe(true);
    expect(pages.at(-1)?.granule).toBe(500);
    expect(pages.every((page) => page.lacing.length <= 255)).toBe(true);
    expect(packetsOf(file)).toEqual(packets);
  });

  it('ends a page after a packet whose last segment is full on a continued page holding its empty segment', () => {
    const writer = new OggPageWriter(1);
    // Seventeen full segments take the first page past its target, leaving the ending empty segment.
    const packet = filled(255 * 17, 9);
    const out = [...writer.addPacket(packet, 42), ...writer.flush(true)];
    const pages = oggPages(concatenate(out));
    expect(pages).toHaveLength(2);
    expect(pages[0]?.granule).toBe('none');
    expect(pages[1]?.lacing).toEqual(Uint8Array.of(0));
    expect((pages[1]?.headerType ?? 0) & CONTINUED_PACKET).toBe(CONTINUED_PACKET);
    expect(pages[1]?.granule).toBe(42);
    expect(packetsOf(concatenate(out))).toEqual([packet]);
  });

  it('refuses a page that continues nothing and one that leaves a packet unfinished', () => {
    const page = (headerType: number, lacing: number[]) => ({
      headerType,
      granule: 0,
      serial: 1,
      sequence: 0,
      lacing: Uint8Array.from(lacing),
      body: new Uint8Array(lacing.reduce((sum, value) => sum + value, 0)),
    });
    expect(expectFailureCode(new OggPacketAssembler(1_000).add(page(CONTINUED_PACKET, [3])))).toBe(
      'codecs.malformed',
    );
    const assembler = new OggPacketAssembler(1_000);
    expectSuccess(assembler.add(page(0, [255])));
    expect(expectFailureCode(assembler.add(page(0, [3])))).toBe('codecs.malformed');
  });
});

describe('Ogg Opus', () => {
  it('reads each packet’s duration from its table of contents', () => {
    expect(expectSuccess(opusPacketDuration(Uint8Array.of(31 << 3)))).toBe(960);
    expect(expectSuccess(opusPacketDuration(Uint8Array.of((16 << 3) | 1)))).toBe(240);
    expect(expectSuccess(opusPacketDuration(Uint8Array.of((3 << 3) | 3, 2)))).toBe(5_760);
    expect(expectFailureCode(opusPacketDuration(Uint8Array.of((3 << 3) | 3, 3)))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expect(expectFailureCode(opusPacketDuration(new Uint8Array()))).toBe(
      'codecs.encoded-stream-invalid',
    );
  });

  it('writes OpusHead alone on the first page and OpusTags ending its own page', () => {
    const { file } = opusFile(3, 2_000);
    const pages = oggPages(file);
    const head = pages[0]?.body ?? new Uint8Array();
    expect(pages[0]?.lacing).toHaveLength(1);
    expect(pages[0]?.headerType).toBe(BEGINNING_OF_STREAM);
    expect(Array.from(head)).toEqual([
      ...ascii('OpusHead'),
      1,
      2,
      312 & 0xff,
      312 >> 8,
      0x44,
      0xac,
      0,
      0,
      0,
      0,
      0,
    ]);
    const packets = packetsOf(file);
    expect(packets[1]?.subarray(0, 8)).toEqual(ascii('OpusTags'));
    // The tags end a page: the first audio packet begins the page after them.
    const tagsPage = pages.findIndex((page, index) => index > 0 && page.lacing.at(-1) !== 255);
    expect(pages[tagsPage]?.granule).toBe(0);
    expect(pages[tagsPage + 1]?.granule).not.toBe(0);
  });

  it('writes the mapping table of family 1', () => {
    const { file } = opusFile(
      1,
      100,
      opusSettings({
        channels: 6,
        mapping: { family: 1, streams: 4, coupledStreams: 2, table: [0, 4, 1, 2, 3, 5] },
      }),
    );
    expect(Array.from(oggPages(file)[0]?.body.subarray(19) ?? [])).toEqual([
      4, 2, 0, 4, 1, 2, 3, 5,
    ]);
  });

  it('reads back every header it writes, and refuses one it could not have written', () => {
    const stereo: OpusHeadSettings = {
      channels: 2,
      preSkip: 312,
      inputRate: 44_100,
      outputGain: -256,
      mapping: { family: 0 },
    };
    const surround: OpusHeadSettings = {
      ...stereo,
      channels: 6,
      mapping: { family: 1, streams: 4, coupledStreams: 2, table: [0, 4, 1, 2, 3, 5] },
    };
    for (const head of [stereo, surround]) {
      expect(expectSuccess(readOpusHead(expectSuccess(encodeOpusHead(head))))).toEqual(head);
    }
    const written = expectSuccess(encodeOpusHead(stereo));
    const truncated = written.subarray(0, 18);
    const versionTwo = written.slice();
    versionTwo[8] = 2;
    const familyTwo = written.slice();
    familyTwo[18] = 2;
    const threeInFamilyZero = written.slice();
    threeInFamilyZero[9] = 3;
    for (const bytes of [truncated, versionTwo, familyTwo, threeInFamilyZero]) {
      expect(expectFailureCode(readOpusHead(bytes))).toBe('codecs.encoded-stream-invalid');
    }
  });

  it('refuses settings the header cannot state', () => {
    for (const settings of [
      opusSettings({ channels: 3 }),
      opusSettings({ preSkip: 70_000 }),
      opusSettings({
        channels: 2,
        mapping: { family: 1, streams: 1, coupledStreams: 2, table: [0, 1] },
      }),
      opusSettings({
        channels: 2,
        mapping: { family: 1, streams: 1, coupledStreams: 1, table: [0, 2] },
      }),
      opusSettings({
        channels: 9,
        mapping: { family: 1, streams: 9, coupledStreams: 0, table: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      }),
    ]) {
      expect(expectFailureCode(OggOpusWriter.create(settings))).toBe('codecs.stream-unwritable');
    }
  });

  it('counts granule positions at 48 kHz from the pre-skip and trims the end by the last granule', () => {
    const { file } = opusFile(50, 47_000);
    const pages = oggPages(file);
    const audio = pages.filter((page) => page.granule !== 0 && page.granule !== 'none');
    const last = audio.at(-1);
    expect(last?.headerType).toBe(END_OF_STREAM);
    expect(last?.granule).toBe(312 + 47_000);
    // Every page before the last states the samples of the packets ending on it.
    const totals = audio.slice(0, -1).map((page) => page.granule);
    expect(totals.every((granule) => typeof granule === 'number' && granule % 960 === 0)).toBe(
      true,
    );
    expect(packetsOf(file).slice(2)).toEqual(
      Array.from({ length: 50 }, (_, index) => opusPacket(index)),
    );
  });

  it('refuses padding longer than the last packet and a length the packets do not reach', () => {
    const writer = () => {
      const opus = expectSuccess(OggOpusWriter.create(opusSettings()));
      for (let index = 0; index < 3; index += 1) expectSuccess(opus.add(opusPacket(index)));
      return opus;
    };
    // Three packets decode to 2,880 samples; the last begins at 1,920.
    expect(expectFailureCode(writer().finish({ inputFrames: 1_920 - 312 - 1 }))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expect(expectFailureCode(writer().finish({ inputFrames: 2_880 - 312 + 1 }))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expectSuccess(writer().finish({ inputFrames: 1_920 - 312 }));
    expectSuccess(writer().finish({ inputFrames: 2_880 - 312 }));
  });

  it('refuses to be used after it finishes', () => {
    const opus = expectSuccess(OggOpusWriter.create(opusSettings()));
    expectSuccess(opus.add(opusPacket(0)));
    expectSuccess(opus.finish({ inputFrames: 10 }));
    expect(expectFailureCode(opus.add(opusPacket(1)))).toBe('codecs.writer-ended');
    expect(expectFailureCode(opus.finish({ inputFrames: 10 }))).toBe('codecs.writer-ended');
  });

  it('carries every field of the map and reads it back', async () => {
    const { file, finished } = opusFile(3, 2_000);
    expect(finished.dropped).toEqual([]);
    expect(expectSuccess(await readOggMetadata(memoryBytes(file)))).toEqual(fullMetadata());
  });
});
