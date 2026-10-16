import { describe, expect, it } from 'vitest';

import {
  FadeShape,
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type PlacedMarker,
  type PlacedRegion,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExportSettings, ExportableRegion } from '@audiogubbins/import-export';
import type { KeptMetadata } from '@audiogubbins/project-format';

import type { EditorAsset } from '../assets/editor-asset.js';
import { fileMetadata } from './file-metadata.js';

const RATE = expectSuccess(sampleRate(48_000));
const at = derivedSampleCount;

const GULLS = unsafeBrandId<'RegionId'>('0a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');
const WAVES = unsafeBrandId<'RegionId'>('1a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d');

const MARKERS: readonly PlacedMarker[] = [
  {
    id: unsafeBrandId('2a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d'),
    displayName: 'Bell',
    position: at(1_000),
  },
  {
    id: unsafeBrandId('3a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d'),
    displayName: 'Horn',
    position: at(30_000),
  },
];

const REGIONS: readonly PlacedRegion[] = [
  {
    id: WAVES,
    displayName: 'Waves',
    start: at(10_000),
    length: at(20_000),
    loop: {
      loopStart: at(2_000),
      loopEnd: at(12_000),
      crossfadeLength: at(0),
      crossfadeShape: FadeShape.Linear,
    },
    tags: [],
  },
  { id: GULLS, displayName: 'Gulls', start: at(35_000), length: at(5_000), tags: [] },
];

/** An asset as its view places its markers and regions; the rest is not read. */
function asset(markers: readonly PlacedMarker[], regions: readonly PlacedRegion[]): EditorAsset {
  return { markers, regions } as EditorAsset;
}

const KEPT: KeptMetadata = {
  text: { artist: 'The harbour', title: 'Dusk' },
  cues: [{ position: at(5), name: 'From the file' }],
  tuning: { unityNote: 60, fineTuneCents: 0 },
};

function settings(policy: ExportSettings['metadata']['policy']): ExportSettings {
  return {
    format: 'wav',
    encoding: { kind: 'float', bits: 32 },
    sampleRate: RATE,
    channels: { kind: 'keep' },
    dither: { kind: 'none' },
    range: { kind: 'project' },
    metadata: { policy, edits: [] },
    fileName: '{project}',
  };
}

/** A file of `length` frames from `start`, of `region` where given, rendered at `hertz`. */
function file(
  start: number,
  length: number,
  region?: ExportableRegion,
  hertz = 48_000,
): Parameters<typeof fileMetadata>[0] {
  return {
    span: {
      audio: { sampleRate: RATE, layout: StandardLayouts.stereo, precision: { kind: 'float' } },
      start: at(start),
      length: at(length),
      region,
    },
    render: { sampleRate: expectSuccess(sampleRate(hertz)) },
  };
}

describe('the metadata an exported file carries (ADR-0093)', () => {
  it("carries the source's position-free metadata, and the project's markers and whole looping regions as cues and loops", () => {
    const metadata = expectSuccess(
      fileMetadata(file(0, 48_000), settings('full'), {
        asset: asset(MARKERS, REGIONS),
        region: undefined,
        kept: KEPT,
      }),
    );

    expect(metadata).toEqual({
      text: { artist: 'The harbour', title: 'Dusk' },
      tuning: { unityNote: 60, fineTuneCents: 0 },
      cues: [
        { position: 1_000, name: 'Bell' },
        { position: 30_000, name: 'Horn' },
      ],
      loops: [
        {
          start: 12_000,
          length: 10_000,
          playCount: 'endless',
          direction: 'forward',
          name: 'Waves',
        },
      ],
    });
  });

  it('places a selection from its own start, keeping only what it holds, at the rate the file is written', () => {
    const metadata = expectSuccess(
      fileMetadata(file(5_000, 30_000, undefined, 96_000), settings('full'), {
        asset: asset(MARKERS, REGIONS),
        region: undefined,
        kept: undefined,
      }),
    );

    expect(metadata.cues).toEqual([{ position: 50_000, name: 'Horn' }]);
    expect(metadata.loops).toEqual([
      { start: 14_000, length: 20_000, playCount: 'endless', direction: 'forward', name: 'Waves' },
    ]);
  });

  it("gives a region's file its name as the title, its own loop, and the markers inside it", () => {
    const region = { id: WAVES, name: 'Waves' } as ExportableRegion;
    const inside: readonly PlacedMarker[] = [
      {
        id: unsafeBrandId('4a1b2c3d-4e5f6a7b-8c9d0e1f-2a3b4c5d'),
        displayName: 'Swell',
        position: at(4_000),
      },
    ];
    const metadata = expectSuccess(
      fileMetadata(file(0, 20_000, region), settings('full'), {
        asset: asset(MARKERS, REGIONS),
        region: asset(inside, []),
        kept: KEPT,
      }),
    );

    expect(metadata).toMatchObject({
      text: { artist: 'The harbour', title: 'Waves' },
      cues: [{ position: 4_000, name: 'Swell' }],
      loops: [{ start: 2_000, length: 10_000, name: 'Waves' }],
    });
  });

  it('carries the title and the loops alone where the policy is minimal', () => {
    const metadata = expectSuccess(
      fileMetadata(file(0, 48_000), settings('minimal'), {
        asset: asset(MARKERS, REGIONS),
        region: undefined,
        kept: KEPT,
      }),
    );

    expect(metadata.cues ?? []).toEqual([]);
    expect(metadata.text).toEqual({ title: 'Dusk' });
    expect(metadata.loops).toHaveLength(1);
  });
});
