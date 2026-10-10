/**
 * WAV, RF64 and BW64 metadata, both ways: every field and loop the form holds
 * written and read back, the parts it cannot hold reported, untrusted text
 * decoded by the one rule, and the written chunks checked byte by byte against
 * the layouts EBU Tech 3285 and the RIFF specification give, computed here by
 * hand rather than by the reader.
 */

import type { SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import type { MetadataMap } from './metadata-map.js';
import { DOCUMENT_TEXT, LINE_TEXT, LONG_TEXT, decodeText, encodeText } from './metadata-text.js';
import { readRiffMetadata } from './riff-metadata.js';
import { riffMetadataChunks } from './riff-metadata-writing.js';
import { memoryBytes, writeWav, type FixtureChunk } from './testing/index.js';
import type { WrittenChunk } from './written-chunk.js';

const frames = (value: number) => value as SampleCount;

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

/** Joins byte arrays in order. */
function join(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Little-endian 32-bit words. */
function words(...values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    view.setUint32(index * 4, value, true);
  });
  return out;
}

/** A list entry, padded to an even length. */
function entry(id: string, body: Uint8Array): Uint8Array {
  return join(ascii(id), words(body.length), body, new Uint8Array(body.length % 2));
}

const asFixture = (chunks: readonly WrittenChunk[]): FixtureChunk[] =>
  chunks.map((chunk) => ({ id: chunk.id, body: chunk.body }));

/** A short WAV, RF64 or BW64 file holding the chunks, before or after its data. */
function wavWith(
  chunks: readonly FixtureChunk[],
  options: { form?: 'wav' | 'rf64' | 'bw64'; after?: boolean; sizesInDs64?: string[] } = {},
): Uint8Array {
  return writeWav({
    form: options.form ?? 'wav',
    sampleRate: 48_000,
    encoding: { kind: 'integer', bits: 16 },
    channels: [new Float64Array(8), new Float64Array(8)],
    ...(options.after === true ? { afterData: chunks } : { beforeData: chunks }),
    ...(options.sizesInDs64 === undefined ? {} : { sizesInDs64: options.sizesInDs64 }),
  });
}

const read = async (file: Uint8Array) => expectSuccess(await readRiffMetadata(memoryBytes(file)));

/** Every part a WAV holds, with text past ASCII, a position past 32 bits' half and every loop direction. */
const FULL: MetadataMap = {
  text: {
    title: 'Night Rain – 夜雨',
    artist: 'Zoë Example',
    album: 'Field Recordings',
    trackNumber: '3',
    date: '2026-10-10',
    genre: 'Ambient',
    comment: 'Line one\nLine two\twith a tab',
    copyright: '© 2026 Example',
    encoder: 'AudioGubbins',
  },
  foreign: [
    { scheme: 'riff-info', key: 'IENG', value: 'An Engineer' },
    { scheme: 'riff-info', key: 'ISBJ', value: 'Rain 🌧 on tin' },
  ],
  broadcast: {
    description: 'Rain on a tin roof',
    originator: 'AudioGubbins',
    originatorReference: 'AG-0001',
    originationDate: '2026-10-10',
    originationTime: '12:34:56',
    timeReference: frames(5_000_000_000),
    codingHistory: 'A=PCM,F=48000,W=24,M=stereo\r\n',
  },
  cues: [
    { position: frames(0), name: 'Start' },
    { position: frames(1_000), name: '' },
    { position: frames(0xffff_ffff), name: 'Last' },
  ],
  loops: [
    {
      start: frames(100),
      length: frames(200),
      playCount: 'endless',
      direction: 'forward',
      name: 'Sustain',
    },
    { start: frames(300), length: frames(1), playCount: 3, direction: 'alternating' },
    { start: frames(0), length: frames(50), playCount: 0xffff_ffff, direction: 'backward' },
  ],
  tuning: { unityNote: 61, fineTuneCents: -12 },
};

