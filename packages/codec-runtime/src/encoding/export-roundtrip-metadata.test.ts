/**
 * Metadata and loops through every exported format that holds them (ADR-0093):
 * each file is made by the export's real encoder and writer from a request
 * carrying the map the page gives an export (`fileMetadata`: the source's
 * text, foreign fields, broadcast description and tuning, the project's cues,
 * and its looping regions as named, forward, endless loops), then read back by
 * `METADATA_READERS`. What a format holds reads back unchanged; what it cannot
 * hold is reported dropped by its writer, exactly, and is absent on reading.
 *
 * WAV holds every part in `LIST`/`INFO`, `bext`, `cue `/`adtl` and `smpl`, with
 * no `INFO` key for an album artist, a total, a disc or an ISRC (RIFF `ISRC`
 * means the source) and no free-form field. AIFF and AIFF-C hold four texts,
 * `MARK` cues and `INST` loops and tuning, and no broadcast description. FLAC,
 * Vorbis, Opus, MP3 and M4A hold every text and the foreign field, in their own
 * free-form field, and one forward endless loop as `LOOPSTART` and
 * `LOOPLENGTH`, reporting the rest of the loops dropped; FLAC holds every loop,
 * the cues and the tuning as well where the person keeps the WAV chunks in
 * `riff` blocks. A sampler chunk (`smpl`, `INST`) must state a unity note, so
 * loops written with no tuning read back with the chunk's untuned middle C,
 * which adds to the map and takes nothing from it. AAC's audio comes from a
 * fake of the browser's encoder; its M4A file, `ilst` included, is the real
 * writer's.
 *
 * RF64 and BW64 are not exercised here: an export is RF64 only past 4 GiB and
 * never BW64, and the codecs' own tests read every metadata chunk in both
 * forms.
 */

import {
  METADATA_READERS,
  type ForeignMetadataField,
  type MetadataLoop,
  type MetadataMap,
  type MetadataPart,
  type MetadataTextKey,
} from '@audiogubbins/codecs';
import { memoryBytes } from '@audiogubbins/codecs/testing';
import { StandardLayouts, derivedSampleCount } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { exportTarget, type FormatEncoding } from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import type { ExportEncoderServices } from '../worker/encode-job.js';
import { fakeWebCodecs } from '../testing/fake-web-codecs.js';
import {
  encodeWritten,
  exportRequest,
  testServices,
  testSignal,
} from '../testing/export-encoding.js';

const RATE = 48_000;
const FRAMES = 24_000;

/** Each case encodes a half second several times over, some of it in WebAssembly. */
const ENCODING_TIMEOUT_MS = 120_000;

/** A loop as the tag convention holds one: forward, endless and unnamed. */
const PLAIN_LOOP: MetadataLoop = {
  start: derivedSampleCount(2_000),
  length: derivedSampleCount(8_000),
  playCount: 'endless',
  direction: 'forward',
};

const BODY: MetadataLoop = { ...PLAIN_LOOP, name: 'Body' };

/** The map an export of a region's asset carries, every part `fileMetadata` gives. */
const PROJECT_MAP: MetadataMap = {
  text: {
    title: 'Rain on tin',
    artist: 'A. Field Recordist',
    album: 'Weather',
    albumArtist: 'Various',
    trackNumber: '3',
    trackTotal: '12',
    discNumber: '1',
    discTotal: '2',
    date: '2026-10-10',
    genre: 'Ambient',
    comment: 'Recorded under a porch, ünder the eaves.',
    copyright: '2026 example.com',
    encoder: 'AudioGubbins',
    isrc: 'GBAYE2600001',
  },
  foreign: [{ scheme: 'vorbis-comment', key: 'MOOD', value: 'Calm' }],
  broadcast: {
    description: 'Rain on tin',
    originator: 'AudioGubbins',
    originatorReference: 'AG0001',
    originationDate: '2026-10-10',
    originationTime: '12:00:00',
    timeReference: derivedSampleCount(48_000),
    codingHistory: 'A=PCM,F=48000,W=16,M=stereo',
  },
  cues: [
    { position: derivedSampleCount(1_000), name: 'Drip' },
    { position: derivedSampleCount(9_000), name: 'Gust' },
  ],
  loops: [
    BODY,
    {
      start: derivedSampleCount(12_000),
      length: derivedSampleCount(4_000),
      playCount: 'endless',
      direction: 'forward',
      name: 'Tail',
    },
  ],
  tuning: { unityNote: 62, fineTuneCents: -12 },
};

