/**
 * Hostile metadata, refused within its bounds (ADR-0093, REQ-EXEC-136): counts
 * past their chunks and past their bounds, lists nested or oversized, loops
 * that end before they start, text longer than any field, cancellation, and a
 * fuzz of damaged metadata that must only ever be answered, never thrown.
 */

import type { DomainResult, SampleCount } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { readAiffMetadata } from './aiff-metadata.js';
import { aiffMetadataChunks } from './aiff-metadata-writing.js';
import type { MetadataMap } from './metadata-map.js';
import { METADATA_READERS } from './metadata-readers.js';
import { readRiffMetadata } from './riff-metadata.js';
import { riffMetadataChunks } from './riff-metadata-writing.js';
import { memoryBytes, writeAiff, writeWav, type FixtureChunk } from './testing/index.js';

const frames = (value: number) => value as SampleCount;

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

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

/** 32-bit words in either byte order. */
function words(little: boolean, ...values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    view.setUint32(index * 4, value, little);
  });
  return out;
}
const le = (...values: readonly number[]) => words(true, ...values);
const be16 = (...values: readonly number[]) => {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    view.setInt16(index * 2, value, false);
  });
  return out;
};

/** A list entry, padded to an even length. */
const entry = (id: string, body: Uint8Array) =>
  join(ascii(id), le(body.length), body, new Uint8Array(body.length % 2));

const wavWith = (chunks: readonly FixtureChunk[], form: 'wav' | 'rf64' = 'wav') =>
  writeWav({
    form,
    sampleRate: 48_000,
    encoding: { kind: 'integer', bits: 16 },
    channels: [new Float64Array(8)],
    beforeData: chunks,
  });

const aiffWith = (chunks: readonly FixtureChunk[]) =>
  writeAiff({
    sampleSize: 16,
    sampleRate: 48_000,
    channels: [new Float64Array(8)],
    beforeSound: chunks,
  });

/** The sentence of a refusal, which must be `codecs.malformed`. */
function refusal<T>(result: DomainResult<T>): string {
  expect(expectFailureCode(result)).toBe('codecs.malformed');
  if (result.ok) throw new Error('The result succeeded.');
  return result.failures[0].summary;
}

const riffRefusal = async (chunks: readonly FixtureChunk[]) =>
  refusal(await readRiffMetadata(memoryBytes(wavWith(chunks))));

const aiffRefusal = async (chunks: readonly FixtureChunk[]) =>
  refusal(await readAiffMetadata(memoryBytes(aiffWith(chunks))));

