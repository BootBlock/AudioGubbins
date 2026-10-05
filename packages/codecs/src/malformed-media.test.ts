/**
 * Every refusal REQ-AUDIO-220 asks for, the truncation it asks not to refuse,
 * the bounds a hostile header cannot push a reader past, cancellation, a file
 * that changes while it is read, and a fuzz of damaged headers that must only
 * ever be answered, never thrown.
 */

import { Cancelled, type DomainResult, type SampleCount } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { openAudio, type AudioBytes } from './index.js';
import { recogniseAudio } from './recognition.js';
import {
  channelLayoutBody,
  memoryBytes,
  writeAiff,
  writeWav,
  type FixtureChunk,
} from './testing/index.js';

const READABLE = 'AudioGubbins reads WAV (including RF64 and BW64), AIFF and uncompressed AIFF-C.';

/** A deterministic generator of 32-bit fractions. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
  };
}

const stereo = (frames: number) => [
  Float64Array.from({ length: frames }, (_, frame) => (frame % 200) / 256 - 0.25),
  Float64Array.from({ length: frames }, (_, frame) => 0 - (frame % 100) / 512),
];

const wav16 = (extra: Partial<Parameters<typeof writeWav>[0]> = {}) =>
  writeWav({
    sampleRate: 48_000,
    encoding: { kind: 'integer', bits: 16 },
    channels: stereo(100),
    ...extra,
  });

const aiff16 = (extra: Partial<Parameters<typeof writeAiff>[0]> = {}) =>
  writeAiff({ sampleSize: 16, sampleRate: 48_000, channels: stereo(100), ...extra });

/** The offset of the header of the first chunk with this id, walking the chunks. */
function chunkAt(file: Uint8Array, id: string, little: boolean): number {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  for (let at = 12; at + 8 <= file.length;) {
    if (String.fromCharCode(...file.subarray(at, at + 4)) === id) return at;
    const size = view.getUint32(at + 4, little);
    at += 8 + size + (size % 2);
  }
  throw new Error(`The fixture has no '${id}' chunk.`);
}

/** A copy of the file with an unsigned field replaced. */
function patched(
  file: Uint8Array,
  offset: number,
  value: number,
  bytes: 1 | 2 | 4,
  little: boolean,
): Uint8Array {
  const copy = file.slice();
  const view = new DataView(copy.buffer);
  if (bytes === 1) view.setUint8(offset, value);
  else if (bytes === 2) view.setUint16(offset, value, little);
  else view.setUint32(offset, value, little);
  return copy;
}

/** A copy of the file with a four-character code replaced. */
function renamed(file: Uint8Array, offset: number, id: string): Uint8Array {
  const copy = file.slice();
  copy.set(
    Uint8Array.from(id, (character) => character.charCodeAt(0)),
    offset,
  );
  return copy;
}

/** The first failure of a result, which must have failed. */
function firstFailure<T>(result: DomainResult<T>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('The result succeeded.');
  return result.failures[0];
}

