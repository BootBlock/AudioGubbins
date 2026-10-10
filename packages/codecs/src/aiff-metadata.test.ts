/**
 * AIFF and AIFF-C metadata, both ways: every field and loop the form holds
 * written and read back, the parts it cannot hold reported, and the `MARK` and
 * `INST` chunks checked byte by byte against the AIFF specification's layout,
 * computed here by hand rather than by the reader.
 */

import type { SampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { readAiffMetadata } from './aiff-metadata.js';
import { aiffMetadataChunks } from './aiff-metadata-writing.js';
import type { MetadataMap } from './metadata-map.js';
import { memoryBytes, writeAiff, type FixtureChunk } from './testing/index.js';
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

/** Big-endian fields of the given byte widths. */
function fields(...values: readonly [number, 1 | 2 | 4][]): Uint8Array {
  const out = new Uint8Array(values.reduce((total, [, bytes]) => total + bytes, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [value, bytes] of values) {
    if (bytes === 1) view.setInt8(at, value);
    else if (bytes === 2) view.setInt16(at, value, false);
    else view.setUint32(at, value, false);
    at += bytes;
  }
  return out;
}

const asFixture = (chunks: readonly WrittenChunk[]): FixtureChunk[] =>
  chunks.map((chunk) => ({ id: chunk.id, body: chunk.body }));

/** A short AIFF or AIFF-C file holding the chunks, before or after its samples. */
function aiffWith(
  chunks: readonly FixtureChunk[],
  options: { form?: 'aiff' | 'aifc'; after?: boolean } = {},
): Uint8Array {
  return writeAiff({
    form: options.form ?? 'aiff',
    sampleSize: 16,
    sampleRate: 48_000,
    channels: [new Float64Array(8)],
    ...(options.after === true ? { afterSound: chunks } : { beforeSound: chunks }),
  });
}

const read = async (file: Uint8Array) => expectSuccess(await readAiffMetadata(memoryBytes(file)));

/** Every part AIFF holds. */
const FULL: MetadataMap = {
  text: {
    title: 'Night Rain – 夜雨',
    artist: 'Zoë Example',
    comment: 'Line one\nLine two\twith a tab',
    copyright: '© 2026 Example',
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
    { start: frames(400), length: frames(1), playCount: 'endless', direction: 'alternating' },
  ],
  tuning: { unityNote: 61, fineTuneCents: -12 },
};

describe('a round trip through AIFF', () => {
  it('reads back every field and loop it wrote, dropping nothing', async () => {
    const written = aiffMetadataChunks(FULL);
    expect(written.dropped).toEqual([]);
    expect(await read(aiffWith(asFixture(written.chunks)))).toEqual(FULL);
  });

  it('reads the same map from AIFF-C, and from chunks after the samples', async () => {
    const chunks = asFixture(aiffMetadataChunks(FULL).chunks);
    expect(await read(aiffWith(chunks, { form: 'aifc' }))).toEqual(FULL);
    expect(await read(aiffWith(chunks, { after: true }))).toEqual(FULL);
  });

  it('writes the same bytes from the same map, in one order', () => {
    const written = aiffMetadataChunks(FULL);
    expect(written).toEqual(aiffMetadataChunks(FULL));
    expect(written.chunks.map((chunk) => chunk.id)).toEqual([
      'NAME',
      'AUTH',
      '(c) ',
      'ANNO',
      'MARK',
      'INST',
    ]);
  });

  it('reads every tuning INST holds back unchanged', async () => {
    for (const tuning of [
      { unityNote: 0, fineTuneCents: -50 },
      { unityNote: 127, fineTuneCents: 50 },
      { unityNote: 60, fineTuneCents: 0 },
    ]) {
      const back = await read(aiffWith(asFixture(aiffMetadataChunks({ tuning }).chunks)));
      expect(back).toEqual({ tuning });
    }
  });

  it('states middle C untuned where the map has loops and no tuning', async () => {
    const map: MetadataMap = {
      loops: [{ start: frames(5), length: frames(5), playCount: 'endless', direction: 'forward' }],
    };
    const back = await read(aiffWith(asFixture(aiffMetadataChunks(map).chunks)));
    expect(back).toEqual({ ...map, tuning: { unityNote: 60, fineTuneCents: 0 } });
  });
});

describe('what AIFF cannot hold', () => {
  it('reports every part it drops, in one order, and writes the rest', async () => {
    const map: MetadataMap = {
      text: {
        title: 'Kept',
        album: 'a',
        albumArtist: 'b',
        trackNumber: '1',
        trackTotal: '2',
        discNumber: '1',
        discTotal: '1',
        date: '2026',
        genre: 'g',
        encoder: 'e',
        isrc: 'GBAYE0000001',
      },
      foreign: [{ scheme: 'riff-info', key: 'IENG', value: 'x' }],
      broadcast: {
        description: '',
        originator: '',
        originatorReference: '',
        originationDate: '',
        originationTime: '',
        timeReference: frames(0),
        codingHistory: '',
      },
      coverArt: { mediaType: 'image/jpeg', description: '', bytes: Uint8Array.of(1) },
    };
    const written = aiffMetadataChunks(map);
    expect(written.dropped).toEqual([
      { kind: 'text', key: 'album' },
      { kind: 'text', key: 'albumArtist' },
      { kind: 'text', key: 'trackNumber' },
      { kind: 'text', key: 'trackTotal' },
      { kind: 'text', key: 'discNumber' },
      { kind: 'text', key: 'discTotal' },
      { kind: 'text', key: 'date' },
      { kind: 'text', key: 'genre' },
      { kind: 'text', key: 'encoder' },
      { kind: 'text', key: 'isrc' },
      { kind: 'foreign', scheme: 'riff-info', key: 'IENG' },
      { kind: 'broadcast' },
      { kind: 'coverArt' },
    ]);
    expect(await read(aiffWith(asFixture(written.chunks)))).toEqual({ text: { title: 'Kept' } });
  });

  it('drops loops INST cannot state, whole, and keeps the cue points', () => {
    const loop = {
      start: frames(0),
      length: frames(10),
      playCount: 'endless',
      direction: 'forward',
    } as const;
    for (const loops of [
      [loop, loop, loop],
      [{ ...loop, direction: 'backward' as const }],
      [{ ...loop, playCount: 4 }],
      [{ ...loop, length: frames(0) }],
      [{ ...loop, start: frames(2 ** 32 - 5) }],
      [{ ...loop, name: 'é'.repeat(128) }],
    ]) {
      const written = aiffMetadataChunks({ loops, cues: [{ position: frames(3), name: 'c' }] });
      expect(written.dropped).toEqual([{ kind: 'loops' }]);
      expect(written.chunks.map((chunk) => chunk.id)).toEqual(['MARK']);
    }
  });

  it('drops cue points past 32 bits or with names a marker cannot hold, and inexact tunings', () => {
    expect(aiffMetadataChunks({ cues: [{ position: frames(2 ** 32), name: '' }] }).dropped).toEqual(
      [{ kind: 'cues' }],
    );
    expect(
      aiffMetadataChunks({ cues: [{ position: frames(0), name: 'a'.repeat(256) }] }).dropped,
    ).toEqual([{ kind: 'cues' }]);
    for (const tuning of [
      { unityNote: 60, fineTuneCents: 12.5 },
      { unityNote: -1, fineTuneCents: 0 },
      { unityNote: 60, fineTuneCents: -51 },
    ]) {
      expect(aiffMetadataChunks({ tuning })).toEqual({ chunks: [], dropped: [{ kind: 'tuning' }] });
    }
  });
});

/** The body of the written chunk with this id. */
function bodyOf(chunks: readonly WrittenChunk[], id: string): Uint8Array {
  const found = chunks.find((chunk) => chunk.id === id);
  if (found === undefined) throw new Error(`No '${id}' chunk was written.`);
  return found.body;
}

describe('the bytes written, against the AIFF specification', () => {
  const map: MetadataMap = {
    text: { title: 'Rain' },
    cues: [{ position: frames(1_234), name: 'Cue' }],
    loops: [
      {
        start: frames(100),
        length: frames(200),
        playCount: 'endless',
        direction: 'forward',
        name: 'L',
      },
      { start: frames(7), length: frames(3), playCount: 'endless', direction: 'alternating' },
    ],
    tuning: { unityNote: 61, fineTuneCents: -12 },
  };
  const { chunks } = aiffMetadataChunks(map);

  it('writes text with no terminator, the size being its length', () => {
    expect(bodyOf(chunks, 'NAME')).toEqual(ascii('Rain'));
  });

  it('writes MARK markers with ids from 1 and names padded to even lengths', () => {
    expect(bodyOf(chunks, 'MARK')).toEqual(
      join(
        fields([5, 2]),
        // "Cue": a count byte and three characters, already even.
        fields([1, 2], [1_234, 4], [3, 1]),
        ascii('Cue'),
        // "L": a count byte and one character, already even.
        fields([2, 2], [100, 4], [1, 1]),
        ascii('L'),
        // An empty name: a count byte, padded to two.
        fields([3, 2], [300, 4], [0, 1], [0, 1]),
        fields([4, 2], [7, 4], [0, 1], [0, 1]),
        fields([5, 2], [10, 4], [0, 1], [0, 1]),
      ),
    );
  });

  it('writes INST with the tuning, every note and velocity, and loops by their markers', () => {
    expect(bodyOf(chunks, 'INST')).toEqual(
      join(
        fields([61, 1], [-12, 1], [0, 1], [127, 1], [1, 1], [127, 1], [0, 2]),
        fields([1, 2], [2, 2], [3, 2]),
        fields([2, 2], [4, 2], [5, 2]),
      ),
    );
  });
});

describe('chunks other writers leave', () => {
  const instrument = (sustain: readonly number[], release: readonly number[] = [0, 0, 0]) =>
    join(
      fields([60, 1], [0, 1], [0, 1], [127, 1], [1, 1], [127, 1], [0, 2]),
      fields(...sustain.map((value): [number, 2] => [value, 2])),
      fields(...release.map((value): [number, 2] => [value, 2])),
    );
  const marker = (id: number, position: number, name: string) =>
    join(
      fields([id, 2], [position, 4], [name.length, 1]),
      ascii(name),
      new Uint8Array((name.length + 1) % 2),
    );
  const markers = (...entries: Uint8Array[]) => join(fields([entries.length, 2]), ...entries);

  it('joins several ANNO chunks by line feeds, keeping the first NAME', async () => {
    const back = await read(
      aiffWith([
        { id: 'ANNO', body: ascii('first') },
        { id: 'NAME', body: ascii('Title') },
        { id: 'NAME', body: ascii('Ignored') },
        { id: 'ANNO', body: ascii('second') },
      ]),
    );
    expect(back.text).toEqual({ title: 'Title', comment: 'first\nsecond' });
  });

  it('reads Latin-1 where a pstring is not UTF-8, and strips control characters', async () => {
    const back = await read(
      aiffWith([
        {
          id: 'MARK',
          body: markers(
            join(fields([9, 2], [5, 4], [5, 1]), Uint8Array.of(0x43, 0x61, 0x66, 0xe9, 0x07)),
          ),
        },
      ]),
    );
    expect(back.cues).toEqual([{ position: 5, name: 'Café' }]);
  });

  it('leaves out a loop whose end is not after its start, and a loop that does not play', async () => {
    const back = await read(
      aiffWith([
        { id: 'MARK', body: markers(marker(1, 50, 'a'), marker(2, 50, 'b'), marker(3, 9, 'c')) },
        { id: 'INST', body: instrument([1, 1, 2], [0, 7, 8]) },
      ]),
    );
    // Markers 1 and 2 bound a loop that plays, even if not at all, so they are not cue points.
    expect(back).toEqual({
      cues: [{ position: 9, name: 'c' }],
      tuning: { unityNote: 60, fineTuneCents: 0 },
    });
  });

  it('reads an INST loop between markers in any order, named by its begin marker', async () => {
    const back = await read(
      aiffWith([
        { id: 'INST', body: instrument([2, 4, 3]) },
        { id: 'MARK', body: markers(marker(3, 90, 'end'), marker(4, 10, 'Begin')) },
      ]),
    );
    expect(back.loops).toEqual([
      { start: 10, length: 80, playCount: 'endless', direction: 'alternating', name: 'Begin' },
    ]);
    expect(back.cues).toBeUndefined();
  });
});
