/**
 * Recognition of every stream format by its contents, and the route the
 * registry gives each recognised file: read in place, decode, or refuse.
 */

import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { importRoute } from './import-route.js';
import { recogniseAudio } from './recognition.js';
import { memoryBytes, writeCompressedWav, writeWav } from './testing/index.js';

const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));

/** A file of `head` followed by zeros, as long as `length`. */
function file(head: readonly number[], length = 1_024): Uint8Array {
  const bytes = new Uint8Array(Math.max(length, head.length));
  bytes.set(head);
  return bytes;
}

/** An Ogg stream's first page, its segment table `segments` long, carrying `packet`. */
function oggPage(packet: readonly number[], segments = 1): number[] {
  const table = Array.from({ length: segments }, (_, at) =>
    at === segments - 1 ? packet.length : 255,
  );
  const filler = new Array<number>((segments - 1) * 255).fill(0);
  return [
    ...ascii('OggS'),
    0,
    0x02,
    ...new Array<number>(8).fill(0),
    1,
    0,
    0,
    0,
    ...new Array<number>(8).fill(0),
    segments,
    ...table,
    ...packet,
    ...filler,
  ];
}

/** An EBML header with these children, each a two-byte id and a one-byte size. */
function ebml(docType: string): number[] {
  const children = [
    ...[0x42, 0x86, 0x81, 0x01],
    ...[0x42, 0xf7, 0x81, 0x01],
    ...[0x42, 0xf2, 0x81, 0x04],
    ...[0x42, 0xf3, 0x81, 0x08],
    ...[0x42, 0x82, 0x80 | docType.length, ...ascii(docType)],
    ...[0x42, 0x87, 0x81, 0x04],
  ];
  return [0x1a, 0x45, 0xdf, 0xa3, 0x80 | children.length, ...children];
}

/** An ID3v2.4 tag of `size` bytes after its header, then `after`. */
function id3(size: number, after: readonly number[]): number[] {
  const synchsafe = [21, 14, 7, 0].map((shift) => (size >> shift) & 0x7f);
  return [...ascii('ID3'), 4, 0, 0, ...synchsafe, ...new Array<number>(size).fill(0x20), ...after];
}

const MP3_FRAME = [0xff, 0xfb, 0x90, 0x64];
const named = (container: string, codec: string) => ({
  kind: 'audio',
  container,
  codec: { kind: 'named', codec },
});
const unstated = (container: string) => ({ kind: 'audio', container, codec: { kind: 'unstated' } });
const unnamed = (container: string, description: string) => ({
  kind: 'audio',
  container,
  codec: { kind: 'unnamed', description },
});

describe('recognising a stream format', () => {
  const cases: readonly [string, Uint8Array, object][] = [
    ['FLAC', file(ascii('fLaC')), named('flac', 'flac')],
    ['FLAC behind an ID3 tag', file(id3(300, ascii('fLaC'))), named('flac', 'flac')],
    ['MP3 from its first frame', file(MP3_FRAME), named('mp3', 'mp3')],
    ['MP3 behind an ID3 tag', file(id3(2_000, MP3_FRAME), 4_096), named('mp3', 'mp3')],
    [
      'MP3 behind two ID3 tags and padding',
      file(id3(10, id3(20, [0, 0, 0, 0, 0, ...MP3_FRAME]))),
      named('mp3', 'mp3'),
    ],
    ['MPEG Layer II', file([0xff, 0xfd, 0x90, 0x64]), unnamed('mp3', 'MPEG Layer II')],
    ['ADTS AAC-LC', file([0xff, 0xf1, 0x50, 0x80, 0x2e, 0x7f, 0xfc]), named('adts', 'aac-lc')],
    [
      'ADTS AAC-LC behind an ID3 tag',
      file(id3(40, [0xff, 0xf9, 0x4c, 0x80])),
      named('adts', 'aac-lc'),
    ],
    ['ADTS AAC Main', file([0xff, 0xf1, 0x10, 0x80]), unnamed('adts', 'AAC Main')],
    ['Ogg Vorbis', file(oggPage([0x01, ...ascii('vorbis'), 0, 0, 0, 0])), named('ogg', 'vorbis')],
    ['Ogg Opus', file(oggPage(ascii('OpusHead'))), named('ogg', 'opus')],
    ['Ogg FLAC', file(oggPage([0x7f, ...ascii('FLAC'), 1, 0])), named('ogg', 'flac')],
    [
      'Ogg Opus after a full segment table',
      file(oggPage(ascii('OpusHead'), 255), 70_000),
      named('ogg', 'opus'),
    ],
    ['Ogg Speex', file(oggPage(ascii('Speex   '))), unnamed('ogg', 'Speex')],
    ['WebM', file(ebml('webm')), unstated('webm')],
    ['Matroska', file(ebml('matroska')), unstated('matroska')],
    ['an EBML document of another type', file(ebml('pdfx')), { kind: 'unknown' }],
    ['M4A', file([0, 0, 0, 0x20, ...ascii('ftypM4A ')]), unstated('mp4')],
    ['an ID3 tag over nothing it names', file(id3(30, [])), unstated('mp3')],
  ];

  it.each(cases)('names %s by its contents', async (_, bytes, format) => {
    expect(expectSuccess(await recogniseAudio(memoryBytes(bytes)))).toEqual(format);
  });

  it('reads a bounded window after a tag, never the tag itself', async () => {
    const bytes = memoryBytes(file(id3(1_000_000, MP3_FRAME)));
    expect(expectSuccess(await recogniseAudio(bytes))).toEqual(named('mp3', 'mp3'));
    expect(bytes.bytesRequested).toBeLessThanOrEqual(64 + 2 * 4_096);
  });
});

