/**
 * The canonical FFT, held to the golden bits `fft.rs` is held to, in the
 * WebAssembly module and the reference path alike, and the two held to each
 * other over random signals of every size (ADR-0032). The tolerance is zero.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { doublesFingerprint } from '../testing/pcm-fingerprint.js';
import { LARGEST_FFT_SIZE, type CanonicalDsp } from './canonical-dsp.js';
import { sineOfTurns } from './reference/primitives.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/** The fixed signal `fft.rs` transforms for its golden values: two tones and a ramp. */
function signal(size: number): Float64Array {
  return Float64Array.from(
    { length: size },
    (_, n) => 0.5 * sineOfTurns(n * 0.013) + 0.25 * sineOfTurns(n * 0.31 + 0.1) + n / 1e4,
  );
}

/** The bits of a double, as the crates print them. */
function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

describe.each([
  ['the WebAssembly module', (): CanonicalDsp => wasm],
  ['the reference path', (): CanonicalDsp => REFERENCE_DSP],
])('the canonical FFT in %s', (_name, dspOf) => {
  it('gives the golden spectrum and its inverse', () => {
    const fft = expectSuccess(dspOf().createFft(64));
    const real = new Float64Array(fft.bins);
    const imaginary = new Float64Array(fft.bins);
    const back = new Float64Array(64);
    fft.forwardReal(signal(64), real, imaginary);
    fft.inverseReal(real, imaginary, back);
    fft.release();
    // `GOLDEN_FFT` and `GOLDEN_FFT_SAMPLES` in `fft.rs`.
    expect([
      doublesFingerprint(real),
      doublesFingerprint(imaginary),
      doublesFingerprint(back),
    ]).toEqual([0x1ff564c8d5300d41n, 0x5d6920227ef6096dn, 0xc6b6fa66276f359an]);
    expect([bitsOf(real[3] ?? 0), bitsOf(imaginary[3] ?? 0), bitsOf(back[5] ?? 0)]).toEqual([
      0x3fb012217f45fec6n,
      0xbff8abac599ae776n,
      0xbf6a0d9452065060n,
    ]);
  });

  it.each([0, 1, 3, 12, 1.5, -4, Number.NaN, 2 * LARGEST_FFT_SIZE])(
    'refuses a size of %s, with the reason',
    (size) => {
      expect(expectFailureCode(dspOf().createFft(size))).toBe('dsp.fft-size-invalid');
    },
  );

  it('throws the same fault for arrays of the wrong length, having written nothing', () => {
    const fft = expectSuccess(dspOf().createFft(8));
    const real = new Float64Array(5).fill(7);
    const imaginary = new Float64Array(5).fill(7);
    expect(() => {
      fft.forwardReal(new Float64Array(7), real, imaginary);
    }).toThrow(
      'An FFT of 8 samples takes a signal of 8 and spectra of 5, and was given 7, 5 and 5.',
    );
    expect(() => {
      fft.inverseReal(real, new Float64Array(4), new Float32Array(8));
    }).toThrow('was given 8, 5 and 4.');
    expect(real).toEqual(new Float64Array(5).fill(7));
    fft.release();
  });
});

/** A seeded generator in `[−1, 1)`: Marsaglia's xorshift, so every run draws the same signals. */
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

/** The bits of every double in `values`, compared as integers so a sign of zero counts. */
function bitsOfAll(values: Float64Array | Float32Array): BigUint64Array | Uint32Array {
  return values instanceof Float64Array
    ? new BigUint64Array(values.slice().buffer)
    : new Uint32Array(values.slice().buffer);
}

describe('the WebAssembly module and the reference path', () => {
  it.each([2, 4, 8, 16, 32, 64, 128, 256, 512, 1_024, 2_048, 4_096, LARGEST_FFT_SIZE])(
    'agree on every bit of a transform of %s samples and its inverse',
    (size) => {
      const next = noise(size);
      const asDoubles = Float64Array.from({ length: size }, () => next() * 1e3);
      const asSingles = Float32Array.from({ length: size }, () => next());
      const run = (dsp: CanonicalDsp): (BigUint64Array | Uint32Array)[] => {
        const fft = expectSuccess(dsp.createFft(size));
        const results: (BigUint64Array | Uint32Array)[] = [];
        for (const input of [asDoubles, asSingles]) {
          const real = new Float64Array(fft.bins);
          const imaginary = new Float64Array(fft.bins);
          fft.forwardReal(input, real, imaginary);
          const back = new Float64Array(size);
          const backAsSingles = new Float32Array(size);
          fft.inverseReal(real, imaginary, back);
          fft.inverseReal(real, imaginary, backAsSingles);
          results.push(
            bitsOfAll(real),
            bitsOfAll(imaginary),
            bitsOfAll(back),
            bitsOfAll(backAsSingles),
          );
        }
        fft.release();
        return results;
      };
      expect(run(wasm)).toEqual(run(REFERENCE_DSP));
    },
  );
});