describe('a format AudioGubbins does not read', () => {
  const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
  const padded = (head: Uint8Array) => {
    const file = new Uint8Array(256);
    file.set(head);
    return file;
  };
  const foreign: readonly [string, Uint8Array, string, string][] = [
    ['FLAC', padded(ascii('fLaC\0\0\0"')), 'flac', 'This file is FLAC audio.'],
    ['MP3 with an ID3 tag', padded(ascii('ID3\x04\0\0')), 'mp3', 'This file is MP3 audio.'],
    [
      'MP3 from its first frame',
      padded(Uint8Array.of(0xff, 0xfb, 0x90, 0x64)),
      'mp3',
      'This file is MP3 audio.',
    ],
    ['Ogg', padded(ascii('OggS\0\x02')), 'ogg', 'This file is Ogg audio.'],
    [
      'M4A',
      padded(ascii('\0\0\0\x20ftypM4A ')),
      'mp4',
      'This file is MPEG-4 audio, such as M4A or AAC.',
    ],
    [
      'text',
      padded(ascii('Nothing to hear here, only words.')),
      'unknown',
      'This file is not in an audio format AudioGubbins recognises.',
    ],
    [
      'a RIFF that is not WAVE',
      padded(ascii('RIFF\x10\0\0\0AVI LIST')),
      'unknown',
      'not in an audio format',
    ],
    ['an empty file', new Uint8Array(0), 'unknown', 'not in an audio format'],
  ];

  it.each(foreign)('names %s and the formats that can be read', async (_, file, kind, sentence) => {
    expect(expectSuccess(await recogniseAudio(memoryBytes(file))).kind).toBe(kind);
    const refusal = firstFailure(await openAudio(memoryBytes(file)));
    expect(refusal.code).toBe('codecs.unsupported-format');
    expect(refusal.kind).toBe('rejected');
    expect(refusal.summary).toContain(sentence);
    expect(refusal.summary).toContain(READABLE);
  });

  const wavCodecs: readonly [number, string][] = [
    [0x0002, 'Microsoft ADPCM'],
    [0x0006, 'A-law'],
    [0x0007, 'µ-law'],
    [0x0011, 'IMA ADPCM'],
    [0x0050, 'MPEG'],
    [0x0055, 'MPEG Layer III'],
    [0x1234, 'code 0x1234'],
  ];

  it.each(wavCodecs)('names a WAV compressed with format tag %i as %s', async (formatTag, name) => {
    const refusal = firstFailure(await openAudio(memoryBytes(wav16({ formatTag }))));
    expect(refusal.code).toBe('codecs.unsupported-format');
    expect(refusal.summary).toBe(`This file is WAV audio compressed as ${name}. ${READABLE}`);
    expect(expectSuccess(await recogniseAudio(memoryBytes(wav16({ formatTag }))))).toEqual({
      kind: 'compressed-wav',
      container: 'wav',
      formatTag,
    });
  });

  it('names the codec of an extensible sub-format and of a compressed RF64', async () => {
    const adpcm = Uint8Array.of(
      2,
      0,
      0,
      0,
      0x00,
      0x00,
      0x10,
      0x00,
      0x80,
      0x00,
      0x00,
      0xaa,
      0x00,
      0x38,
      0x9b,
      0x71,
    );
    const extensible = wav16({ extensible: { channelMask: 3, subFormat: adpcm } });
    expect(firstFailure(await openAudio(memoryBytes(extensible))).summary).toContain(
      'WAV audio compressed as Microsoft ADPCM.',
    );
    const ambisonic = Uint8Array.of(
      1,
      0,
      0,
      0,
      0x21,
      0x07,
      0xd3,
      0x11,
      0x86,
      0x44,
      0xc8,
      0xc1,
      0xca,
      0x00,
      0x00,
      0x00,
    );
    const foreignGuid = wav16({ extensible: { channelMask: 3, subFormat: ambisonic } });
    expect(firstFailure(await openAudio(memoryBytes(foreignGuid))).summary).toContain(
      'compressed as sub-format 00000001-0721-11d3-8644-c8c1ca000000.',
    );
    const rf64 = wav16({ form: 'rf64', formatTag: 0x0011 });
    expect(firstFailure(await openAudio(memoryBytes(rf64))).summary).toContain(
      'This file is RF64 audio compressed as IMA ADPCM.',
    );
  });

  const aifcCodecs: readonly [string, string][] = [
    ['ulaw', 'µ-law'],
    ['alaw', 'A-law'],
    ['ima4', 'IMA 4:1 ADPCM'],
    ['MAC3', 'MACE 3:1'],
    ['MAC6', 'MACE 6:1'],
    ['GSM ', 'GSM'],
    ['abcd', "type 'abcd'"],
    ['\x01\x02ab', 'type 0x01026162'],
  ];

  it.each(aifcCodecs)('names an AIFF-C compressed as %j', async (compressionType, name) => {
    const file = aiff16({ form: 'aifc', compressionType });
    const refusal = firstFailure(await openAudio(memoryBytes(file)));
    expect(refusal.code).toBe('codecs.unsupported-format');
    expect(refusal.summary).toBe(`This file is AIFF-C audio compressed as ${name}. ${READABLE}`);
  });

  it('names a format from its contents whatever name the bytes travel under', async () => {
    const named: AudioBytes & { readonly name: string } = {
      ...memoryBytes(Uint8Array.of(0x66, 0x4c, 0x61, 0x43, 0, 0)),
      name: 'take-1.wav',
    };
    expect(expectSuccess(await recogniseAudio(named)).kind).toBe('flac');
  });
});

