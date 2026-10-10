/**
 * The golden tests of a spectral edit (ADR-0081): the sound, the masks and the
 * settings every operation is pinned over, and the check each case passes,
 * shared by the engine's operations and the effect rack's `process`, so every
 * operation is held to the same fixtures and the same rule.
 *
 * Each case is read as playback and a render read it, through the plan, from
 * the reference path in reads of one length and from the WebAssembly DSP in
 * reads of another. The two must give the same bits, the pinned ones
 * (ADR-0032), and every sample no changed frame reaches must be its input, bit
 * for bit. Which samples a changed frame may reach is stated here from the ADR
 * rather than read from the realisation, so a fault in the realisation's frames
 * cannot hide itself: frame `k` is centred at `k · H`, `H` being the resolution
 * `N` over the quality's spectral overlap, and holds the `N` samples from
 * `k · H − N/2`; it may change only where its weights, the mask's at its centre
 * and each bin's centre frequency `b · rate / N`, are above nothing somewhere,
 * an isolation's weights being what the mask leaves, `1 − w`, in a frame
 * centred within the mask's support.
 */

import { expect } from 'vitest';

import {
  DEFAULT_SPECTRAL_RESOLUTION,
  MAXIMUM_QUALITY,
  MaskEffect,
  MaskWeights,
  NO_FEATHER,
  QualityLevel,
  StandardLayouts,
  derivedSampleCount,
  maskSupport,
  namedQualityMode,
  sampleRate,
  type PlannedSpectralEdit,
  type QualitySettings,
  type SpectralMask,
  type SpectralPoint,
  type StrokePoint,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { sineOfTurns } from '../dsp/reference/primitives.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import type { ChainProcessing } from '../pcm/chain-processing.js';
import { editedSource } from '../pcm/edited-source.js';
import { allocateBlock } from '../pcm/frame-block.js';
import type { PcmSource } from '../pcm/pcm-source.js';
import { ProcessedStart } from '../pcm/processed-content.js';
import { fingerprint } from './pcm-fingerprint.js';
import { processedPlan, rackedMedia } from './racked-plan.js';

/** The golden sound's rate. */
export const GOLDEN_RATE = expectSuccess(sampleRate(48_000));

/** The golden sound's layout: four channels, so a scope can leave some either side. */
export const GOLDEN_LAYOUT = StandardLayouts.quadraphonic;

/** The golden sound's length: a second. */
export const GOLDEN_LENGTH = 48_000;

/** The clicks of the golden sound, each a frame and a size, for a chain's de-click to repair. */
const CLICKS: readonly (readonly [number, number])[] = [
  [17_003, 0.7],
  [20_517, -0.5],
  [26_411, 0.6],
  [33_250, -0.8],
];

/**
 * Per channel, two tones over seeded noise, with a burst of noise from 24,000
 * to 24,100 for a heal to repair and clicks for a de-click, each sample
 * rounded once to f32.
 */
export const GOLDEN_INPUT: readonly Float32Array[] = GOLDEN_LAYOUT.roles.map((_, channel) => {
  let state = 0x9e3779b9 ^ (channel + 1);
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296 - 0.5;
  };
  const samples = Float32Array.from({ length: GOLDEN_LENGTH }, (__, n) => {
    const tone =
      0.3 * sineOfTurns((n * (700 + 250 * channel)) / GOLDEN_RATE) +
      0.2 * sineOfTurns((n * (4_100 + 900 * channel)) / GOLDEN_RATE);
    const burst = n >= 24_000 && n < 24_100 ? 0.8 : 0;
    return Math.fround(tone + (0.05 + burst) * next());
  });
  for (const [frame, size] of CLICKS) {
    samples[frame + channel] = Math.fround((samples[frame + channel] ?? 0) + size);
  }
  return samples;
});

const at = derivedSampleCount;

function point(position: number, frequency: number): SpectralPoint {
  return { position: at(position), frequency };
}

function brush(position: number, frequency: number, strength: number, radius: number): StrokePoint {
  return { ...point(position, frequency), strength, radius: { time: radius, frequency: radius } };
}

/** A golden mask, and the channels an edit over it acts on: every channel where absent. */
export interface GoldenMask {
  readonly name: string;
  readonly mask: SpectralMask;
  readonly channels?: readonly number[];
}