describe('hostile WAV metadata', () => {
  it('refuses a cue count of 0xFFFFFFFF without reading or allocating for it', async () => {
    const bytes = memoryBytes(wavWith([{ id: 'cue ', body: le(0xffff_ffff) }]));
    expect(refusal(await readRiffMetadata(bytes))).toBe(
      "The 'cue ' chunk lists 4294967295 cue points, more than the 4096 any file needs.",
    );
    expect(bytes.bytesRequested).toBeLessThan(256);
  });

  it('refuses counts past their chunks', async () => {
    expect(await riffRefusal([{ id: 'cue ', body: join(le(2), new Uint8Array(24)) }])).toBe(
      "The 'cue ' chunk lists more cue points than it holds.",
    );
    expect(
      await riffRefusal([
        { id: 'smpl', body: join(le(0, 0, 0, 60, 0, 0, 0, 1, 0), new Uint8Array(23)) },
      ]),
    ).toBe("The 'smpl' chunk lists more loops than it holds.");
  });

  it('refuses counts past their bounds, even where the chunk holds them', async () => {
    expect(
      await riffRefusal([{ id: 'cue ', body: join(le(4_097), new Uint8Array(4_097 * 24)) }]),
    ).toMatch(/4097 cue points, more than the 4096/);
    expect(
      await riffRefusal([
        { id: 'smpl', body: join(le(0, 0, 0, 60, 0, 0, 0, 1_025, 0), new Uint8Array(1_025 * 24)) },
      ]),
    ).toMatch(/1025 loops, more than the 1024/);
    const fields = Array.from({ length: 257 }, () => entry('IKEY', ascii('k\0')));
    expect(await riffRefusal([{ id: 'LIST', body: join(ascii('INFO'), ...fields) }])).toBe(
      "The file's 'INFO' lists hold more than the 256 entries any file needs.",
    );
  });

  it('refuses a loop that ends before it starts, and a unity note MIDI has not', async () => {
    const header = (note: number, loops: number) => le(0, 0, 0, note, 0, 0, 0, loops, 0);
    expect(
      await riffRefusal([{ id: 'smpl', body: join(header(60, 1), le(0, 0, 10, 9, 0, 0)) }]),
    ).toBe("A loop in the 'smpl' chunk ends at frame 9, before it starts at frame 10.");
    expect(await riffRefusal([{ id: 'smpl', body: header(128, 0) }])).toMatch(
      /above MIDI note 127/,
    );
    expect(
      await riffRefusal([{ id: 'smpl', body: le(0, 0, 0, 127, 0xc000_0000, 0, 0, 0, 0) }]),
    ).toMatch(/above MIDI note 127/);
  });

  it('refuses a nested list, an entry past its list, and a list too short for its type', async () => {
    const nested = join(ascii('INFO'), entry('LIST', ascii('INFOxx')));
    expect(await riffRefusal([{ id: 'LIST', body: nested }])).toBe(
      "The 'INFO' list holds a list inside it, which the form forbids.",
    );
    const past = join(ascii('adtl'), ascii('labl'), le(100), le(1));
    expect(await riffRefusal([{ id: 'LIST', body: past }])).toBe(
      "An entry of the 'adtl' list runs past the end of the list.",
    );
    expect(await riffRefusal([{ id: 'LIST', body: ascii('IN') }])).toMatch(/too short to name/);
    const shortLabel = join(ascii('adtl'), entry('labl', Uint8Array.of(1, 0)));
    expect(await riffRefusal([{ id: 'LIST', body: shortLabel }])).toMatch(
      /'labl' entry is too short/,
    );
  });

  it('refuses short fixed-layout chunks', async () => {
    expect(await riffRefusal([{ id: 'bext', body: new Uint8Array(601) }])).toMatch(
      /shorter than the 602/,
    );
    expect(await riffRefusal([{ id: 'smpl', body: new Uint8Array(35) }])).toMatch(
      /shorter than the 36/,
    );
    expect(await riffRefusal([{ id: 'cue ', body: new Uint8Array(3) }])).toMatch(/too short/);
  });

  it('refuses an oversized list without reading it, and many lists past the file’s bound', async () => {
    const huge = join(ascii('INFO'), entry('ICMT', new Uint8Array(1_048_576).fill(0x41)));
    const bytes = memoryBytes(wavWith([{ id: 'LIST', body: huge }]));
    expect(refusal(await readRiffMetadata(bytes))).toMatch(
      /more than the 1048576 any metadata chunk needs/,
    );
    expect(bytes.bytesRequested).toBeLessThan(256);
    const large = join(ascii('INFO'), entry('ICMT', new Uint8Array(1_000_000).fill(0x41)));
    const many = Array.from({ length: 9 }, () => ({ id: 'LIST', body: large }));
    expect(await riffRefusal(many)).toMatch(/more than the 8388608 bytes/);
  });

  it('refuses a metadata chunk that runs past the end of the file', async () => {
    const file = wavWith([{ id: 'bext', body: new Uint8Array(602), statedSize: 4_000 }]);
    // The bext chunk now claims the data chunk and beyond.
    expect(refusal(await readRiffMetadata(memoryBytes(file)))).toMatch(
      /runs past the end of the file/,
    );
  });

  it('bounds overlong text, keeping what fits', async () => {
    const info = join(ascii('INFO'), entry('INAM', new Uint8Array(100_000).fill(0x41)));
    const back = expectSuccess(
      await readRiffMetadata(memoryBytes(wavWith([{ id: 'LIST', body: info }]))),
    );
    expect(back.text?.title).toHaveLength(1_024);
  });

  it('refuses a file that is not a RIFF form, and an RF64 file with no ds64 chunk', async () => {
    expect(refusal(await readRiffMetadata(memoryBytes(aiffWith([]))))).toBe(
      'The file is not a WAV, RF64 or BW64 file.',
    );
    expect(refusal(await readRiffMetadata(memoryBytes(new Uint8Array(4))))).toMatch(/too short/);
    const rf64 = wavWith([]);
    rf64.set(ascii('RF64'), 0);
    expect(refusal(await readRiffMetadata(memoryBytes(rf64)))).toMatch(/ds64/);
  });
});