/** The text fields of `keys`, as a writer reports them dropped. */
const text = (...keys: readonly MetadataTextKey[]): MetadataPart[] =>
  keys.map((key) => ({ kind: 'text', key }));

/** The parts the tag formats drop: what has no tag, and every loop past the first. */
const TAG_DROPS: readonly MetadataPart[] = [
  { kind: 'broadcast' },
  { kind: 'cues' },
  { kind: 'tuning' },
  { kind: 'loops' },
];

/** How one format's file is made, what it reports dropped and how it names the foreign field. */
interface FormatCase {
  readonly name: string;
  readonly encoding: FormatEncoding;
  readonly dropped: readonly MetadataPart[];

  /** The foreign field as the format's reader gives it back, where it holds one. */
  readonly foreign?: ForeignMetadataField;

  /** Whether its loops are held in a sampler chunk, which states a unity note whatever the map says. */
  readonly sampler: boolean;
}

/** The tuning a sampler chunk states where the map gives none: middle C, untuned. */
const UNTUNED = { unityNote: 60, fineTuneCents: 0 } as const;

const AIFF_DROPS: readonly MetadataPart[] = [
  ...text(
    'album',
    'albumArtist',
    'trackNumber',
    'trackTotal',
    'discNumber',
    'discTotal',
    'date',
    'genre',
    'encoder',
    'isrc',
  ),
  { kind: 'foreign', scheme: 'vorbis-comment', key: 'MOOD' },
  { kind: 'broadcast' },
];

const VORBIS_MOOD: ForeignMetadataField = { scheme: 'vorbis-comment', key: 'MOOD', value: 'Calm' };

const CASES: readonly FormatCase[] = [
  {
    name: 'WAV',
    encoding: { format: 'wav', encoding: { kind: 'integer', bits: 16 } },
    dropped: [
      ...text('albumArtist', 'trackTotal', 'discNumber', 'discTotal', 'isrc'),
      { kind: 'foreign', scheme: 'vorbis-comment', key: 'MOOD' },
    ],
    sampler: true,
  },
  {
    name: 'AIFF',
    encoding: { format: 'aiff', encoding: { kind: 'integer', bits: 24 } },
    dropped: AIFF_DROPS,
    sampler: true,
  },
  {
    name: 'AIFF-C',
    encoding: { format: 'aifc', encoding: { kind: 'float', bits: 32 } },
    dropped: AIFF_DROPS,
    sampler: true,
  },
  {
    name: 'FLAC, its loops as comments',
    encoding: {
      format: 'flac',
      encoding: { bits: 16, compressionLevel: 5, keepRiffChunks: false },
    },
    dropped: [{ kind: 'loops' }, { kind: 'cues' }, { kind: 'tuning' }, { kind: 'broadcast' }],
    foreign: VORBIS_MOOD,
    sampler: false,
  },
  {
    name: 'FLAC, keeping the WAV chunks in riff blocks',
    encoding: {
      format: 'flac',
      encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: true },
    },
    dropped: [{ kind: 'broadcast' }],
    foreign: VORBIS_MOOD,
    sampler: true,
  },
  {
    name: 'Ogg Vorbis',
    encoding: { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 5 } },
    dropped: TAG_DROPS,
    foreign: VORBIS_MOOD,
    sampler: false,
  },
  {
    name: 'Opus',
    encoding: {
      format: 'opus',
      encoding: { bitRate: 96, application: 'audio', frameDuration: 20, complexity: 10 },
    },
    dropped: TAG_DROPS,
    foreign: VORBIS_MOOD,
    sampler: false,
  },
  {
    name: 'MP3',
    encoding: { format: 'mp3', encoding: { mode: 'constant', bitRate: 192 } },
    dropped: TAG_DROPS,
    foreign: { scheme: 'id3v2', key: 'MOOD', value: 'Calm' },
    sampler: false,
  },
  {
    name: 'AAC in M4A',
    encoding: { format: 'aac', encoding: { bitRate: 128 } },
    dropped: TAG_DROPS,
    foreign: { scheme: 'ilst', key: '----:com.apple.iTunes:MOOD', value: 'Calm' },
    sampler: false,
  },
];

/** The services a format's encoder is opened with: the fake browser encoder for AAC alone. */
function servicesFor(encoding: FormatEncoding): ExportEncoderServices {
  return encoding.format === 'aac'
    ? testServices(fakeWebCodecs({ priming: 1_024 }).webCodecs)
    : testServices();
}

/** Whether `parts` names `part`. */
function names(parts: readonly MetadataPart[], part: MetadataPart): boolean {
  return parts.some((one) => JSON.stringify(one) === JSON.stringify(part));
}

