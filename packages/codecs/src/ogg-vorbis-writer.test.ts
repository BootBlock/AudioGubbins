/**
 * The Ogg Vorbis writer and the reading of a Vorbis stream's block sizes, on
 * packets written here as libvorbis lays them out: the headers' pages, the
 * map's comments with the encoder's vendor, the granule positions each
 * packet's mode decides, and the end trimmed to the frames the encoder was
 * given.
 */

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { concatenate } from './byte-writer.js';
import { readOggMetadata } from './ogg-metadata-reader.js';
import { OggPacketAssembler } from './ogg-packet-assembly.js';
import { END_OF_STREAM } from './ogg-page.js';
import { OggVorbisWriter } from './ogg-vorbis-writer.js';
import {
  fullMetadata,
  memoryBytes,
  oggPages,
  vorbisAudioPacket,
  vorbisComment,
  vorbisIdentification,
  vorbisSetup,
} from './testing/index.js';
import { readVorbisBlockSizes, vorbisPacketBlockSize } from './vorbis-headers.js';

const VENDOR = 'Xiph.Org libVorbis I 20200704 (Reducing Environment)';

/** A short block of 256 samples and a long one of 2,048, mode 0 short and mode 1 long. */
const MODES = [false, true] as const;

/** The headers of a stream of `channels` channels and two modes. */
function headers(channels = 2): readonly Uint8Array[] {
  return [vorbisIdentification(channels), vorbisComment(VENDOR), vorbisSetup(MODES)];
}

/** The modes of a stream's audio packets: short, then long ones, then short. */
const PACKET_MODES = [0, 0, 1, 1, 1, 0, 0, 1, 1, 0] as const;

/** The samples decoded by the end of each audio packet, the first decoding none. */
function granules(): number[] {
  const sizes = PACKET_MODES.map((mode) => (mode === 1 ? 2048 : 256));
  let decoded = 0;
  return sizes.map((size, index) => {
    if (index > 0) decoded += ((sizes[index - 1] ?? 0) + size) / 4;
    return decoded;
  });
}

/** A file written from the headers and the audio packets, ending at `inputFrames`. */
function written(inputFrames: number) {
  const writer = new OggVorbisWriter(fullMetadata());
  const audio = PACKET_MODES.map((mode, index) =>
    vorbisAudioPacket(mode, 2, 200 + index * 50, index),
  );
  const body = [...headers(), ...audio].flatMap((packet) => expectSuccess(writer.add(packet)));
  const finished = expectSuccess(writer.finish({ inputFrames }));
  return {
    file: concatenate([finished.head, ...body, ...finished.body, finished.tail]),
    audio,
    finished,
  };
}

/** The packets of a file's pages, in order. */
function packetsOf(file: Uint8Array): Uint8Array[] {
  const assembler = new OggPacketAssembler(1 << 26);
  return oggPages(file).flatMap((page) => [...expectSuccess(assembler.add(page)).packets]);
}

describe('the Vorbis headers', () => {
  it('state the block sizes and the block of each mode', () => {
    const [identification, , setup] = headers();
    const sizes = expectSuccess(
      readVorbisBlockSizes(identification ?? new Uint8Array(), setup ?? new Uint8Array()),
    );
    expect(sizes).toEqual({ short: 256, long: 2048, modeIsLong: [false, true] });
    expect(expectSuccess(vorbisPacketBlockSize(vorbisAudioPacket(1, 2, 10), sizes))).toBe(2048);
    expect(expectSuccess(vorbisPacketBlockSize(vorbisAudioPacket(0, 2, 10), sizes))).toBe(256);
  });

  it('refuse a setup header cut short, and a packet of a mode the setup lacks', () => {
    const [identification, , setup] = headers();
    const whole = setup ?? new Uint8Array();
    expect(
      expectFailureCode(
        readVorbisBlockSizes(
          identification ?? new Uint8Array(),
          whole.subarray(0, whole.length - 3),
        ),
      ),
    ).toBe('codecs.encoded-stream-invalid');
    const one = expectSuccess(
      readVorbisBlockSizes(identification ?? new Uint8Array(), vorbisSetup([false, false, true])),
    );
    expect(expectFailureCode(vorbisPacketBlockSize(vorbisAudioPacket(3, 4, 10), one))).toBe(
      'codecs.encoded-stream-invalid',
    );
  });
});

describe('the Ogg Vorbis writer', () => {
  it('writes the headers on pages of their own, with the map’s comments and the encoder’s vendor', async () => {
    const inputFrames = (granules().at(-1) ?? 0) - 100;
    const { file, audio, finished } = written(inputFrames);
    expect(finished.dropped).toEqual([]);
    const packets = packetsOf(file);
    const [identification, , setup] = headers();
    expect(packets[0]).toEqual(identification);
    expect(packets[2]).toEqual(setup);
    expect(packets.slice(3)).toEqual(audio);
    expect(new TextDecoder().decode(packets[1]?.subarray(11, 11 + VENDOR.length))).toBe(VENDOR);
    expect(expectSuccess(await readOggMetadata(memoryBytes(file)))).toEqual(fullMetadata());

    const pages = oggPages(file);
    expect(pages[0]?.lacing).toHaveLength(1);
    expect(pages.every((page) => page.serial === 0x4147566f)).toBe(true);
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, index) => index));
  });

  it('counts each packet’s samples by its mode, and ends at the frames the encoder was given', () => {
    const expected = granules();
    const inputFrames = (expected.at(-1) ?? 0) - 100;
    const { file } = written(inputFrames);
    // Every audio packet is short enough to end a page of its own only at the end.
    const pages = oggPages(file);
    const last = pages.at(-1);
    expect((last?.headerType ?? 0) & END_OF_STREAM).toBe(END_OF_STREAM);
    expect(last?.granule).toBe(inputFrames);
    const written2 = written(expected.at(-1) ?? 0).file;
    expect(oggPages(written2).at(-1)?.granule).toBe(expected.at(-1));
  });

  it('refuses a padding longer than the last packet, and more frames than the packets decode to', () => {
    const expected = granules();
    for (const inputFrames of [(expected.at(-2) ?? 0) - 1, (expected.at(-1) ?? 0) + 1]) {
      const writer = new OggVorbisWriter({});
      for (const packet of headers()) expectSuccess(writer.add(packet));
      PACKET_MODES.forEach((mode) => expectSuccess(writer.add(vorbisAudioPacket(mode, 2, 100))));
      expect(expectFailureCode(writer.finish({ inputFrames }))).toBe(
        'codecs.encoded-stream-invalid',
      );
    }
  });

  it('refuses a stream that does not begin with its headers, and takes nothing after', () => {
    const writer = new OggVorbisWriter({});
    expect(expectFailureCode(writer.add(vorbisComment(VENDOR)))).toBe(
      'codecs.encoded-stream-invalid',
    );
    expect(expectFailureCode(writer.add(vorbisIdentification(2)))).toBe('codecs.writer-ended');
    const headless = new OggVorbisWriter({});
    expect(expectFailureCode(headless.finish({ inputFrames: 0 }))).toBe(
      'codecs.encoded-stream-invalid',
    );
  });
});
