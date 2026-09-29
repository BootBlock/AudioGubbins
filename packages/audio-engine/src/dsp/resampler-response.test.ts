/**
 * The resampler's frequency response, held to what each quality promises in
 * `ResamplingQuality`: flat to its passband edge, and at least its floor down
 * at and above the lower Nyquist frequency, where an alias or an image would
 * otherwise land. Both paths are measured, though they give the same bits,
 * so a promise broken on either fails here.
 *
 * A level is measured by fitting sines and cosines at the frequencies
 * expected in the output by least squares over its middle, away from the
 * ends the filter starts and stops at. The fit averages the rounding of each
 * sample to 32 bits down to far below the deepest floor asserted.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { ResamplingQuality, type CanonicalDsp } from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

/** What each quality promises; see `quality.rs`. */
const PROMISES = [
  {
    name: 'Maximum',
    quality: ResamplingQuality.Maximum,
    edge: 0.97,
    flatDb: 0.00001,
    floorDb: 140,
  },
  { name: 'High', quality: ResamplingQuality.High, edge: 0.95, flatDb: 0.0001, floorDb: 100 },
  { name: 'Draft', quality: ResamplingQuality.Draft, edge: 0.9, flatDb: 0.01, floorDb: 60 },
] as const;

/** Input frames converted for each measurement. */
const INPUT_FRAMES = 48_000;

/** Output frames left out of the fit at each end, past the longest filter's reach. */
const MARGIN = 4_000;

/** The input: a full-scale tone at `frequency`, from the path's own oscillator. */
function toneAt(dsp: CanonicalDsp, frequency: number, rate: number): Float32Array {
  const oscillator = expectSuccess(
    dsp.createOscillator({
      frequency,
      sampleRate: expectSuccess(sampleRate(rate)),
      startPhase: 0,
      amplitude: 1,
    }),
  );
  const samples = new Float32Array(INPUT_FRAMES);
  oscillator.render(samples);
  oscillator.release();
  return samples;
}

function convert(
  dsp: CanonicalDsp,
  input: Float32Array,
  from: number,
  to: number,
  quality: ResamplingQuality,
): Float32Array {
  const resampler = expectSuccess(
    dsp.createResampler({
      from: expectSuccess(sampleRate(from)),
      to: expectSuccess(sampleRate(to)),
      channels: 1,
      quality,
    }),
  );
  resampler.push([input]);
  resampler.finish();
  const output = new Float32Array(Math.ceil((INPUT_FRAMES * to) / from));
  const written = resampler.pull([output]);
  resampler.release();
  expect(written).toBe(output.length);
  return output;
}

/** Solves `a · x = b` in place by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const size = b.length;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row]?.[column] ?? 0) > Math.abs(a[pivot]?.[column] ?? 0)) pivot = row;
    }
    [a[column], a[pivot]] = [a[pivot] ?? [], a[column] ?? []];
    [b[column], b[pivot]] = [b[pivot] ?? 0, b[column] ?? 0];
    const top = a[column] ?? [];
    for (let row = column + 1; row < size; row += 1) {
      const current = a[row] ?? [];
      const factor = (current[column] ?? 0) / (top[column] ?? 1);
      for (let k = column; k < size; k += 1)
        current[k] = (current[k] ?? 0) - factor * (top[k] ?? 0);
      b[row] = (b[row] ?? 0) - factor * (b[column] ?? 0);
    }
  }
  const x = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = b[row] ?? 0;
    for (let k = row + 1; k < size; k += 1) sum -= (a[row]?.[k] ?? 0) * (x[k] ?? 0);
    x[row] = sum / (a[row]?.[row] ?? 1);
  }
  return x;
}

/**
 * The amplitude of each of `frequencies` in `signal` at `rate`, fitted
 * together by least squares over the signal's middle.
 */
function levelsIn(signal: Float32Array, rate: number, frequencies: readonly number[]): number[] {
  const basis = frequencies.flatMap((frequency) => {
    const step = (2 * Math.PI * frequency) / rate;
    return [(n: number) => Math.cos(step * n), (n: number) => Math.sin(step * n)];
  });
  const size = basis.length;
  const normal = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const projected = new Array<number>(size).fill(0);
  const values = new Array<number>(size).fill(0);
  for (let n = MARGIN; n < signal.length - MARGIN; n += 1) {
    basis.forEach((of, index) => {
      values[index] = of(n);
    });
    for (let row = 0; row < size; row += 1) {
      const across = normal[row] ?? [];
      const value = values[row] ?? 0;
      projected[row] = (projected[row] ?? 0) + value * (signal[n] ?? 0);
      for (let column = 0; column < size; column += 1) {
        across[column] = (across[column] ?? 0) + value * (values[column] ?? 0);
      }
    }
  }
  const fitted = solve(normal, projected);
  return frequencies.map((_, index) =>
    Math.hypot(fitted[2 * index] ?? 0, fitted[2 * index + 1] ?? 0),
  );
}

function decibels(level: number): number {
  return 20 * Math.log10(level);
}

/** The conversions measured: down by a little, up by a little, and down by half. */
const CONVERSIONS = [
  { from: 48_000, to: 44_100 },
  { from: 44_100, to: 48_000 },
  { from: 96_000, to: 48_000 },
] as const;

/**
 * Each conversion with a tone just past the lower Nyquist frequency, and a
 * little and a lot further into the stopband.
 */
const PAST_NYQUIST = CONVERSIONS.flatMap(({ from, to }) =>
  [
    { beyond: '50 Hz', share: 0 },
    { beyond: '1 %', share: 0.01 },
    { beyond: '5 %', share: 0.05 },
  ].map(({ beyond, share }) => ({
    from,
    to,
    beyond,
    past: share === 0 ? 50 : (share * Math.min(from, to)) / 2,
  })),
);

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('the resampler in %s', (_path, dspOf) => {
  describe.each(PROMISES)('at $name quality', ({ quality, edge, flatDb, floorDb }) => {
    it.each(CONVERSIONS)(
      'passes a tone at the passband edge at its level, $from Hz to $to Hz',
      ({ from, to }) => {
        const frequency = (edge * Math.min(from, to)) / 2;
        const output = convert(dspOf(), toneAt(dspOf(), frequency, from), from, to, quality);
        const [level = 0] = levelsIn(output, to, [frequency]);
        expect(Math.abs(decibels(level))).toBeLessThan(flatDb);
      },
    );

    it.each(PAST_NYQUIST)(
      'keeps what lies $beyond past the lower Nyquist frequency below its floor, $from Hz to $to Hz',
      ({ from, to, past }) => {
        const nyquist = Math.min(from, to) / 2;
        // Down, a tone `past` hertz above the output's Nyquist frequency would
        // alias to as far below it. Up, a tone `past` hertz below the input's
        // Nyquist frequency has its image as far above it.
        const [input, unwanted, wanted] =
          to < from
            ? [nyquist + past, to - (nyquist + past), undefined]
            : [nyquist - past, from - (nyquist - past), nyquist - past];
        const output = convert(dspOf(), toneAt(dspOf(), input, from), from, to, quality);
        const frequencies = wanted === undefined ? [unwanted] : [unwanted, wanted];
        const [level = 1] = levelsIn(output, to, frequencies);
        expect(decibels(level)).toBeLessThan(-floorDb);
      },
    );
  });
});