describe('a malformed header', () => {
  const fmtAt = (file: Uint8Array) => chunkAt(file, 'fmt ', true);
  const riffOnly = (chunks: readonly Uint8Array[]) => {
    const body = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const file = new Uint8Array(12 + body);
    file.set(Uint8Array.from('RIFF\0\0\0\0WAVE', (character) => character.charCodeAt(0)));
    let at = 12;
    for (const chunk of chunks) {
      file.set(chunk, at);
      at += chunk.length;
    }
    return file;
  };
  const rf64 = () => wav16({ form: 'rf64' });
  const ds64 = (file: Uint8Array) => chunkAt(file, 'ds64', true) + 8;
  const commAt = (file: Uint8Array) => chunkAt(file, 'COMM', false) + 8;
  const unlisted: FixtureChunk = { id: 'huge', body: Uint8Array.of(1, 2), statedSize: 0xffffffff };

  const cases: readonly [string, () => Uint8Array, RegExp][] = [
    [
      'a WAV with no format chunk',
      () => riffOnly([Uint8Array.from('junk\x02\0\0\0ab', (c) => c.charCodeAt(0))]),
      /no 'fmt ' chunk/u,
    ],
    [
      'sample data before the format chunk',
      () => wav16({ beforeFormat: [{ id: 'data', body: new Uint8Array(4) }] }),
      /sample data comes before the 'fmt ' chunk/u,
    ],
    [
      'a format chunk running past the file',
      () => patched(wav16(), fmtAt(wav16()) + 4, 0xffff, 4, true),
      /'fmt ' chunk runs past the end of the file/u,
    ],
    [
      'a format chunk too short',
      () => patched(wav16(), fmtAt(wav16()) + 4, 14, 4, true),
      /shorter than the 16 bytes/u,
    ],
    ['zero channels', () => wav16({ formatOverrides: { channelCount: 0 } }), /no channels/u],
    [
      'more channels than the domain holds',
      () => wav16({ formatOverrides: { channelCount: 300, blockAlign: 600 } }),
      /300 channels, more than the 256/u,
    ],
    [
      'a block align of zero',
      () => wav16({ formatOverrides: { blockAlign: 0 } }),
      /each frame takes no bytes/u,
    ],
    [
      'a block align that is not channels times bytes',
      () => wav16({ formatOverrides: { blockAlign: 6 } }),
      /6 bytes per frame, but 2 channels of 2-byte samples take 4/u,
    ],
    [
      'integer samples narrower than 8 bits',
      () => patched(wav16(), fmtAt(wav16()) + 22, 4, 2, true),
      /4-bit samples, outside the 8 to 32 bits/u,
    ],
    [
      'integer samples wider than 32 bits',
      () => patched(wav16(), fmtAt(wav16()) + 22, 40, 2, true),
      /40-bit samples, outside/u,
    ],
    [
      'float samples of 16 bits',
      () => {
        const file = writeWav({
          sampleRate: 48_000,
          encoding: { kind: 'float', bits: 32 },
          channels: [new Float64Array(4)],
        });
        return patched(file, fmtAt(file) + 22, 16, 2, true);
      },
      /16-bit floating-point samples, where only 32 and 64 bits exist/u,
    ],
    [
      'valid bits wider than their container',
      () =>
        wav16({
          encoding: { kind: 'integer', bits: 24, bytes: 2 },
          channels: [new Float64Array(4)],
          extensible: { channelMask: 4 },
        }),
      /24-bit samples in 2-byte containers/u,
    ],
    [
      'an extension too short',
      () => {
        const file = wav16({ extensible: { channelMask: 3 } });
        return patched(file, fmtAt(file) + 24, 10, 2, true);
      },
      /too short to hold its extension/u,
    ],
    [
      'a WAV with no data chunk',
      () => wav16().slice(0, chunkAt(wav16(), 'data', true)),
      /no data chunk/u,
    ],
    [
      'an RF64 without its ds64 chunk',
      () => renamed(rf64(), ds64(rf64()) - 8, 'junk'),
      /does not begin with the ds64 chunk/u,
    ],
    [
      'a ds64 chunk too short',
      () => patched(rf64(), ds64(rf64()) - 4, 20, 4, true),
      /shorter than the 28 bytes/u,
    ],
    [
      'a ds64 size past a safe integer',
      () => patched(rf64(), ds64(rf64()) + 12, 0x00200000, 4, true),
      /larger than any file can be/u,
    ],
    [
      'a ds64 table longer than its chunk',
      () => patched(rf64(), ds64(rf64()) + 24, 5, 4, true),
      /lists more chunk sizes than it holds/u,
    ],
    [
      'a chunk sized in ds64 that it does not list',
      () => wav16({ form: 'bw64', beforeData: [unlisted] }),
      /'huge' chunk's size is kept in the ds64 chunk, which does not list it/u,
    ],
    [
      'an AIFF with no COMM chunk',
      () => renamed(aiff16(), commAt(aiff16()) - 8, 'COMX'),
      /no COMM chunk/u,
    ],
    [
      'an AIFF with no SSND chunk',
      () => renamed(aiff16(), chunkAt(aiff16(), 'SSND', false), 'SSNX'),
      /no SSND chunk/u,
    ],
    [
      'a COMM chunk too short',
      () => patched(aiff16(), commAt(aiff16()) - 4, 10, 4, false),
      /COMM chunk is shorter than the 18 bytes/u,
    ],
    [
      'an AIFF-C COMM chunk too short',
      () => patched(aiff16({ form: 'aifc' }), commAt(aiff16({ form: 'aifc' })) - 4, 18, 4, false),
      /shorter than the 22 bytes/u,
    ],
    [
      'an SSND offset past its chunk',
      () => patched(aiff16(), chunkAt(aiff16(), 'SSND', false) + 8, 0x10000, 4, false),
      /offset points past the end of the chunk/u,
    ],
    [
      'an SSND chunk too short for its header',
      () => patched(aiff16({ afterSound: [] }), chunkAt(aiff16(), 'SSND', false) + 4, 6, 4, false),
      /SSND chunk is shorter than the 8 bytes/u,
    ],
    [
      'an AIFF of zero channels',
      () => aiff16({ commonOverrides: { channelCount: 0 } }),
      /no channels/u,
    ],
    [
      'an AIFF of 40-bit samples',
      () => patched(aiff16(), commAt(aiff16()) + 6, 40, 2, false),
      /40-bit samples, outside/u,
    ],
    [
      'an AIFF-C type whose width the COMM chunk contradicts',
      () => aiff16({ form: 'aifc', compressionType: 'in24', channels: [new Float64Array(4)] }),
      /'in24' holds 24-bit samples, but the COMM chunk states 16/u,
    ],
  ];

  it.each(cases)('refuses %s, saying what is wrong', async (_, file, sentence) => {
    const refusal = firstFailure(await openAudio(memoryBytes(file())));
    expect(refusal.code).toBe('codecs.malformed');
    expect(refusal.kind).toBe('integrity-violation');
    expect(refusal.summary).toMatch(sentence);
  });
});