/**
 * A mask of each shape kind: a rectangle, a polygon, a brush's stroke, shapes
 * subtracted from another, one subtraction leaving a span of whole frames
 * unchanged within the mask, and a feathered rectangle and polygon.
 */
export const GOLDEN_MASKS: readonly GoldenMask[] = [
  {
    name: 'rectangle',
    mask: {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: at(16_000), end: at(30_000) },
          band: { low: 500, high: 6_000 },
        },
      ],
      feather: NO_FEATHER,
    },
  },
  {
    name: 'polygon',
    mask: {
      shapes: [
        {
          kind: 'polygon',
          effect: MaskEffect.Add,
          points: [
            point(12_000, 300),
            point(30_000, 2_000),
            point(22_000, 9_000),
            point(14_000, 5_000),
          ],
        },
      ],
      feather: NO_FEATHER,
    },
    channels: [1, 2],
  },
  {
    name: 'stroke',
    mask: {
      shapes: [
        {
          kind: 'stroke',
          effect: MaskEffect.Add,
          hardness: 0.4,
          points: [
            brush(10_000, 1_000, 1, 700),
            brush(20_000, 3_000, 0.6, 900),
            brush(32_000, 2_000, 0.9, 500),
          ],
        },
      ],
      feather: NO_FEATHER,
    },
    channels: [3],
  },
  {
    name: 'subtract',
    mask: {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: at(6_000), end: at(42_000) },
          band: { low: 0, high: 12_000 },
        },
        {
          kind: 'rectangle',
          effect: MaskEffect.Subtract,
          range: { start: at(18_000), end: at(28_000) },
          band: { low: 0, high: 24_000 },
        },
        {
          kind: 'polygon',
          effect: MaskEffect.Subtract,
          points: [point(32_000, 1_000), point(38_000, 1_500), point(35_000, 6_000)],
        },
      ],
      feather: NO_FEATHER,
    },
    channels: [0, 2],
  },
  {
    name: 'feather',
    mask: {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: at(18_000), end: at(26_000) },
          band: { low: 1_000, high: 3_000 },
        },
        {
          kind: 'polygon',
          effect: MaskEffect.Add,
          points: [point(28_000, 5_000), point(36_000, 6_000), point(32_000, 9_000)],
        },
      ],
      feather: { time: 1_500, frequency: 800 },
    },
  },
];

/** A resolution and a quality an edit is realised at. */
export interface GoldenSettings {
  readonly name: string;
  readonly resolution: number;
  readonly quality: QualitySettings;
}

/** The default resolution and a finer one at the render's quality, and a coarser at a preview's. */
export const GOLDEN_SETTINGS: readonly GoldenSettings[] = [
  {
    name: 'default at maximum',
    resolution: DEFAULT_SPECTRAL_RESOLUTION,
    quality: MAXIMUM_QUALITY.settings,
  },
  { name: '512 at maximum', resolution: 512, quality: MAXIMUM_QUALITY.settings },
  {
    name: '8192 at draft',
    resolution: 8_192,
    quality: namedQualityMode(QualityLevel.Draft).settings,
  },
];

/** Whether a frame centred at `centre` is free to change under `edit`. */
function mayChange(
  edit: PlannedSpectralEdit,
  weights: MaskWeights,
  centre: number,
  frequencies: Float64Array,
  row: Float64Array,
): boolean {
  weights.row(centre, frequencies, row);
  if (edit.operation.kind !== 'isolate') return row.some((weight) => weight > 0);
  const support = maskSupport(edit.mask);
  if (centre < support.start || centre > support.end) return false;
  return row.some((weight) => 1 - weight > 0);
}

/**
 * For each of a stream's `length` samples, 1 where a frame of `edit` that
 * may change holds it at `rate` and `overlap`, and 0 where none does.
 */
export function changedReach(
  edit: PlannedSpectralEdit,
  rate: number,
  overlap: number,
  length: number,
): Uint8Array {
  const size = edit.resolution;
  const hop = size / overlap;
  const half = size / 2;
  const frequencies = Float64Array.from({ length: half + 1 }, (_, bin) => (bin * rate) / size);
  const row = new Float64Array(frequencies.length);
  const weights = new MaskWeights(edit.mask);
  const reach = new Uint8Array(length);
  const firstFrame = Math.floor(-half / hop);
  const lastFrame = Math.ceil((length + half) / hop);
  for (let k = firstFrame; k <= lastFrame; k += 1) {
    if (!mayChange(edit, weights, k * hop, frequencies, row)) continue;
    reach.fill(1, Math.max(0, k * hop - half), Math.max(0, Math.min(length, k * hop + half)));
  }
  return reach;
}

