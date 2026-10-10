/**
 * The compressed containers' metadata readers and framers against damaged
 * input (REQ-EXEC-136): hundreds of deterministic mutations of each generated
 * header, every one answered as a result, never thrown, within a stated time;
 * the bounds a hostile header cannot push a reader past; and cancellation.
 */

import {
  Cancelled,
  createCancellationSource,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import type { AudioBytes } from './audio-bytes.js';
import { ByteWriter, concatenate } from './byte-writer.js';
import type { EncodedStreamWriter } from './encoded-stream-writer.js';
import { readFlacMetadata } from './flac-metadata-reader.js';
import { FlacSampleDigest } from './flac-sample-digest.js';
import { FlacStreamWriter } from './flac-stream-writer.js';
import type { MetadataMap } from './metadata-map.js';
import { box } from './mp4-box.js';
import { Mp4AacWriter } from './mp4-aac-writer.js';
import { readMp4Metadata } from './mp4-metadata-reader.js';
import { readId3Metadata } from './id3-metadata-reader.js';
import { Mp3StreamWriter } from './mp3-stream-writer.js';
import { readOggMetadata } from './ogg-metadata-reader.js';
import { OggOpusWriter } from './ogg-opus-writer.js';
import { OggPageWriter } from './ogg-page-writer.js';
import { OggVorbisCommentRewriter } from './ogg-vorbis-comment-rewriter.js';
import {
  frames,
  fullMetadata,
  memoryBytes,
  mutations,
  oggFlacFile as oggFlacStream,
} from './testing/index.js';
import { encodeVorbisComment } from './vorbis-comment.js';

/** How many damaged copies of each header are read. */
const MUTATIONS = 300;

/** The longest all the mutations of one container may take to be read, far past what they need. */
const READ_TIME_MS = 10_000;

/** The failures a damaged file may be refused with. */
const DESIGNED = new Set([
  'codecs.malformed',
  'codecs.metadata-over-bound',
  'codecs.metadata-unread',
]);

/** The metadata every file here carries, with the sampler parts FLAC's chunks hold. */
const METADATA: MetadataMap = {
  ...fullMetadata(),
  cues: [{ position: frames(10), name: 'Cue' }],
  tuning: { unityNote: 60, fineTuneCents: 5 },
};

/** Writes a whole file through a framer. */
function written<TEnd>(
  writer: EncodedStreamWriter<TEnd>,
  units: readonly Uint8Array[],
  end: TEnd,
): Uint8Array {
  const body = units.flatMap((unit) => expectSuccess(writer.add(unit)));
  const finished = expectSuccess(writer.finish(end));
  return concatenate([finished.head, ...body, ...finished.body, finished.tail]);
}

const opusFile = () =>
  written(
    expectSuccess(
      OggOpusWriter.create({
        channels: 2,
        preSkip: 312,
        inputRate: 48_000,
        outputGain: 0,
        mapping: { family: 0 },
        vendor: 'opus',
        metadata: METADATA,
      }),
    ),
    Array.from({ length: 3 }, () => Uint8Array.of(31 << 3, 1, 2, 3)),
    { inputFrames: 2_000 },
  );

/** A Vorbis stream as libvorbis lays it out, given the metadata by the rewriter. */
function vorbisFile(): Uint8Array {
  const pages = new OggPageWriter(5);
  const header = (type: number, body: Uint8Array) =>
    concatenate([Uint8Array.of(type, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73), body]);
  const comment = encodeVorbisComment({}, { vendor: 'libVorbis', pictureField: false }).bytes;
  const stream = concatenate([
    ...pages.addPacket(header(1, new Uint8Array(23)), 0),
    ...pages.flush(),
    ...pages.addPacket(header(3, concatenate([comment, Uint8Array.of(1)])), 0),
    ...pages.addPacket(header(5, new Uint8Array(200)), 0),
    ...pages.flush(),
    ...pages.addPacket(new Uint8Array(100), 1_024),
    ...pages.flush(true),
  ]);
  return written(new OggVorbisCommentRewriter(METADATA), [stream], undefined);
}

const crc8 = (bytes: Uint8Array) => {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
};

/** A FLAC frame header of a 4,096-sample block of 16-bit stereo at 48 kHz, numbered `number`, and filler. */
const flacFrame = (number: number) => {
  const header = Uint8Array.of(0xff, 0xf8, 0xca, 0x18, number);
  return concatenate([header, Uint8Array.of(crc8(header)), new Uint8Array(30)]);
};

/** The head of a FLAC file of two frames carrying the metadata, and the frames. */
function flacParts(): { readonly head: Uint8Array; readonly frames: readonly Uint8Array[] } {
  const digest = new FlacSampleDigest(16);
  digest.add([new Int32Array(8_192), new Int32Array(8_192)], 8_192);
  const writer = expectSuccess(
    FlacStreamWriter.create({
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
      blockSize: 4_096,
      vendor: 'flacenc',
      metadata: METADATA,
      keepRiffChunks: true,
    }),
  );
  const frames = [flacFrame(0), flacFrame(1)];
  for (const frame of frames) expectSuccess(writer.add(frame));
  return { head: expectSuccess(writer.finish({ samples: digest })).head, frames };
}

/** The same FLAC stream mapped into Ogg. */
function oggFlacFile(): Uint8Array {
  const { head, frames } = flacParts();
  return oggFlacStream(
    head,
    frames.map((bytes) => ({ bytes, samples: 4_096 })),
  );
}

function flacFile(): Uint8Array {
  const { head, frames } = flacParts();
  return concatenate([head, ...frames]);
}

const m4aFile = () =>
  written(
    expectSuccess(
      Mp4AacWriter.create({
        audioSpecificConfig: Uint8Array.of(0x12, 0x10),
        primingFrames: 1_024,
        metadata: METADATA,
      }),
    ),
    Array.from({ length: 4 }, () => new Uint8Array(50)),
    { inputFrames: 2_000 },
  );

/** A stereo 128 kbit/s MPEG 1 Layer III frame at 44.1 kHz. */
const mp3Frame = () => {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return frame;
};

const mp3File = () =>
  written(
    expectSuccess(
      Mp3StreamWriter.create({ metadata: METADATA, encoderDelay: 576, encoder: 'LAME3.100' }),
    ),
    [concatenate(Array.from({ length: 4 }, mp3Frame))],
    { inputFrames: 3_000 },
  );

type Reader = (
  bytes: AudioBytes,
  signal?: CancellationSignal,
) => Promise<DomainResult<MetadataMap>>;

const CONTAINERS: readonly (readonly [name: string, make: () => Uint8Array, read: Reader])[] = [
  ['Ogg Opus', opusFile, readOggMetadata],
  ['Ogg Vorbis', vorbisFile, readOggMetadata],
  ['Ogg FLAC', oggFlacFile, readOggMetadata],
  ['FLAC', flacFile, readFlacMetadata],
  ['M4A', m4aFile, readMp4Metadata],
  ['MP3', mp3File, readId3Metadata],
];

describe('damaged compressed metadata', () => {
  it.each(CONTAINERS)('reads the undamaged %s file', async (_name, make, read) => {
    expect(expectSuccess(await read(memoryBytes(make()))).text?.title).toBe(METADATA.text?.title);
  });

  it.each(CONTAINERS)(
    `answers ${String(MUTATIONS)} damaged %s headers as results, within bounds and time`,
    async (_name, make, read) => {
      const file = make();
      // The metadata lies in the first bytes of every file here, but for MP4's movie box, which follows the samples' header.
      const started = performance.now();
      for (const damaged of mutations(file, Math.min(file.length, 6_000), MUTATIONS, file.length)) {
        const bytes = memoryBytes(damaged);
        const result = await read(bytes);
        if (!result.ok) expect(DESIGNED).toContain(result.failures[0].code);
        expect(bytes.bytesRequested).toBeLessThanOrEqual(damaged.length + 64);
      }
      expect(performance.now() - started).toBeLessThan(READ_TIME_MS);
    },
  );

  it.each(CONTAINERS)(
    'rejects with the signal’s reason when %s reading is cancelled',
    async (_name, make, read) => {
      const source = createCancellationSource();
      // The person gives up while the reader waits on its first read.
      const bytes = memoryBytes(make(), {
        answer: (_request, honest) => {
          source.cancel();
          return honest;
        },
      });
      await expect(read(bytes, source.signal)).rejects.toBeInstanceOf(Cancelled);
    },
  );
});

describe('hostile metadata past the bounds', () => {
  it('refuses a Vorbis comment block of more comments than the bound', async () => {
    const comments = new ByteWriter().u32(0, true).u32(5_000, true);
    for (let index = 0; index < 5_000; index += 1) comments.u32(3, true).latin1('A=b');
    const pages = new OggPageWriter(1);
    const file = concatenate([
      ...pages.addPacket(
        concatenate([Uint8Array.from('OpusHead', (c) => c.charCodeAt(0)), new Uint8Array(11)]),
        0,
      ),
      ...pages.flush(),
      ...pages.addPacket(
        concatenate([Uint8Array.from('OpusTags', (c) => c.charCodeAt(0)), comments.toBytes()]),
        0,
      ),
      ...pages.flush(true),
    ]);
    expect(expectFailureCode(await readOggMetadata(memoryBytes(file)))).toBe(
      'codecs.metadata-over-bound',
    );
  });

  it('refuses MP4 boxes past the bound and a box larger than its parent', async () => {
    const many = box('moov', ...Array.from({ length: 5_000 }, () => box('free')));
    expect(expectFailureCode(await readMp4Metadata(memoryBytes(many)))).toBe(
      'codecs.metadata-over-bound',
    );
    const lying = new ByteWriter().u32(0x7fffffff).latin1('moov').toBytes();
    expect(expectFailureCode(await readMp4Metadata(memoryBytes(lying)))).toBe('codecs.malformed');
  });

  it('refuses FLAC and ID3v2 headers whose sizes run past the file', async () => {
    const flac = new ByteWriter().latin1('fLaC').u8(0x80).u24(0xffffff).toBytes();
    expect(expectFailureCode(await readFlacMetadata(memoryBytes(flac)))).toBe('codecs.malformed');
    const id3 = Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f);
    expect(expectFailureCode(await readId3Metadata(memoryBytes(id3)))).toBe('codecs.malformed');
  });
});