describe('a round trip through WAV', () => {
  it('reads back every field and loop it wrote, dropping nothing', async () => {
    const written = riffMetadataChunks(FULL, 48_000);
    expect(written.dropped).toEqual([]);
    expect(await read(wavWith(asFixture(written.chunks)))).toEqual(FULL);
  });

  it('reads the same map from chunks after the data, and from RF64 and BW64', async () => {
    const chunks = asFixture(riffMetadataChunks(FULL, 48_000).chunks);
    expect(await read(wavWith(chunks, { after: true }))).toEqual(FULL);
    expect(await read(wavWith(chunks, { form: 'rf64' }))).toEqual(FULL);
    expect(await read(wavWith(chunks, { form: 'bw64', after: true }))).toEqual(FULL);
    // A size kept in the ds64 table means the same to the metadata reader as to the audio reader.
    expect(await read(wavWith(chunks, { form: 'rf64', sizesInDs64: ['smpl'] }))).toEqual(FULL);
  });

  it('writes the same bytes from the same map', () => {
    expect(riffMetadataChunks(FULL, 48_000)).toEqual(riffMetadataChunks(FULL, 48_000));
  });

  it('reads an empty map from a file with no metadata, and writes no chunk for one', async () => {
    expect(await read(wavWith([]))).toEqual({});
    expect(riffMetadataChunks({}, 48_000)).toEqual({ chunks: [], dropped: [] });
  });

  it('states middle C untuned where the map has loops and no tuning', async () => {
    const map: MetadataMap = {
      loops: [{ start: frames(1), length: frames(2), playCount: 'endless', direction: 'forward' }],
    };
    const back = await read(wavWith(asFixture(riffMetadataChunks(map, 44_100).chunks)));
    expect(back).toEqual({ ...map, tuning: { unityNote: 60, fineTuneCents: 0 } });
  });

  it('reads a flat half semitone back as the same pitch, sharp on the note below', async () => {
    const half = { tuning: { unityNote: 60, fineTuneCents: -50 } };
    const back = await read(wavWith(asFixture(riffMetadataChunks(half, 48_000).chunks)));
    expect(back.tuning).toEqual({ unityNote: 59, fineTuneCents: 50 });
    for (const cents of [-49, -1, 0, 1, 49, 50]) {
      const map = { tuning: { unityNote: 64, fineTuneCents: cents } };
      const again = await read(wavWith(asFixture(riffMetadataChunks(map, 48_000).chunks)));
      expect(again.tuning).toEqual(map.tuning);
    }
  });
});

