/**
 * The canonical scalar primitives ADR-0061 admits, held to the golden bits the
 * crates are held to, in the WebAssembly module and the reference path alike,
 * and the two held to each other over inputs from every corner of the doubles.
 *
 * Every golden value here is also asserted by `cargo test` in
 * `crates/dsp-core`, beside the function it holds, so a change to the order of
 * operations in either language fails at least one of them (ADR-0032). The
 * tolerance is zero.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { decibelsToGain, gainToDecibels } from './reference/decibels.js';
import { exp } from './reference/exponential.js';
import { ln, log10, log2 } from './reference/logarithm.js';
import { pow } from './reference/power.js';
import { arctangentTurns, cosineOfTurns, tangentOfTurns } from './reference/trigonometry.js';
import { readDspExports, type DspScalars } from './wasm/dsp-exports.js';

const REFERENCE: DspScalars = {
  exp,
  ln,
  log2,
  log10,
  pow,
  decibelsToGain,
  gainToDecibels,
  cosineOfTurns,
  tangentOfTurns,
  arctangentTurns,
};

let wasm: DspScalars;

beforeAll(async () => {
  wasm = expectSuccess(readDspExports(await dspModuleExports())).scalars;
});

/** The bits of a double, as the crates print them. */
function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

describe.each([
  ['the WebAssembly module', (): DspScalars => wasm],
  ['the reference path', (): DspScalars => REFERENCE],
])('the canonical primitives in %s', (_name, scalarsOf) => {
  it('give the golden exponential bits', () => {
    const inputs = [1, -1, 0.5, 10, -20, 700, -740, 1e-10];
    // `GOLDEN_EXP_BITS` in `exponential.rs`.
    expect(inputs.map((x) => bitsOf(scalarsOf().exp(x)))).toEqual([
      0x4005bf0a8b145769n,
      0x3fd78b56362cef38n,
      0x3ffa61298e1e069cn,
      0x40d5829dcf950560n,
      0x3e21b48655f37267n,
      0x7f0d945df4f8ec8en,
      0x55n,
      0x3ff000000006df38n,
    ]);
  });

  it('give the golden logarithm bits', () => {
    const { ln: natural, log2: binary, log10: decimal } = scalarsOf();
    const inputs = [0.1, 3, 1e-310, 1.5e300, 0.999999, 1234.5];
    // `GOLDEN_LOGARITHM_BITS` in `logarithm.rs`: ln, log2 and log10 of each.
    expect(
      inputs.flatMap((x) => [bitsOf(natural(x)), bitsOf(binary(x)), bitsOf(decimal(x))]),
    ).toEqual([
      0xc0026bb1bbb55515n,
      0xc00a934f0979a371n,
      0xbff0000000000000n,
      0x3ff193ea7aad030bn,
      0x3ff95c01a39fbd68n,
      0x3fde8927964fd5fdn,
      0xc0864e69394d9508n,
      0xc0901730dabca5f6n,
      0xc073600000000000n,
      0x40859972ac7617a8n,
      0x408f294e9fec5b68n,
      0x4072c2d145116c17n,
      0xbeb0c6f82d74d230n,
      0xbeb83454c4167fe4n,
      0xbe9d25204937a8c5n,
      0x401c79436f818745n,
      0x40248a17937959fbn,
      0x4008bb5faece0c80n,
    ]);
  });

  it('give the golden power bits', () => {
    const pairs = [
      [2, 0.5],
      [10, 0.3],
      [0.5, 3.7],
      [1.00001, 50_000],
      [123.456, -2.5],
      [0.99, 70_000],
    ] as const;
    // `GOLDEN_POW_BITS` in `power.rs`.
    expect(pairs.map(([x, y]) => bitsOf(scalarsOf().pow(x, y)))).toEqual([
      0x3ff6a09e667f3bccn,
      0x3fffec982d5bb8afn,
      0x3fb3b2c47bff8328n,
      0x3ffa61253bb07b56n,
      0x3ed8c47085e54025n,
      0x80566adc708a35n,
    ]);
  });

  it('give the golden decibel bits', () => {
    const { decibelsToGain: toGain, gainToDecibels: toDecibels } = scalarsOf();
    // `GOLDEN_DECIBEL_BITS` in `decibels.rs`: gains, then decibels.
    expect([
      ...[-6, 3, -96.5, 0.1].map((decibels) => bitsOf(toGain(decibels))),
      ...[0.5, 2, 1e-5, 0.707].map((gain) => bitsOf(toDecibels(gain))),
    ]).toEqual([
      0x3fe009b9cf334252n,
      0x3ff699c0f7e86e10n,
      0x3eef60daa090e824n,
      0x3ff02f6df015a0f1n,
      0xc018151824c7587fn,
      0x4018151824c7587fn,
      0xc059000000000000n,
      0xc00817c7e338c5acn,
    ]);
  });

  it('give the golden trigonometry bits', () => {
    const { cosineOfTurns: cosine, tangentOfTurns: tangent, arctangentTurns: angle } = scalarsOf();
    const points = [
      [1, 2],
      [-3, -4],
      [0.3, -0.1],
      [5, 4.9],
      [-1e-5, 7],
    ] as const;
    // `GOLDEN_TRIGONOMETRY_BITS` in `trigonometry.rs`.
    expect([
      ...[0.1, 0.3, 0.6, -0.2, 12.345].flatMap((turns) => [
        bitsOf(cosine(turns)),
        bitsOf(tangent(turns)),
      ]),
      ...points.map(([y, x]) => bitsOf(angle(y, x))),
    ]).toEqual([
      0x3fe9e3779b97f4a8n,
      0x3fe73fd61d9df543n,
      0xbfd3c6ef372fe94en,
      0xc0089f188bdcd7b0n,
      0xbfe9e3779b97f4a8n,
      0x3fe73fd61d9df540n,
      0x3fd3c6ef372fe954n,
      0xc0089f188bdcd7a8n,
      0xbfe1fc9647b00108n,
      0xbff78b14baaf8d93n,
      0x3fb2e4051d9df309n,
      0xbfd972028ecef984n,
      0x3fd346feb898833en,
      0x3fc034ad48780d26n,
      0xbe8e842cb125000cn,
    ]);
  });

  it('give the stated special values', () => {
    const scalars = scalarsOf();
    const zero = bitsOf(0);
    expect(bitsOf(scalars.exp(0))).toBe(bitsOf(1));
    expect(scalars.exp(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(scalars.exp(710)).toBe(Number.POSITIVE_INFINITY);
    expect(bitsOf(scalars.ln(1))).toBe(zero);
    expect(scalars.ln(-0)).toBe(Number.NEGATIVE_INFINITY);
    expect(scalars.ln(-1)).toBeNaN();
    expect(scalars.log2(2 ** -1074)).toBe(-1074);
    expect(scalars.log10(1e22)).toBe(22);
    expect(scalars.pow(Number.NaN, 0)).toBe(1);
    expect(scalars.pow(1, Number.NaN)).toBe(1);
    expect(scalars.pow(-8, 1 / 3)).toBeNaN();
    expect(bitsOf(scalars.pow(-0, 3))).toBe(zero);
    expect(scalars.decibelsToGain(20)).toBe(10);
    expect(scalars.gainToDecibels(10)).toBe(20);
    expect(bitsOf(scalars.cosineOfTurns(0.25))).toBe(zero);
    expect(scalars.cosineOfTurns(0.5)).toBe(-1);
    expect(scalars.tangentOfTurns(0.125)).toBe(1);
    expect(scalars.tangentOfTurns(0.75)).toBe(Number.NEGATIVE_INFINITY);
    expect(bitsOf(scalars.arctangentTurns(-0, 1))).toBe(bitsOf(-0));
    expect(scalars.arctangentTurns(-0, -1)).toBe(0.5);
    expect(scalars.arctangentTurns(-3, -3)).toBe(-0.375);
    expect(scalars.arctangentTurns(Number.POSITIVE_INFINITY, 1)).toBe(0.25);
  });
});

/** A seeded generator of 32-bit words: Marsaglia's xorshift, so every run draws the same inputs. */
function words(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/**
 * Doubles from every corner: any bit pattern (subnormals, infinities and NaNs
 * included), and the ranges each primitive is used in.
 */
function inputs(seed: number, count: number, low: number, high: number): number[] {
  const next = words(seed);
  const view = new DataView(new ArrayBuffer(8));
  return Array.from({ length: count }, (_, index) => {
    if (index % 2 === 0) {
      view.setUint32(0, next());
      view.setUint32(4, next());
      return view.getFloat64(0);
    }
    return low + (next() / 4_294_967_296) * (high - low);
  });
}

/** Whether two answers are one: the same bits, or both NaN, whose payloads no rule fixes. */
function same(left: number, right: number): boolean {
  return (Number.isNaN(left) && Number.isNaN(right)) || bitsOf(left) === bitsOf(right);
}

describe('the WebAssembly module and the reference path', () => {
  const COUNT = 20_000;

  it.each([
    ['exp', 1, -800, 800],
    ['ln', 2, 0, 4],
    ['log2', 3, 0, 1e6],
    ['log10', 4, 0, 1e-3],
    ['decibelsToGain', 5, -200, 50],
    ['gainToDecibels', 6, 0, 2],
    ['cosineOfTurns', 7, -3, 3],
    ['tangentOfTurns', 8, -3, 3],
  ] as const)('agree on every bit of %s', (name, seed, low, high) => {
    const disagreements = inputs(seed, COUNT, low, high).flatMap((x) => {
      const fromModule = wasm[name](x);
      const fromReference = REFERENCE[name](x);
      return same(fromModule, fromReference) ? [] : [`${name}(${String(x)})`];
    });
    expect(disagreements.slice(0, 10)).toEqual([]);
  });

  it.each([
    ['pow', 9, 0, 5, -60, 60],
    ['arctangentTurns', 10, -10, 10, -10, 10],
  ] as const)(
    'agree on every bit of %s',
    (name, seed, firstLow, firstHigh, secondLow, secondHigh) => {
      const firsts = inputs(seed, COUNT, firstLow, firstHigh);
      const seconds = inputs(seed + 100, COUNT, secondLow, secondHigh);
      const disagreements = firsts.flatMap((first, index) => {
        const second = seconds[index] ?? 0;
        const fromModule = wasm[name](first, second);
        const fromReference = REFERENCE[name](first, second);
        return same(fromModule, fromReference)
          ? []
          : [`${name}(${String(first)}, ${String(second)})`];
      });
      expect(disagreements.slice(0, 10)).toEqual([]);
    },
  );
});