describe('a sample rate AudioGubbins does not work at', () => {
  const rates: readonly [string, () => Uint8Array, string][] = [
    ['a WAV at 4 kHz', () => wav16({ sampleRate: 4_000 }), '4000'],
    ['a WAV at 1 MHz', () => wav16({ sampleRate: 1_000_000 }), '1000000'],
    ['an AIFF at a fractional rate', () => aiff16({ sampleRate: 44_100.5 }), '44100.5'],
    [
      'an AIFF at a rate whose fraction a double cannot hold',
      () => aiff16({ sampleRate: 44_100 + 2 ** -30 }),
      '44100.00000000093',
    ],
    [
      'an AIFF at a negative rate',
      () => patched(aiff16(), chunkAt(aiff16(), 'COMM', false) + 16, 0xc00e, 2, false),
      '-48000',
    ],
    [
      'an AIFF at an infinite rate',
      () =>
        patched(
          patched(aiff16(), chunkAt(aiff16(), 'COMM', false) + 16, 0x7fff, 2, false),
          chunkAt(aiff16(), 'COMM', false) + 18,
          0x80000000,
          4,
          false,
        ),
      'Infinity',
    ],
  ];

  it.each(rates)('refuses %s, naming the rate', async (_, file, named) => {
    const refusal = firstFailure(await openAudio(memoryBytes(file())));
    expect(refusal.code).toBe('codecs.unsupported-sample-rate');
    expect(refusal.summary).toContain(`sample rate of ${named}`);
  });

  it('reads an AIFF at a whole rate stated with a mantissa that is not normalised', async () => {
    // 48 000 Hz as 24 000 × 2: exponent one higher than normal, mantissa shifted right by one.
    const file = aiff16();
    const at = chunkAt(file, 'COMM', false) + 16;
    const view = new DataView(file.buffer);
    const mantissa =
      (BigInt(view.getUint32(at + 2, false)) << 32n) | BigInt(view.getUint32(at + 6, false));
    const shifted = mantissa >> 1n;
    const unnormal = patched(
      patched(
        patched(file, at, view.getUint16(at, false) + 1, 2, false),
        at + 2,
        Number(shifted >> 32n),
        4,
        false,
      ),
      at + 6,
      Number(shifted & 0xffffffffn),
      4,
      false,
    );
    expect(expectSuccess(await openAudio(memoryBytes(unnormal))).format.sampleRate).toBe(48_000);
  });
});