describe('the import route', () => {
  const route = async (bytes: Uint8Array) =>
    importRoute(expectSuccess(await recogniseAudio(memoryBytes(bytes))));

  it('reads uncompressed PCM, G.711 and ADPCM in place', async () => {
    expect(
      await route(
        writeWav({
          sampleRate: 48_000,
          encoding: { kind: 'integer', bits: 16 },
          channels: [new Float64Array(4)],
        }),
      ),
    ).toEqual({ kind: 'read-in-place', container: 'wav', codec: 'pcm' });
    expect(
      await route(
        writeCompressedWav({
          form: 'rf64',
          sampleRate: 8_000,
          channelCount: 1,
          coding: { kind: 'g711-ulaw' },
          data: new Uint8Array(8),
        }),
      ),
    ).toEqual({ kind: 'read-in-place', container: 'rf64', codec: 'g711-ulaw' });
  });

  it('decodes a format another implementation reads, naming the codec where the file states it', async () => {
    expect(await route(file(oggPage(ascii('OpusHead'))))).toEqual({
      kind: 'decode',
      container: 'ogg',
      codec: 'opus',
    });
    expect(await route(file([0, 0, 0, 0x20, ...ascii('ftypM4A ')]))).toEqual({
      kind: 'decode',
      container: 'mp4',
      codec: undefined,
    });
    expect(await route(file(ebml('webm')))).toEqual({
      kind: 'decode',
      container: 'webm',
      codec: undefined,
    });
    expect(
      await route(
        writeWav({
          sampleRate: 44_100,
          encoding: { kind: 'integer', bits: 16 },
          channels: [new Float64Array(4)],
          formatTag: 0x0055,
        }),
      ),
    ).toEqual({ kind: 'decode', container: 'wav', codec: 'mp3' });
  });

  it('refuses what no implementation serves, with the sentence that names it', async () => {
    const cases: readonly [Uint8Array, string][] = [
      [file(oggPage(ascii('Speex   '))), 'This file is Ogg audio compressed as Speex.'],
      [file([0xff, 0xfd, 0x90, 0x64]), 'This file is MPEG audio compressed as MPEG Layer II.'],
      [
        writeWav({
          form: 'rf64',
          sampleRate: 44_100,
          encoding: { kind: 'integer', bits: 16 },
          channels: [new Float64Array(4)],
          formatTag: 0x0055,
        }),
        'This file is RF64 audio encoded as MP3.',
      ],
      [
        file(ascii('Just some words.')),
        'This file is not in an audio format AudioGubbins recognises.',
      ],
    ];
    for (const [bytes, sentence] of cases) {
      const answer = await route(bytes);
      expect(answer.kind).toBe('refuse');
      if (answer.kind !== 'refuse') continue;
      expect(answer.failure.code).toBe('codecs.unsupported-format');
      expect(answer.failure.summary).toContain(sentence);
      expect(answer.failure.summary).toContain('and decodes FLAC, Apple Lossless (ALAC), Opus');
    }
  });
});