describe('damaged encoder output', () => {
  /** Damaged copies of `stream` through a fresh framer each, every answer a result. */
  const framed = <TEnd>(
    make: () => EncodedStreamWriter<TEnd>,
    stream: readonly Uint8Array[],
    end: TEnd,
  ) => {
    const joined = concatenate(stream);
    const lengths = stream.map((unit) => unit.length);
    for (const damaged of mutations(joined, joined.length, MUTATIONS, joined.length)) {
      const writer = make();
      let offset = 0;
      let failed = false;
      for (const length of lengths) {
        const result = writer.add(damaged.subarray(offset, offset + length));
        offset += length;
        if (!result.ok) {
          failed = true;
          break;
        }
      }
      if (!failed) writer.finish(end);
    }
  };

  it('answers damaged FLAC frames, MP3 bytes, Opus packets and Ogg Vorbis streams as results', () => {
    const started = performance.now();
    const digest = () => {
      const samples = new FlacSampleDigest(16);
      samples.add([new Int32Array(8_192), new Int32Array(8_192)], 8_192);
      return samples;
    };
    expect(() => {
      framed(
        () =>
          expectSuccess(
            FlacStreamWriter.create({
              sampleRate: 48_000,
              channels: 2,
              bitsPerSample: 16,
              blockSize: 4_096,
              vendor: 'v',
              metadata: {},
              keepRiffChunks: false,
            }),
          ),
        [flacFrame(0), flacFrame(1)],
        { samples: digest() },
      );
      framed(
        () =>
          expectSuccess(
            Mp3StreamWriter.create({ metadata: {}, encoderDelay: 576, encoder: 'LAME3.100' }),
          ),
        [concatenate(Array.from({ length: 3 }, mp3Frame))],
        { inputFrames: 2_000 },
      );
      framed(
        () =>
          expectSuccess(
            OggOpusWriter.create({
              channels: 1,
              preSkip: 0,
              inputRate: 0,
              outputGain: 0,
              mapping: { family: 0 },
              vendor: 'v',
              metadata: {},
            }),
          ),
        [Uint8Array.of(31 << 3, 1), Uint8Array.of(3, 2, 1)],
        { inputFrames: 100 },
      );
      framed(() => new OggVorbisCommentRewriter({}), [vorbisFile()], undefined);
    }).not.toThrow();
    expect(performance.now() - started).toBeLessThan(READ_TIME_MS);
  });
});
