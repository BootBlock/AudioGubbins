/**
 * The measuring objects of `crates/analysis`, held to the golden bits the
 * crate's own tests are held to, in the WebAssembly module and the reference
 * path alike (ADR-0032). Each run here is the crate's `golden_run`, chunk for
 * chunk, and each constant is the crate's; the tolerance is zero.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { ChannelRole, sampleRate, type SampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { DetectorKind, type DetectorSettings, StftWindow } from './canonical-analysis.js';
import type { CanonicalDsp } from './canonical-dsp.js';
import { kWeighting } from './reference/analysis/k-weighting.js';
import { sineOfTurns } from './reference/primitives.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/** `signals::golden` in the crate: per channel two tones and a ramp, rounded once to f32. */
function golden(channels: number, frames: number): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from(
      { length: frames },
      (_, n) =>
        0.5 * sineOfTurns(n * (0.013 + channel * 0.01)) +
        0.25 * sineOfTurns(n * 0.31 + 0.1) +
        n / 1e5,
    ),
  );
}

/** Frames `start` to `end` of each channel, as one chunk. */
function chunkOf(planar: readonly Float32Array[], start: number, end: number): Float32Array[] {
  return planar.map((channel) => channel.subarray(start, end));
}

/** FNV-1a over the little-endian bits of each double, as `fingerprint::of` computes it. */
function fingerprint(values: readonly number[]): bigint {
  const view = new DataView(Float64Array.from(values).buffer);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < values.length; index += 1) {
    const word = view.getBigUint64(index * 8, true);
    for (let shift = 0n; shift < 64n; shift += 8n) {
      hash ^= (word >> shift) & 0xffn;
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
  }
  return hash;
}

const rate = (hertz: number): SampleRate => expectSuccess(sampleRate(hertz));

/** `GOLDEN_SETTINGS` in `detectors/tests.rs`, over two channels, with `GOLDEN_DETECTORS`. */
const DETECTOR_GOLDENS: readonly (readonly [DetectorSettings, number, bigint])[] = [
  [
    {
      kind: DetectorKind.Clicks,
      channels: 2,
      sampleRate: rate(48_000),
      block: 512,
      sensitivity: 3,
    },
    592,
    0xbfe1aa526cca3f44n,
  ],
  [
    {
      kind: DetectorKind.Hum,
      channels: 2,
      sampleRate: rate(8_000),
      size: 1_024,
      hop: 512,
      searchWidth: 20,
      floorWidth: 60,
    },
    10,
    0x2cb79b35b9c532dan,
  ],
  [
    {
      kind: DetectorKind.NoiseFloor,
      channels: 2,
      sampleRate: rate(48_000),
      frame: 256,
      hop: 100,
      percentile: 0.2,
      history: 7,
    },
    58,
    0x6def323ea2223e8bn,
  ],
  [
    {
      kind: DetectorKind.Clipping,
      channels: 2,
      sampleRate: rate(48_000),
      block: 300,
      epsilon: 0.05,
      minimumRun: 1,
    },
    410,
    0xa107dbccccd74af2n,
  ],
  [
    { kind: DetectorKind.DcOffset, channels: 2, sampleRate: rate(48_000), window: 500, hop: 123 },
    45,
    0xbbf127b93ff5a2c7n,
  ],
  [
    {
      kind: DetectorKind.Transients,
      channels: 2,
      sampleRate: rate(48_000),
      size: 256,
      hop: 128,
      history: 5,
      multiplier: 1.5,
      offset: 0.01,
    },
    45,
    0x2a0fef68f76afd80n,
  ],
  [
    {
      kind: DetectorKind.Silence,
      channels: 2,
      sampleRate: rate(48_000),
      block: 300,
      threshold: 0.05,
    },
    15,
    0xbf2bc4322fdbe698n,
  ],
];

describe('the K-weighting the reference path designs', () => {
  it('gives the golden coefficients at 44.1, 48, 96 and 8 kHz', () => {
    const coefficients = [44_100, 48_000, 96_000, 8_000].flatMap((hertz) =>
      kWeighting(hertz).flatMap((stage) => [stage.b0, stage.b1, stage.b2, stage.a1, stage.a2]),
    );
    // `GOLDEN_K_WEIGHTING` in `k_weighting.rs`.
    expect(fingerprint(coefficients)).toBe(0xa2aafa38a286f78cn);
  });
});

