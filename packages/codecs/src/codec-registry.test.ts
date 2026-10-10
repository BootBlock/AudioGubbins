/**
 * The registry against ADR-0091's table, its codes against the readers that
 * use them, and the capability a runtime has with each codec.
 */

import { describe, expect, it } from 'vitest';

import { AIFC_IN_PLACE_CODECS } from './aiff-common.js';
import { codecCapability, type CodecEnvironment } from './codec-capability.js';
import type { CodecId, CodecImplementation } from './codec-descriptor.js';
import {
  AIFC_TYPE_CODECS,
  CODEC_REGISTRY,
  WAVE_TAG_CODECS,
  codecDescriptor,
} from './codec-registry.js';
import { WAVE_IN_PLACE_CODECS } from './wave-format.js';

const IDS: readonly CodecId[] = [
  'pcm',
  'g711-alaw',
  'g711-ulaw',
  'ima-adpcm',
  'ms-adpcm',
  'flac',
  'alac',
  'mp3',
  'vorbis',
  'opus',
  'aac-lc',
  'he-aac',
];

describe('the registry', () => {
  it('holds one descriptor for every codec, under its own id', () => {
    expect([...CODEC_REGISTRY.keys()].sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(codecDescriptor(id).id).toBe(id);
  });

  /** ADR-0091's implementation for each codec, read then write; `-` is none. */
  const CHOSEN: readonly [CodecId, CodecImplementation | '-', CodecImplementation | '-'][] = [
    ['pcm', 'application', 'application'],
    ['g711-alaw', 'application', 'application'],
    ['g711-ulaw', 'application', 'application'],
    ['ima-adpcm', 'application', 'application'],
    ['ms-adpcm', 'application', 'application'],
    ['flac', 'codec-module', 'codec-module'],
    ['alac', 'codec-module', '-'],
    ['mp3', 'codec-module', 'prebuilt-module'],
    ['vorbis', 'codec-module', 'prebuilt-module'],
    ['opus', 'codec-module', 'codec-module'],
    ['aac-lc', 'codec-module', 'browser'],
    ['he-aac', 'browser', '-'],
  ];

  it.each(CHOSEN)('serves %s by the implementations ADR-0091 chose', (id, read, write) => {
    const descriptor = codecDescriptor(id);
    expect(descriptor.read?.implementation ?? '-').toBe(read);
    expect(descriptor.write?.implementation ?? '-').toBe(write);
  });

  it('marks only a browser’s codec as giving different bytes on different machines', () => {
    for (const descriptor of CODEC_REGISTRY.values()) {
      for (const direction of [descriptor.read, descriptor.write]) {
        if (direction === undefined) continue;
        expect(direction.reproducible).toBe(direction.implementation !== 'browser');
      }
    }
  });

  it('names the licence of every implementation, LAME’s as the LGPL', () => {
    expect(codecDescriptor('mp3').write?.licence).toBe('LGPL-2.0-or-later');
    expect(codecDescriptor('vorbis').write?.licence).toBe('BSD-3-Clause');
    expect(codecDescriptor('opus').read?.licence).toBe('BSD-3-Clause');
    expect(codecDescriptor('aac-lc').read?.licence).toBe('MPL-2.0');
    for (const descriptor of CODEC_REGISTRY.values()) {
      for (const direction of [descriptor.read, descriptor.write]) {
        if (direction !== undefined) expect(direction.licence).toMatch(/^[A-Za-z0-9.+-]+$/u);
      }
    }
  });

  it('states the rates each direction takes, Opus decoding only at 48 kHz', () => {
    expect(codecDescriptor('opus').read?.sampleRates).toEqual({ kind: 'listed', rates: [48_000] });
    expect(codecDescriptor('opus').write?.sampleRates).toEqual({
      kind: 'listed',
      rates: [8_000, 12_000, 16_000, 24_000, 48_000],
    });
    expect(codecDescriptor('mp3').write?.sampleRates).toMatchObject({ kind: 'listed' });
    expect(codecDescriptor('mp3').write?.maximumChannels).toBe(2);
    expect(codecDescriptor('pcm').write?.sampleRates).toEqual({
      kind: 'any',
      minimum: 8_000,
      maximum: 768_000,
    });
  });

  it('names each code once, and reads in place exactly the codecs the application serves there', () => {
    const tags = [...CODEC_REGISTRY.values()].flatMap(
      (descriptor) => descriptor.codes.waveFormatTags,
    );
    const types = [...CODEC_REGISTRY.values()].flatMap(
      (descriptor) => descriptor.codes.aifcCompressionTypes,
    );
    expect(new Set(tags).size).toBe(tags.length);
    expect(new Set(types).size).toBe(types.length);
    expect(WAVE_TAG_CODECS.get(0x0055)).toBe('mp3');
    expect(AIFC_TYPE_CODECS.get('ima4')).toBe('ima-adpcm');
    const inPlace = (container: 'wav' | 'aifc') =>
      [...CODEC_REGISTRY.values()]
        .filter(
          (descriptor) =>
            descriptor.read?.implementation === 'application' &&
            descriptor.read.containers.includes(container),
        )
        .map((descriptor) => descriptor.id)
        .sort();
    expect([...WAVE_IN_PLACE_CODECS].sort()).toEqual(inPlace('wav'));
    expect([...AIFC_IN_PLACE_CODECS].sort()).toEqual(inPlace('aifc'));
  });
});

/** A runtime with everything: WebAssembly, the codec module and each encoder loaded, and AAC probed. */
const EVERYTHING: CodecEnvironment = {
  webAssembly: true,
  codecModule: 'loaded',
  prebuiltModules: new Map([
    ['mp3', 'loaded'],
    ['vorbis', 'loaded'],
  ]),
  browserDecoders: new Set(['aac-lc', 'he-aac']),
  browserEncoders: new Set(['aac-lc', 'opus']),
};

/** A runtime with nothing but the application's own codecs. */
const BARE: CodecEnvironment = {
  webAssembly: false,
  codecModule: 'not-loaded',
  prebuiltModules: new Map(),
  browserDecoders: new Set(),
  browserEncoders: new Set(),
};

describe('a codec’s capability', () => {
  it('serves the application’s own codecs everywhere, WebAssembly or not', () => {
    for (const id of ['pcm', 'g711-alaw', 'g711-ulaw', 'ima-adpcm', 'ms-adpcm'] as const) {
      for (const use of ['read', 'write'] as const) {
        expect(codecCapability(BARE, id, use)).toEqual({
          kind: 'available',
          codec: id,
          use,
          implementation: 'application',
        });
      }
    }
  });

  it('serves the codec module and the encoders wherever WebAssembly is, until a load fails', () => {
    const fresh: CodecEnvironment = { ...BARE, webAssembly: true };
    expect(codecCapability(fresh, 'flac', 'read').kind).toBe('available');
    expect(codecCapability(fresh, 'mp3', 'write')).toMatchObject({
      kind: 'available',
      implementation: 'prebuilt-module',
    });
    expect(codecCapability(EVERYTHING, 'opus', 'write')).toMatchObject({
      kind: 'available',
      implementation: 'codec-module',
    });
  });

  it('refuses a codec module format without WebAssembly, offering lossless codecs first', () => {
    expect(codecCapability(BARE, 'flac', 'write')).toEqual({
      kind: 'unavailable',
      codec: 'flac',
      use: 'write',
      reason: 'Exporting FLAC needs WebAssembly, which this browser does not run.',
      alternatives: ['pcm', 'g711-alaw', 'g711-ulaw', 'ima-adpcm', 'ms-adpcm'],
    });
  });

  it('refuses every format of a codec module that failed to load, and only those', () => {
    const failed: CodecEnvironment = { ...EVERYTHING, codecModule: 'failed' };
    expect(codecCapability(failed, 'vorbis', 'read')).toMatchObject({
      kind: 'unavailable',
      reason: 'The codec module could not be loaded, so Vorbis cannot be imported here.',
    });
    expect(codecCapability(failed, 'mp3', 'write').kind).toBe('available');
    expect(codecCapability(failed, 'he-aac', 'read').kind).toBe('available');
  });

  it('refuses MP3 export when its encoder failed to load, offering the other lossy codecs first', () => {
    const failed: CodecEnvironment = {
      ...EVERYTHING,
      prebuiltModules: new Map([
        ['mp3', 'failed'],
        ['vorbis', 'loaded'],
      ]),
    };
    expect(codecCapability(failed, 'mp3', 'write')).toEqual({
      kind: 'unavailable',
      codec: 'mp3',
      use: 'write',
      reason: 'The MP3 encoder could not be loaded, so MP3 cannot be exported here.',
      alternatives: [
        'opus',
        'vorbis',
        'aac-lc',
        'g711-alaw',
        'g711-ulaw',
        'ima-adpcm',
        'ms-adpcm',
        'pcm',
        'flac',
      ],
    });
  });

  it('refuses AAC export where no browser encoder was probed, offering Opus, Vorbis and MP3', () => {
    const capability = codecCapability(
      { ...EVERYTHING, browserEncoders: new Set() },
      'aac-lc',
      'write',
    );
    expect(capability).toMatchObject({
      kind: 'unavailable',
      reason: "Exporting AAC-LC needs the browser's own encoder, which this browser does not have.",
    });
    expect(capability.kind === 'unavailable' ? capability.alternatives.slice(0, 3) : []).toEqual([
      'opus',
      'vorbis',
      'mp3',
    ]);
  });

  it('decodes HE-AAC only where the browser’s decoder was probed', () => {
    expect(codecCapability(EVERYTHING, 'he-aac', 'read')).toMatchObject({
      kind: 'available',
      implementation: 'browser',
    });
    expect(
      codecCapability({ ...EVERYTHING, browserDecoders: new Set() }, 'he-aac', 'read'),
    ).toMatchObject({
      kind: 'unavailable',
      reason: "Importing HE-AAC needs the browser's own decoder, which this browser does not have.",
    });
  });

  it('names a direction AudioGubbins does not serve at all', () => {
    expect(codecCapability(EVERYTHING, 'alac', 'write')).toMatchObject({
      kind: 'unavailable',
      reason: 'AudioGubbins does not export Apple Lossless (ALAC).',
      alternatives: [
        'pcm',
        'flac',
        'opus',
        'vorbis',
        'mp3',
        'aac-lc',
        'g711-alaw',
        'g711-ulaw',
        'ima-adpcm',
        'ms-adpcm',
      ],
    });
    expect(codecCapability(EVERYTHING, 'he-aac', 'write')).toMatchObject({
      reason: 'AudioGubbins does not export HE-AAC.',
    });
  });
});