describe('what WAV cannot hold', () => {
  it('reports every part it drops, in one order, and writes the rest', async () => {
    const map: MetadataMap = {
      text: {
        title: 'Kept',
        albumArtist: 'A',
        trackTotal: '12',
        discNumber: '1',
        discTotal: '2',
        isrc: 'GBAYE0000001',
      },
      foreign: [
        { scheme: 'id3v2', key: 'TXXX:MOOD', value: 'calm' },
        { scheme: 'riff', key: 'iXML', value: '<BWFXML/>' },
        { scheme: 'riff-info', key: 'IENG', value: 'Kept too' },
        { scheme: 'riff-info', key: 'BAD', value: 'not a four-character id' },
        { scheme: 'riff-info', key: 'LIST', value: 'a list id' },
      ],
      coverArt: { mediaType: 'image/png', description: '', bytes: Uint8Array.of(1, 2) },
    };
    const written = riffMetadataChunks(map, 48_000);
    expect(written.dropped).toEqual([
      { kind: 'text', key: 'albumArtist' },
      { kind: 'text', key: 'trackTotal' },
      { kind: 'text', key: 'discNumber' },
      { kind: 'text', key: 'discTotal' },
      { kind: 'text', key: 'isrc' },
      { kind: 'foreign', scheme: 'id3v2', key: 'TXXX:MOOD' },
      { kind: 'foreign', scheme: 'riff', key: 'iXML' },
      { kind: 'foreign', scheme: 'riff-info', key: 'BAD' },
      { kind: 'foreign', scheme: 'riff-info', key: 'LIST' },
      { kind: 'coverArt' },
    ]);
    expect(await read(wavWith(asFixture(written.chunks)))).toEqual({
      text: { title: 'Kept' },
      foreign: [{ scheme: 'riff-info', key: 'IENG', value: 'Kept too' }],
    });
  });

  it('drops a broadcast description that is not ASCII or does not fit its fields, whole', () => {
    const broadcast = FULL.broadcast!;
    const cases = [
      { ...broadcast, description: 'é' },
      { ...broadcast, originator: 'x'.repeat(33) },
      { ...broadcast, originationDate: '2026-10-10T' },
      { ...broadcast, codingHistory: 'A=PCM\u0007' },
    ];
    for (const description of cases) {
      const written = riffMetadataChunks({ broadcast: description }, 48_000);
      expect(written).toEqual({ chunks: [], dropped: [{ kind: 'broadcast' }] });
    }
    expect(
      riffMetadataChunks({ broadcast: { ...broadcast, originator: 'x'.repeat(32) } }, 48_000)
        .dropped,
    ).toEqual([]);
  });

  it('drops text a reader would not give back unchanged', () => {
    const cases: MetadataMap[] = [
      { text: { title: 'two\nlines' } },
      { text: { title: 'nul\u0000inside' } },
      { text: { title: 'x'.repeat(LINE_TEXT.maximumCharacters + 1) } },
      { text: { title: 'lone \ud800 surrogate' } },
    ];
    for (const map of cases) {
      expect(riffMetadataChunks(map, 48_000).dropped).toEqual([{ kind: 'text', key: 'title' }]);
    }
  });

  it('drops cue points and loops past 32 bits, and loops it cannot state', () => {
    const past = frames(2 ** 32);
    const loop = {
      start: frames(0),
      length: frames(10),
      playCount: 'endless',
      direction: 'forward',
    } as const;
    expect(riffMetadataChunks({ cues: [{ position: past, name: '' }] }, 48_000).dropped).toEqual([
      { kind: 'cues' },
    ]);
    for (const loops of [
      [{ ...loop, start: frames(2 ** 32 - 5) }],
      [{ ...loop, length: frames(0) }],
      [{ ...loop, playCount: 0 }],
      [{ ...loop, playCount: 2 ** 32 }],
      [{ ...loop, playCount: 1.5 }],
      Array.from({ length: 1_025 }, () => loop),
    ]) {
      expect(riffMetadataChunks({ loops }, 48_000).dropped).toEqual([{ kind: 'loops' }]);
    }
    const last = { ...loop, start: frames(2 ** 32 - 10) };
    expect(riffMetadataChunks({ loops: [last] }, 48_000).dropped).toEqual([]);
  });

  it('drops a tuning that is not a MIDI note and whole cents within half a semitone', () => {
    for (const tuning of [
      { unityNote: 128, fineTuneCents: 0 },
      { unityNote: 60, fineTuneCents: 51 },
      { unityNote: 60, fineTuneCents: 10.5 },
      { unityNote: 0, fineTuneCents: -1 },
    ]) {
      expect(riffMetadataChunks({ tuning }, 48_000).dropped).toEqual([{ kind: 'tuning' }]);
    }
  });
});

/** The body of the first written chunk with this id, and of the `LIST` of this type. */
function bodyOf(chunks: readonly WrittenChunk[], id: string, type?: string): Uint8Array {
  const found = chunks.find(
    (chunk) =>
      chunk.id === id &&
      (type === undefined || String.fromCharCode(...chunk.body.subarray(0, 4)) === type),
  );
  if (found === undefined) throw new Error(`No '${id}' chunk was written.`);
  return found.body;
}