/** Everything `source` holds, one array per channel, read in reads of `chunk` frames. */
async function readWhole(source: PcmSource, chunk: number): Promise<Float32Array[]> {
  const length = source.length ?? 0;
  const out = source.layout.roles.map(() => new Float32Array(length));
  const block = allocateBlock(source.layout, source.sampleRate, chunk);
  for (let start = 0; start < length; start += chunk) {
    const read = await source.read(derivedSampleCount(start), block);
    block.channels.forEach((channel, index) => out[index]?.set(channel.subarray(0, read), start));
  }
  return out;
}

/** The positions at which `made` and `given` differ in any bit, in order. */
function differingBits(made: Float32Array, given: Float32Array): number[] {
  const left = new Uint32Array(made.buffer, made.byteOffset, made.length);
  const right = new Uint32Array(given.buffer, given.byteOffset, given.length);
  const differing: number[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) differing.push(index);
  }
  return differing;
}

/** Each channel's samples one after another, as one fingerprint holds them. */
function joined(channels: readonly Float32Array[]): Float32Array {
  const all = new Float32Array(channels.reduce((sum, channel) => sum + channel.length, 0));
  let offset = 0;
  for (const channel of channels) {
    all.set(channel, offset);
    offset += channel.length;
  }
  return all;
}

/** `edit` over {@link GOLDEN_INPUT}, through the plan, read whole in reads of `chunk` frames. */
async function realised(
  dsp: CanonicalDsp,
  edit: PlannedSpectralEdit,
  quality: QualitySettings,
  processing: ChainProcessing,
  chunk: number,
): Promise<Float32Array[]> {
  const source = expectSuccess(
    editedSource(
      processedPlan({ kind: 'spectral', edit }, GOLDEN_LENGTH, GOLDEN_RATE, GOLDEN_LAYOUT),
      [rackedMedia(GOLDEN_INPUT, GOLDEN_RATE)],
      GOLDEN_LAYOUT,
      dsp,
      { processing, quality, start: ProcessedStart.Canonical },
    ),
  );
  const out = await readWhole(source, chunk);
  source.release();
  return out;
}

/** What a golden case is realised with, and the fingerprint it is pinned to. */
export interface SpectralGoldenCase {
  readonly edit: PlannedSpectralEdit;
  readonly quality: QualitySettings;
  /** The rack's processing a `process` edit's chain runs through. */
  readonly processing: ChainProcessing;
  readonly wasm: CanonicalDsp;
  /** FNV-1a of each channel's samples one after another (`pcm-fingerprint.ts`). */
  readonly golden: bigint | undefined;
}

/**
 * Expects `edit` over the golden sound to give the same bits on the
 * reference path and `wasm`; its input, bit for bit, at every sample no
 * changed frame reaches and in every channel out of its scope, and some
 * sample of each channel in it changed; and the pinned bits.
 */
export async function expectSpectralGolden(golden: SpectralGoldenCase): Promise<void> {
  const { edit, quality, processing } = golden;
  const reference = await realised(REFERENCE_DSP, edit, quality, processing, 4_096);
  const assembled = await realised(golden.wasm, edit, quality, processing, 997);
  for (const [channel, made] of reference.entries()) {
    expect(differingBits(assembled[channel] ?? new Float32Array(), made)).toEqual([]);
  }
  const reach = changedReach(edit, GOLDEN_RATE, quality.spectralOverlap, GOLDEN_LENGTH);
  for (const [channel, made] of reference.entries()) {
    const differing = differingBits(made, GOLDEN_INPUT[channel] ?? new Float32Array());
    if (edit.channels !== undefined && !edit.channels.includes(channel)) {
      expect(differing).toEqual([]);
      continue;
    }
    expect(differing.filter((index) => reach[index] === 0)).toEqual([]);
    expect(differing.length).toBeGreaterThan(0);
  }
  expect(fingerprint(joined(reference))).toBe(golden.golden);
}