describe('hostile AIFF metadata', () => {
  const marker = (id: number, position: number) =>
    join(be16(id), words(false, position), Uint8Array.of(0, 0));
  const instrument = (note: number, detune: number, sustain: readonly number[]) =>
    join(Uint8Array.of(note, detune & 0xff, 0, 127, 1, 127), be16(0, ...sustain, 0, 0, 0));

  it('refuses marker counts past the chunk and past the bound', async () => {
    expect(await aiffRefusal([{ id: 'MARK', body: join(be16(2), marker(1, 0)) }])).toBe(
      'The MARK chunk lists more markers than it holds.',
    );
    const bytes = memoryBytes(aiffWith([{ id: 'MARK', body: be16(-1) }]));
    expect(refusal(await readAiffMetadata(bytes))).toBe(
      'The MARK chunk lists 65535 markers, more than the 4096 any file needs.',
    );
    // A name whose count byte runs past the chunk.
    const named = join(be16(1, 1), words(false, 0), Uint8Array.of(9), ascii('ab'));
    expect(await aiffRefusal([{ id: 'MARK', body: named }])).toBe(
      'The MARK chunk lists more markers than it holds.',
    );
  });

  it('refuses a marker id that is not positive or is repeated', async () => {
    expect(await aiffRefusal([{ id: 'MARK', body: join(be16(1), marker(0, 0)) }])).toMatch(
      /not positive/,
    );
    expect(
      await aiffRefusal([{ id: 'MARK', body: join(be16(2), marker(3, 0), marker(3, 9)) }]),
    ).toMatch(/marker 3 more than once/);
  });

  it('refuses an INST chunk out of its ranges, or naming what is not there', async () => {
    const mark = { id: 'MARK', body: join(be16(2), marker(1, 0), marker(2, 10)) };
    expect(await aiffRefusal([{ id: 'INST', body: new Uint8Array(19) }])).toMatch(
      /shorter than the 20/,
    );
    expect(await aiffRefusal([{ id: 'INST', body: instrument(200, 0, [0, 0, 0]) }])).toMatch(
      /base note -56 is not a MIDI note/,
    );
    expect(await aiffRefusal([{ id: 'INST', body: instrument(60, 51, [0, 0, 0]) }])).toMatch(
      /detunes by 51 cents/,
    );
    expect(await aiffRefusal([mark, { id: 'INST', body: instrument(60, 0, [3, 1, 2]) }])).toMatch(
      /play mode 3, which AIFF does not define/,
    );
    expect(await aiffRefusal([mark, { id: 'INST', body: instrument(60, 0, [1, 1, 5]) }])).toBe(
      "The INST chunk's sustain loop names marker 5, which the file does not hold.",
    );
    expect(await aiffRefusal([{ id: 'INST', body: instrument(60, 0, [1, 1, 2]) }])).toMatch(
      /marker 1/,
    );
  });

  it('refuses more annotations than any file needs, and bounds what they say', async () => {
    const many = Array.from({ length: 257 }, () => ({ id: 'ANNO', body: ascii('a') }));
    expect(await aiffRefusal(many)).toMatch(/more than the 256 'ANNO' chunks/);
    const long = Array.from({ length: 3 }, () => ({
      id: 'ANNO',
      body: new Uint8Array(40_000).fill(0x62),
    }));
    const back = expectSuccess(await readAiffMetadata(memoryBytes(aiffWith(long))));
    expect(back.text?.comment).toHaveLength(65_536);
  });

  it('refuses a file that is not an IFF audio form', async () => {
    expect(refusal(await readAiffMetadata(memoryBytes(wavWith([]))))).toBe(
      'The file is not an AIFF or AIFF-C file.',
    );
  });
});