describe('a file cut short', () => {
  async function expectShortfall(
    file: Uint8Array,
    frames: number,
    declared: number,
    channels: readonly Float64Array[],
  ) {
    const reader = expectSuccess(await openAudio(memoryBytes(file)));
    expect(reader.format.frames).toBe(frames);
    expect(reader.format.declaredFrames).toBe(declared);
    const into = channels.map(() => new Float32Array(declared));
    expect(expectSuccess(await reader.read(0 as SampleCount, declared, into))).toBe(frames);
    for (const [channel, samples] of into.entries()) {
      expect(Array.from(samples.subarray(0, frames))).toEqual(
        Array.from(channels[channel]!.subarray(0, frames)),
      );
    }
    expect(expectFailureCode(await reader.read((frames + 1) as SampleCount, 1, into))).toBe(
      'codecs.read-past-end',
    );
    expect(expectSuccess(await reader.read(frames as SampleCount, 1, into))).toBe(0);
  }

  it('reads a WAV to its last whole frame and drops the partial one', async () => {
    await expectShortfall(wav16({ truncate: 5 }), 98, 100, stereo(100));
  });

  it('reads a WAV whose trailing chunk and part of its data are gone', async () => {
    await expectShortfall(
      wav16({ afterData: [{ id: 'LIST', body: new Uint8Array(30) }], truncate: 38 + 9 }),
      97,
      100,
      stereo(100),
    );
  });

  it('reads an RF64 and a BW64 cut short', async () => {
    await expectShortfall(wav16({ form: 'rf64', truncate: 4 }), 99, 100, stereo(100));
    await expectShortfall(wav16({ form: 'bw64', truncate: 400 }), 0, 100, stereo(100));
  });

  it('reads an AIFF and an AIFF-C cut short', async () => {
    await expectShortfall(aiff16({ truncate: 7 }), 98, 100, stereo(100));
    await expectShortfall(
      aiff16({ form: 'aifc', compressionType: 'sowt', truncate: 13 }),
      96,
      100,
      stereo(100),
    );
  });

  it('reads an AIFF cut off inside the header of its sound chunk as holding no frames', async () => {
    const file = aiff16();
    await expectShortfall(file.slice(0, chunkAt(file, 'SSND', false) + 12), 0, 100, stereo(100));
  });

  it('reads a RIFF whose data size is 0xFFFFFFFF as cut short, not as RF64', async () => {
    const file = wav16();
    const big = patched(file, chunkAt(file, 'data', true) + 4, 0xffffffff, 4, true);
    const reader = expectSuccess(await openAudio(memoryBytes(big)));
    expect(reader.format.container).toBe('wav');
    expect(reader.format.frames).toBe(100);
    expect(reader.format.declaredFrames).toBe(Math.floor(0xffffffff / 4));
  });
});