describe.each([
  ['the WebAssembly module', (): CanonicalDsp => wasm],
  ['the reference path', (): CanonicalDsp => REFERENCE_DSP],
])('the measuring objects in %s', (_name, dspOf) => {
  it.each([
    // `GOLDEN_STFT` in `stft.rs`.
    [StftWindow.Hann, [0x7ce28db813909753n, 0xe3df76afe3a05176n]],
    // `GOLDEN_STFT_BLACKMAN_HARRIS` in `stft.rs`.
    [StftWindow.BlackmanHarris, [0x907707fcc42f2c34n, 0x992ba50ac9713cc6n]],
  ])('give the golden STFT frames through the %s window, polar and complex', (window, expected) => {
    const planar = golden(2, 1_000);
    const stft = expectSuccess(dspOf().createStft({ channels: 2, size: 256, hop: 96, window }));
    const first = new Float64Array(2 * stft.bins);
    const second = new Float64Array(2 * stft.bins);
    const polar: number[] = [];
    const complex: number[] = [];
    let frame = 0;
    for (let start = 0; start < 1_000; start += 97) {
      stft.push(chunkOf(planar, start, Math.min(start + 97, 1_000)));
      for (;;) {
        const pulled =
          frame % 2 === 0 ? stft.pullPolar(first, second) : stft.pullComplex(first, second);
        if (!pulled) break;
        (frame % 2 === 0 ? polar : complex).push(...first, ...second);
        frame += 1;
      }
    }
    stft.release();
    expect(frame).toBe(8);
    expect([fingerprint(polar), fingerprint(complex)]).toEqual(expected);
  });

  it.each([
    [44_100, 0x4e775d9b0dd1f486n],
    [96_000, 0x33446b5091b097fcn],
  ])('give the golden peaks at %s Hz', (hertz, expected) => {
    const planar = golden(3, 1_000);
    const meter = expectSuccess(dspOf().createPeakMeter({ channels: 3, sampleRate: rate(hertz) }));
    const reading = new Float64Array(12);
    const readings: number[] = [];
    for (let start = 0; start < 1_000; start += 61) {
      meter.push(chunkOf(planar, start, Math.min(start + 61, 1_000)));
      meter.read(reading);
      readings.push(...reading);
    }
    meter.release();
    // `GOLDEN_PEAKS` in `peak.rs`.
    expect(fingerprint(readings)).toBe(expected);
  });

  it('gives the golden loudness series, integrated loudness and range', () => {
    const planar = golden(3, 9_000);
    // Weighted 1, 1.41 and 0, as the crate's golden run weights them.
    const layout = {
      roles: [ChannelRole.Left, ChannelRole.SurroundLeft, ChannelRole.LowFrequency],
    } as const;
    const meter = expectSuccess(dspOf().createLoudnessMeter({ sampleRate: rate(11_025), layout }));
    const series = new Float64Array(64);
    const values: number[] = [];
    for (const gain of [0.25, 0.5, 0.75, 1]) {
      for (let start = 0; start < 9_000; start += 1_237) {
        const end = Math.min(start + 1_237, 9_000);
        meter.push(planar.map((channel) => channel.slice(start, end).map((s) => s * gain)));
        const pairs = meter.pullSeries(series);
        values.push(...series.subarray(0, 2 * pairs));
      }
    }
    const { integrated, range } = meter.read();
    meter.release();
    values.push(integrated, range);
    // `GOLDEN_LOUDNESS` in `loudness/tests.rs`.
    expect(fingerprint(values)).toBe(0xf32dd7bdf3fbc07cn);
  });

  it.each(
    DETECTOR_GOLDENS.map(
      ([settings, count, expected]) => [settings.kind, settings, count, expected] as const,
    ),
  )('give the golden %s features', (_kind, settings, count, expected) => {
    const planar = golden(2, 6_000);
    const features = expectSuccess(dspOf().createDetectorFeatures(settings));
    const width = features.recordWidth;
    const records = new Float64Array(3 * width);
    const all: number[] = [];
    for (let start = 0; start < 6_000; start += 333) {
      features.push(chunkOf(planar, start, Math.min(start + 333, 6_000)));
      for (let pulled = features.pull(records); pulled > 0; pulled = features.pull(records)) {
        all.push(...records.subarray(0, pulled * width));
      }
    }
    features.release();
    // `GOLDEN_DETECTORS` in `detectors/tests.rs`.
    expect([all.length / width, fingerprint(all)]).toEqual([count, expected]);
  });
});