describe('cancelling', () => {
  const file = wavWith(
    riffMetadataChunks({ text: { title: 'x' } }, 48_000).chunks.map((chunk) => ({ ...chunk })),
  );

  it('rejects with the signal’s reason when cancelled before reading', async () => {
    const controller = new AbortController();
    const reason = new Error('The person closed the import.');
    controller.abort(reason);
    await expect(readRiffMetadata(memoryBytes(file), controller.signal)).rejects.toBe(reason);
    await expect(readAiffMetadata(memoryBytes(aiffWith([])), controller.signal)).rejects.toBe(
      reason,
    );
  });

  it('rejects with the signal’s reason when cancelled during the walk', async () => {
    for (const [reader, bytes] of [
      [readRiffMetadata, file],
      [
        readAiffMetadata,
        aiffWith(
          aiffMetadataChunks({ text: { title: 'x' } }).chunks.map((chunk) => ({ ...chunk })),
        ),
      ],
    ] as const) {
      const controller = new AbortController();
      const reason = new Error('Stopped.');
      const source = memoryBytes(bytes, {
        answer: (request, honest) => {
          if (request.offset > 12) controller.abort(reason);
          return honest;
        },
      });
      await expect(reader(source, controller.signal)).rejects.toBe(reason);
    }
  });
});

describe('the readers by container', () => {
  it('reads each RIFF and IFF form by its own reader', () => {
    expect([...METADATA_READERS]).toEqual([
      ['wav', readRiffMetadata],
      ['rf64', readRiffMetadata],
      ['bw64', readRiffMetadata],
      ['aiff', readAiffMetadata],
      ['aifc', readAiffMetadata],
    ]);
  });
});

describe('damaged metadata', () => {
  const map: MetadataMap = {
    text: { title: 'Rain', comment: 'one\ntwo', copyright: 'c' },
    foreign: [{ scheme: 'riff-info', key: 'IENG', value: 'e' }],
    broadcast: {
      description: 'd',
      originator: 'o',
      originatorReference: 'r',
      originationDate: '2026-10-10',
      originationTime: '01:02:03',
      timeReference: frames(5),
      codingHistory: 'A=PCM\r\n',
    },
    cues: [
      { position: frames(3), name: 'a' },
      { position: frames(9), name: '' },
    ],
    loops: [
      {
        start: frames(1),
        length: frames(4),
        playCount: 'endless',
        direction: 'forward',
        name: 'l',
      },
      { start: frames(2), length: frames(2), playCount: 'endless', direction: 'alternating' },
    ],
    tuning: { unityNote: 60, fineTuneCents: 7 },
  };
  const fixture = (chunks: readonly { id: string; body: Uint8Array }[]) =>
    chunks.map((chunk) => ({ ...chunk }));
  const riffChunks = fixture(riffMetadataChunks(map, 48_000).chunks);
  const aiffChunks = fixture(aiffMetadataChunks(map).chunks);
  const bases = [
    { reader: readRiffMetadata, file: wavWith(riffChunks) },
    { reader: readRiffMetadata, file: wavWith(riffChunks, 'rf64') },
    { reader: readAiffMetadata, file: aiffWith(aiffChunks) },
  ];

  it('answers every one of six hundred mutations with a result and never throws', async () => {
    const next = random(93);
    const outcomes = { read: 0, refused: 0 };
    for (let trial = 0; trial < 600; trial += 1) {
      const { reader, file: base } = bases[trial % bases.length]!;
      const file = base.slice(0, next() < 0.1 ? Math.floor(next() * base.length) : base.length);
      const mutations = 1 + Math.floor(next() * 4);
      for (let count = 0; count < mutations; count += 1) {
        // Mostly within the metadata, which follows the 12-byte form header.
        file[12 + Math.floor(next() * Math.max(1, file.length - 12))] = Math.floor(next() * 256);
      }
      const result = await reader(memoryBytes(file));
      if (result.ok) outcomes.read += 1;
      else {
        expect(['codecs.malformed', 'codecs.source-changed']).toContain(result.failures[0].code);
        outcomes.refused += 1;
      }
    }
    expect(outcomes.read).toBeGreaterThan(50);
    expect(outcomes.refused).toBeGreaterThan(50);
  });
});