describe('the bytes written, against the specifications', () => {
  const map: MetadataMap = {
    text: { title: 'Rain' },
    broadcast: { ...FULL.broadcast!, codingHistory: 'A=PCM\r\n' },
    cues: [{ position: frames(1_234), name: 'A' }],
    loops: [
      { start: frames(100), length: frames(200), playCount: 'endless', direction: 'forward' },
    ],
    tuning: { unityNote: 61, fineTuneCents: -12 },
  };
  const { chunks } = riffMetadataChunks(map, 48_000);

  it('writes the chunks in one order', () => {
    expect(chunks.map((chunk) => chunk.id)).toEqual(['bext', 'LIST', 'cue ', 'LIST', 'smpl']);
  });

  it('writes INFO text as a NUL-terminated entry padded to an even length', () => {
    expect(bodyOf(chunks, 'LIST', 'INFO')).toEqual(
      join(ascii('INFO'), ascii('INAM'), words(5), ascii('Rain'), Uint8Array.of(0, 0)),
    );
  });

  it('writes bext version 1 with each field at its offset', () => {
    const body = bodyOf(chunks, 'bext');
    const view = new DataView(body.buffer, body.byteOffset);
    expect(body.length).toBe(602 + 7);
    expect(String.fromCharCode(...body.subarray(0, 18))).toBe('Rain on a tin roof');
    expect(body[18]).toBe(0);
    expect(String.fromCharCode(...body.subarray(256, 268))).toBe('AudioGubbins');
    expect(String.fromCharCode(...body.subarray(288, 295))).toBe('AG-0001');
    expect(String.fromCharCode(...body.subarray(320, 338))).toBe('2026-10-1012:34:56');
    // 5 000 000 000 is 1 * 2^32 + 705 032 704.
    expect(view.getUint32(338, true)).toBe(705_032_704);
    expect(view.getUint32(342, true)).toBe(1);
    expect(view.getUint16(346, true)).toBe(1);
    expect(body.subarray(348, 602).every((byte) => byte === 0)).toBe(true);
    expect(String.fromCharCode(...body.subarray(602))).toBe('A=PCM\r\n');
  });

  it('writes a cue point with its frame as both position and sample offset in the data chunk', () => {
    expect(bodyOf(chunks, 'cue ')).toEqual(
      join(words(1, 1, 1_234), ascii('data'), words(0, 0, 1_234)),
    );
  });

  it('labels a cue point by its id in an adtl list', () => {
    expect(bodyOf(chunks, 'LIST', 'adtl')).toEqual(
      join(ascii('adtl'), ascii('labl'), words(6, 1), ascii('A'), Uint8Array.of(0)),
    );
  });

  it('writes smpl with its period, a raised pitch fraction and an inclusive loop end', () => {
    const body = bodyOf(chunks, 'smpl');
    // 61 less 12 cents is 60 and 88 cents: round(0.88 * 2^32).
    expect(body).toEqual(
      join(words(0, 0, 20_833, 60, 3_779_571_220, 0, 0, 1, 0), words(2, 0, 100, 299, 0, 0)),
    );
  });

  it('writes loop types 1 and 2 for alternating and backward, and a finite play count', () => {
    const loops = [
      { start: frames(0), length: frames(4), playCount: 7, direction: 'alternating' },
      { start: frames(0), length: frames(4), playCount: 1, direction: 'backward' },
    ] as const;
    const body = bodyOf(riffMetadataChunks({ loops }, 44_100).chunks, 'smpl');
    const view = new DataView(body.buffer, body.byteOffset);
    expect(view.getUint32(8, true)).toBe(22_676);
    expect([view.getUint32(40, true), view.getUint32(56, true)]).toEqual([1, 7]);
    expect([view.getUint32(64, true), view.getUint32(80, true)]).toEqual([2, 1]);
  });
});