describe('a header that claims more than a file holds', () => {
  it('reads only chunk headers past an unknown chunk claiming nearly 4 GiB', async () => {
    const file = wav16({
      beforeFormat: [{ id: 'huge', body: new Uint8Array(2), statedSize: 0xfffffff0 }],
    });
    const bytes = memoryBytes(file);
    expect(expectFailureCode(await openAudio(bytes))).toBe('codecs.malformed');
    expect(bytes.bytesRequested).toBeLessThanOrEqual(64);
  });

  it('stops walking after 4096 chunks, having read only their headers', async () => {
    const many = Array.from({ length: 4_100 }, () => ({ id: 'tiny', body: new Uint8Array(0) }));
    const bytes = memoryBytes(wav16({ beforeFormat: many }));
    const refusal = firstFailure(await openAudio(bytes));
    expect(refusal.summary).toMatch(/more than 4096 chunks/u);
    expect(bytes.bytesRequested).toBeLessThanOrEqual(64 + 8 * 4_096);
  });

  it('reads a CHAN chunk only as far as the channels it can describe', async () => {
    const labels = Array.from({ length: 10_000 }, (_, index) => index);
    const bytes = memoryBytes(aiff16({ channelLayout: channelLayoutBody({ tag: 0, labels }) }));
    expect(expectSuccess(await openAudio(bytes)).format.statedLayout).toBeUndefined();
    expect(Math.max(...bytes.requests.map((read) => read.length))).toBeLessThanOrEqual(
      64 + 12 + 20 * 2,
    );
  });

  it('reads only the frames present of a data chunk declaring 4 GiB', async () => {
    const file = wav16();
    const bytes = memoryBytes(patched(file, chunkAt(file, 'data', true) + 4, 0xfffffff0, 4, true));
    const reader = expectSuccess(await openAudio(bytes));
    const into = [new Float32Array(1_000), new Float32Array(1_000)];
    const before = bytes.bytesRequested;
    expect(expectSuccess(await reader.read(0 as SampleCount, 1_000, into))).toBe(100);
    expect(bytes.bytesRequested - before).toBe(400);
  });
});

describe('a read asked for wrongly', () => {
  it('refuses buffers that do not match the channels or the frames', async () => {
    const reader = expectSuccess(await openAudio(memoryBytes(wav16())));
    const code = async (frames: number, into: Float32Array[]) =>
      expectFailureCode(await reader.read(0 as SampleCount, frames, into));
    expect(await code(4, [new Float32Array(4)])).toBe('codecs.read-invalid');
    expect(await code(4, [new Float32Array(4), new Float32Array(3)])).toBe('codecs.read-invalid');
    expect(await code(-1, [new Float32Array(4), new Float32Array(4)])).toBe('codecs.read-invalid');
    expect(await code(1.5, [new Float32Array(4), new Float32Array(4)])).toBe('codecs.read-invalid');
  });
});