/**
 * The map a reader gives back of `given` once `dropped` is left out: a format
 * that reports loops dropped keeps the first as a plain forward, endless loop,
 * which the tags state without a name.
 */
function keptOf(
  given: MetadataMap,
  dropped: readonly MetadataPart[],
  foreign: ForeignMetadataField | undefined,
): MetadataMap {
  const keptText = Object.fromEntries(
    Object.entries(given.text ?? {}).filter(
      ([key]) => !dropped.some((part) => part.kind === 'text' && part.key === key),
    ),
  );
  const [first] = given.loops ?? [];
  const loops = names(dropped, { kind: 'loops' })
    ? first === undefined
      ? []
      : [{ ...PLAIN_LOOP, start: first.start, length: first.length }]
    : given.loops;
  return {
    ...(Object.keys(keptText).length === 0 ? {} : { text: keptText }),
    ...(foreign === undefined ? {} : { foreign: [foreign] }),
    ...(given.broadcast === undefined || names(dropped, { kind: 'broadcast' })
      ? {}
      : { broadcast: given.broadcast }),
    ...(given.cues === undefined || names(dropped, { kind: 'cues' }) ? {} : { cues: given.cues }),
    ...(loops === undefined || loops.length === 0 ? {} : { loops }),
    ...(given.tuning === undefined || names(dropped, { kind: 'tuning' })
      ? {}
      : { tuning: given.tuning }),
  };
}

/** The file `encoding` makes of a half second of stereo carrying `map`, what it dropped, and what reads back. */
async function roundTrip(
  encoding: FormatEncoding,
  map: MetadataMap,
): Promise<{ readonly dropped: readonly MetadataPart[]; readonly read: MetadataMap }> {
  const written = await encodeWritten(
    exportRequest(encoding, RATE, StandardLayouts.stereo, map),
    testSignal(2, FRAMES, RATE),
    servicesFor(encoding),
  );
  const reader = METADATA_READERS.get(exportTarget(encoding).container);
  if (reader === undefined) throw new Error(`No metadata reader for ${encoding.format}.`);
  return {
    dropped: written.finished.dropped,
    read: expectSuccess(await reader(memoryBytes(written.file))),
  };
}

describe('the metadata and loops of an export, read back from the finished file', () => {
  it.each(CASES)(
    '$name holds what it can, and reports exactly what it dropped',
    async ({ encoding, dropped, foreign }) => {
      const result = await roundTrip(encoding, PROJECT_MAP);
      expect(result.dropped).toEqual(dropped);
      expect(result.read).toEqual(keptOf(PROJECT_MAP, dropped, foreign));
    },
    ENCODING_TIMEOUT_MS,
  );

  it(
    'writes one plain forward, endless loop as the tags state it, dropping nothing of it',
    async () => {
      const plain: MetadataMap = { text: { title: 'Engine idle' }, loops: [PLAIN_LOOP] };
      for (const { encoding, sampler } of CASES) {
        const result = await roundTrip(encoding, plain);
        expect(result.dropped).toEqual([]);
        expect(result.read).toEqual(sampler ? { ...plain, tuning: UNTUNED } : plain);
      }
    },
    ENCODING_TIMEOUT_MS,
  );

  it(
    'reports a fractional tuning dropped, and a loop that plays back and forth where only the chunks hold it',
    async () => {
      const map: MetadataMap = {
        loops: [{ ...BODY, direction: 'alternating' }],
        tuning: { unityNote: 60, fineTuneCents: 12.5 },
      };
      const chunked: readonly FormatEncoding[] = [
        { format: 'wav', encoding: { kind: 'integer', bits: 16 } },
        { format: 'aiff', encoding: { kind: 'integer', bits: 16 } },
        {
          format: 'flac',
          encoding: { bits: 16, compressionLevel: 5, keepRiffChunks: true },
        },
      ];
      for (const encoding of chunked) {
        const result = await roundTrip(encoding, map);
        expect(result.dropped).toEqual([{ kind: 'tuning' }]);
        expect(result.read).toEqual({ loops: map.loops, tuning: UNTUNED });
      }
      const tagged = await roundTrip(
        { format: 'ogg-vorbis', encoding: { mode: 'quality', quality: 5 } },
        map,
      );
      expect(tagged.dropped).toEqual([{ kind: 'tuning' }, { kind: 'loops' }]);
      expect(tagged.read).toEqual({ loops: [PLAIN_LOOP] });
    },
    ENCODING_TIMEOUT_MS,
  );
});