describe('chunks other writers leave', () => {
  it('reads Latin-1 where the bytes are not UTF-8, and UTF-8 where they are', async () => {
    const info = join(
      ascii('INFO'),
      entry('INAM', Uint8Array.of(0x43, 0x61, 0x66, 0xe9, 0)),
      entry('IART', Uint8Array.of(0x43, 0x61, 0x66, 0xc3, 0xa9, 0)),
    );
    expect((await read(wavWith([{ id: 'LIST', body: info }]))).text).toEqual({
      title: 'Café',
      artist: 'Café',
    });
  });

  it('stops at the first NUL and strips control characters, keeping a comment’s lines', async () => {
    const info = join(
      ascii('INFO'),
      entry(
        'INAM',
        join(ascii('Red\u001b[31m\u0085\u007f\nTitle'), Uint8Array.of(0), ascii('junk')),
      ),
      entry('ICMT', join(ascii('one\r\ntwo\tthree\u0007'), Uint8Array.of(0))),
    );
    expect((await read(wavWith([{ id: 'LIST', body: info }]))).text).toEqual({
      title: 'Red[31mTitle',
      comment: 'one\r\ntwo\tthree',
    });
  });

  it('keeps a repeated id, an id with no key and an iXML chunk by their own keys', async () => {
    const info = join(
      ascii('INFO'),
      entry('INAM', ascii('First\0')),
      entry('INAM', ascii('Second\0')),
      entry('IKEY', ascii('rain; roof\0')),
      entry('\0\0\0\0', new Uint8Array(0)),
    );
    const back = await read(
      wavWith([
        { id: 'LIST', body: info },
        { id: 'iXML', body: ascii('<BWFXML>\n\t<NOTE>x</NOTE>\n</BWFXML>') },
        { id: 'iXML', body: ascii('<second/>') },
      ]),
    );
    expect(back).toEqual({
      text: { title: 'First' },
      foreign: [
        { scheme: 'riff-info', key: 'INAM', value: 'Second' },
        { scheme: 'riff-info', key: 'IKEY', value: 'rain; roof' },
        { scheme: 'riff', key: 'iXML', value: '<BWFXML>\n\t<NOTE>x</NOTE>\n</BWFXML>' },
      ],
    });
  });

  it('skips an iXML chunk past its bound without reading it', async () => {
    const file = wavWith([{ id: 'iXML', body: new Uint8Array(262_145).fill(0x41) }]);
    const bytes = memoryBytes(file);
    expect(expectSuccess(await readRiffMetadata(bytes))).toEqual({});
    expect(bytes.bytesRequested).toBeLessThan(1_024);
  });

  it('names a loop by the label of its id, and leaves out a manufacturer’s loop type', async () => {
    const smpl = join(
      words(0, 0, 20_833, 60, 0x8000_0000, 0, 0, 2, 0),
      words(7, 0, 10, 19, 0, 0),
      words(8, 32, 10, 19, 0, 0),
    );
    const labels = join(ascii('adtl'), entry('labl', join(words(7), ascii('Hold\0'))));
    expect(
      await read(
        wavWith([
          { id: 'smpl', body: smpl },
          { id: 'LIST', body: labels },
        ]),
      ),
    ).toEqual({
      loops: [{ start: 10, length: 10, playCount: 'endless', direction: 'forward', name: 'Hold' }],
      tuning: { unityNote: 60, fineTuneCents: 50 },
    });
  });

  it('reads a pitch fraction past half a semitone as the next note, flat', async () => {
    const smpl = (note: number, fraction: number) =>
      wavWith([{ id: 'smpl', body: words(0, 0, 0, note, fraction, 0, 0, 0, 0) }]);
    // 0x82000000 is 50.78 cents, 51 whole cents above 60: 49 below 61.
    expect((await read(smpl(60, 0x8200_0000))).tuning).toEqual({
      unityNote: 61,
      fineTuneCents: -49,
    });
    expect((await read(smpl(60, 0xffff_ffff))).tuning).toEqual({
      unityNote: 61,
      fineTuneCents: 0,
    });
  });

  it('takes a cue point’s frame from its sample offset, not its playlist position', async () => {
    const cue = join(words(1, 3, 999), ascii('data'), words(0, 0, 42));
    expect((await read(wavWith([{ id: 'cue ', body: cue }]))).cues).toEqual([
      { position: 42, name: '' },
    ]);
  });
});

describe('the text rule', () => {
  it('decodes UTF-8 only where every byte is valid, else every byte as Latin-1', () => {
    expect(decodeText(encodeText('Zoë 🌧'), LINE_TEXT)).toBe('Zoë 🌧');
    // An overlong slash, an encoded surrogate and a truncated sequence are not UTF-8.
    expect(decodeText(Uint8Array.of(0x41, 0xc0, 0xaf), LINE_TEXT)).toBe('AÀ¯');
    // As Latin-1, 0xA0 is a no-break space, kept, and 0x80 a C1 control, removed.
    expect(decodeText(Uint8Array.of(0xed, 0xa0, 0x80), LINE_TEXT)).toBe('í ');
    expect(decodeText(Uint8Array.of(0x41, 0xe2, 0x82), LINE_TEXT)).toBe('Aâ');
  });

  it('bounds text in characters, never splitting one', () => {
    const long = '🌧'.repeat(LINE_TEXT.maximumCharacters + 10);
    expect(decodeText(encodeText(long), LINE_TEXT)).toBe('🌧'.repeat(LINE_TEXT.maximumCharacters));
    expect(decodeText(encodeText('a'.repeat(300_000)), DOCUMENT_TEXT)).toHaveLength(262_144);
    expect(decodeText(encodeText('a\nb'), LONG_TEXT)).toBe('a\nb');
  });
});