describe('cancelling', () => {
  it('rejects with the signal’s reason when cancelled before opening', async () => {
    const controller = new AbortController();
    const reason = new Error('The person closed the import.');
    controller.abort(reason);
    await expect(openAudio(memoryBytes(wav16()), controller.signal)).rejects.toBe(reason);
    await expect(recogniseAudio(memoryBytes(wav16()), controller.signal)).rejects.toBe(reason);
  });

  it('rejects with the signal’s reason when cancelled during the header walk', async () => {
    const controller = new AbortController();
    const reason = new Error('Stopped.');
    const bytes = memoryBytes(
      wav16({ beforeFormat: [{ id: 'junk', body: new Uint8Array(100) }] }),
      {
        answer: (request, honest) => {
          if (request.offset > 64) controller.abort(reason);
          return honest;
        },
      },
    );
    await expect(openAudio(bytes, controller.signal)).rejects.toBe(reason);
  });

  it('rejects with the signal’s reason when cancelled during the last piece of a long read', async () => {
    const controller = new AbortController();
    const reason = new Error('Playback stopped.');
    const file = writeWav({
      sampleRate: 48_000,
      encoding: { kind: 'integer', bits: 16 },
      channels: stereo(400_000),
    });
    // The data is 1.6 MB, read in two pieces; cancelling during the second
    // leaves no later read to notice, so only the check after each read can
    // reject.
    let reads = 0;
    const bytes = memoryBytes(file, {
      answer: (request, honest) => {
        if (request.length > 1_000) reads += 1;
        if (reads === 2) controller.abort(reason);
        return honest;
      },
    });
    const reader = expectSuccess(await openAudio(bytes));
    const into = [new Float32Array(400_000), new Float32Array(400_000)];
    await expect(reader.read(0 as SampleCount, 400_000, into, controller.signal)).rejects.toBe(
      reason,
    );
    expect(reads).toBe(2);
  });

  it('rejects with the shared cancellation error where the signal’s reason is not one', async () => {
    const controller = new AbortController();
    controller.abort('no reason given');
    // The one the engine's feeder recognises as a cancellation, not a fault.
    await expect(openAudio(memoryBytes(wav16()), controller.signal)).rejects.toBeInstanceOf(
      Cancelled,
    );
  });
});

describe('a file that changes while it is read', () => {
  const shortened = (from: number) => (request: { offset: number }, honest: Uint8Array) =>
    request.offset >= from ? honest.subarray(0, honest.length - 1) : honest;

  it('fails a short read in the samples as a changed source, not a truncation', async () => {
    const file = wav16();
    const reader = expectSuccess(
      await openAudio(memoryBytes(file, { answer: shortened(chunkAt(file, 'data', true) + 8) })),
    );
    const into = [new Float32Array(100), new Float32Array(100)];
    const refusal = firstFailure(await reader.read(0 as SampleCount, 100, into));
    expect(refusal.code).toBe('codecs.source-changed');
    expect(refusal.kind).toBe('conflict');
  });

  it('fails a short read in the header as a changed source', async () => {
    const file = aiff16({ beforeSound: [{ id: 'pad ', body: new Uint8Array(80) }] });
    expect(expectFailureCode(await openAudio(memoryBytes(file, { answer: shortened(64) })))).toBe(
      'codecs.source-changed',
    );
    expect(expectFailureCode(await openAudio(memoryBytes(file, { answer: shortened(0) })))).toBe(
      'codecs.source-changed',
    );
  });
});

describe('damaged headers', () => {
  const bases: readonly Uint8Array[] = [
    wav16(),
    writeWav({
      sampleRate: 44_100,
      encoding: { kind: 'integer', bits: 24, bytes: 4 },
      channels: stereo(20),
      extensible: { channelMask: 0x3 },
    }),
    wav16({
      form: 'rf64',
      beforeData: [{ id: 'big1', body: new Uint8Array(3) }],
      sizesInDs64: ['big1'],
    }),
    aiff16({ channelLayout: channelLayoutBody({ tag: 0, labels: [1, 2] }) }),
    aiff16({ form: 'aifc', compressionType: 'sowt' }),
  ];

  it('answers every one of four hundred mutations with a result and never throws', async () => {
    const next = random(2026);
    const outcomes = { opened: 0, refused: 0 };
    for (let trial = 0; trial < 400; trial += 1) {
      const base = bases[trial % bases.length]!;
      const file = base.slice(0, next() < 0.1 ? Math.floor(next() * base.length) : base.length);
      const mutations = 1 + Math.floor(next() * 4);
      for (let count = 0; count < mutations; count += 1) {
        file[Math.floor(next() * Math.min(file.length, 120))] = Math.floor(next() * 256);
      }
      const result = await openAudio(memoryBytes(file));
      if (!result.ok) {
        outcomes.refused += 1;
        continue;
      }
      outcomes.opened += 1;
      const frames = Math.min(result.value.format.frames, 4_096);
      const into = Array.from(
        { length: result.value.format.channelCount },
        () => new Float32Array(frames),
      );
      expect((await result.value.read(0 as SampleCount, frames, into)).ok).toBe(true);
    }
    expect(outcomes.opened).toBeGreaterThan(50);
    expect(outcomes.refused).toBeGreaterThan(50);
  });
});
