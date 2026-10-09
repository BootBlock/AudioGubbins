/**
 * The WebAssembly module and the reference path agree on every bit every
 * measuring object writes, over seeded random signals in random chunks and
 * random pulls, and over signals poisoned with NaN and infinities, which
 * neither may fail on (ADR-0032). WebAssembly leaves a NaN's payload to the
 * machine, so every NaN is compared as one value; every other bit counts.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate, type SampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { DetectorKind, type DetectorSettings } from './canonical-analysis.js';
import type { CanonicalDsp } from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/** A seeded generator in `[−1, 1)`: Marsaglia's xorshift. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2_147_483_648 - 1;
  };
}

/** A whole number from 1 to `most`, drawn from `next`. */
function upTo(next: () => number, most: number): number {
  return 1 + Math.floor(((next() + 1) / 2) * most);
}

/**
 * `frames` frames of `channels` channels of noise over a tone, the tone's
 * level wandering, with spikes, and, where `poisoned`, NaN and infinities.
 */
function signal(seed: number, channels: number, frames: number, poisoned: boolean): Float32Array[] {
  const next = noise(seed);
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: frames }, (_, n) => {
      if (poisoned && n % 997 === 13 * (channel + 1)) {
        return [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY][n % 3] ?? 0;
      }
      const spike = n % 1_501 === 700 ? 0.8 : 0;
      const level = 0.25 + 0.2 * Math.sin(n / 4_000);
      return 0.2 * next() + level * Math.sin(n * (0.03 + 0.01 * channel)) + spike;
    }),
  );
}

/** The bits of every value, each NaN as the one quiet NaN. */
function bitsOf(values: readonly number[]): bigint[] {
  const view = new DataView(new ArrayBuffer(8));
  return values.map((value) => {
    view.setFloat64(0, Number.isNaN(value) ? Number.NaN : value);
    return view.getBigUint64(0);
  });
}

/** Feeds `planar` to `push` in chunks of random length drawn from `seed`, calling `after` after each. */
function inChunks(
  planar: readonly Float32Array[],
  seed: number,
  most: number,
  push: (chunk: Float32Array[]) => void,
  after: () => void,
): void {
  const next = noise(seed);
  const frames = planar[0]?.length ?? 0;
  for (let start = 0; start < frames;) {
    const end = Math.min(start + upTo(next, most), frames);
    push(planar.map((channel) => channel.subarray(start, end)));
    after();
    start = end;
  }
}

/** Runs `scenario` on both implementations and expects the same bits, and some of them. */
function agree(scenario: (dsp: CanonicalDsp) => number[]): void {
  const reference = scenario(REFERENCE_DSP);
  expect(reference.length).toBeGreaterThan(0);
  expect(bitsOf(scenario(wasm))).toEqual(bitsOf(reference));
}

const rate = (hertz: number): SampleRate => expectSuccess(sampleRate(hertz));

describe.each([false, true])('with poisoned input %s, the two paths agree on', (poisoned) => {
  it.each([
    [64, 17],
    [512, 512],
    [2_048, 300],
  ])('every STFT frame of %s samples %s apart', (size, hop) => {
    const planar = signal(size + hop, 3, 12_000, poisoned);
    agree((dsp) => {
      const stft = expectSuccess(dsp.createStft({ channels: 3, size, hop }));
      const first = new Float64Array(3 * stft.bins);
      const second = new Float64Array(3 * stft.bins);
      const out: number[] = [];
      let frame = 0;
      inChunks(
        planar,
        size,
        700,
        (chunk) => {
          stft.push(chunk);
        },
        () => {
          while (
            frame % 3 === 0 ? stft.pullComplex(first, second) : stft.pullPolar(first, second)
          ) {
            out.push(...first, ...second);
            frame += 1;
          }
        },
      );
      stft.release();
      return out;
    });
  });

  it.each([44_100, 48_000, 96_000, 192_000])('every peak reading at %s Hz', (hertz) => {
    const planar = signal(hertz, 2, 20_000, poisoned);
    agree((dsp) => {
      const meter = expectSuccess(dsp.createPeakMeter({ channels: 2, sampleRate: rate(hertz) }));
      const reading = new Float64Array(8);
      const out: number[] = [];
      inChunks(
        planar,
        hertz,
        900,
        (chunk) => {
          meter.push(chunk);
        },
        () => {
          meter.read(reading);
          out.push(...reading);
        },
      );
      meter.release();
      return out;
    });
  });

  it.each([11_025, 44_100, 48_000])('every loudness value at %s Hz in 5.1', (hertz) => {
    const planar = signal(hertz, 6, Math.round(hertz * 3.7), poisoned);
    agree((dsp) => {
      const meter = expectSuccess(
        dsp.createLoudnessMeter({ sampleRate: rate(hertz), layout: StandardLayouts.surround5_1 }),
      );
      const series = new Float64Array(6);
      const out: number[] = [];
      inChunks(
        planar,
        hertz,
        5_000,
        (chunk) => {
          meter.push(chunk);
        },
        () => {
          for (let pairs = meter.pullSeries(series); pairs > 0; pairs = meter.pullSeries(series)) {
            out.push(...series.subarray(0, 2 * pairs));
          }
        },
      );
      const { integrated, range } = meter.read();
      meter.release();
      return [...out, integrated, range];
    });
  });

  const basis = { channels: 2, sampleRate: rate(48_000) } as const;
  it.each<DetectorSettings>([
    { ...basis, kind: DetectorKind.Clicks, block: 256, sensitivity: 4 },
    { ...basis, kind: DetectorKind.Hum, size: 4_096, hop: 1_500, searchWidth: 5, floorWidth: 30 },
    { ...basis, kind: DetectorKind.NoiseFloor, frame: 480, hop: 160, percentile: 0.1, history: 40 },
    { ...basis, kind: DetectorKind.Clipping, block: 600, epsilon: 0.01, minimumRun: 2 },
    { ...basis, kind: DetectorKind.DcOffset, window: 1_000, hop: 333 },
    {
      ...basis,
      kind: DetectorKind.Transients,
      size: 512,
      hop: 256,
      history: 9,
      multiplier: 2,
      offset: 0.05,
    },
    { ...basis, kind: DetectorKind.Silence, block: 700, threshold: 0.2 },
  ])('every $kind record', (settings) => {
    const planar = signal(settings.kind.length, 2, 30_000, poisoned);
    agree((dsp) => {
      const features = expectSuccess(dsp.createDetectorFeatures(settings));
      const width = features.recordWidth;
      const next = noise(width);
      const out: number[] = [];
      inChunks(
        planar,
        width + 1,
        2_000,
        (chunk) => {
          features.push(chunk);
        },
        () => {
          for (;;) {
            const records = new Float64Array(upTo(next, 5) * width);
            const pulled = features.pull(records);
            out.push(...records.subarray(0, pulled * width));
            if (pulled === 0) break;
          }
        },
      );
      features.release();
      return out;
    });
  });
});
