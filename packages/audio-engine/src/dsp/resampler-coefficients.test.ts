/**
 * The resampler's two ways of coming by its taps (REQ-ARCH-087): a table
 * where it fits in the budget the caller measured, and computing them as it
 * goes where it does not. Both give the same bits on both paths; the budget
 * alone decides; and the report says which was taken and what it holds.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import {
  CoefficientStrategy,
  ResamplingQuality,
  type CanonicalDsp,
  type CanonicalResampler,
} from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

function resamplerOn(
  dsp: CanonicalDsp,
  from: number,
  to: number,
  budget: number | undefined,
): CanonicalResampler {
  return expectSuccess(
    dsp.createResampler({
      from: expectSuccess(sampleRate(from)),
      to: expectSuccess(sampleRate(to)),
      channels: 2,
      quality: ResamplingQuality.High,
      ...(budget === undefined ? {} : { coefficientBudgetBytes: budget }),
    }),
  );
}

/** Converts a ramp on the left and its inverse on the right. */
function convert(resampler: CanonicalResampler, frames: number): Float32Array[] {
  const left = Float32Array.from({ length: frames }, (_, index) => ((index % 97) - 48) / 64);
  resampler.push([left, left.map((sample) => -sample)]);
  resampler.finish();
  const out = [new Float32Array(2 * frames), new Float32Array(2 * frames)];
  const written = resampler.pull(out);
  resampler.release();
  return out.map((channel) => channel.slice(0, written));
}

/** A table's bytes: every phase's `2K + 1` taps of eight bytes, and a flag per phase. */
function tableBytes(lookahead: number, phases: number): number {
  return ((2 * lookahead + 1) * 8 + 1) * phases;
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('the resampler on %s', (_path, dspOf) => {
  it.each([
    { from: 44_100, to: 48_000 },
    { from: 44_099, to: 48_000 },
    { from: 48_000, to: 48_000 },
  ])(
    'writes the same bits from its table and computing its taps, $from Hz to $to Hz',
    ({ from, to }) => {
      const tabled = resamplerOn(dspOf(), from, to, undefined);
      const computed = resamplerOn(dspOf(), from, to, 0);
      expect(tabled.coefficients.strategy).toBe(CoefficientStrategy.Table);
      expect(computed.coefficients.strategy).toBe(CoefficientStrategy.Computed);
      expect(convert(computed, 3_000)).toEqual(convert(tabled, 3_000));
    },
  );

  it('keeps a table exactly when the budget holds it, and reports its size', () => {
    // 44.1 kHz to 48 kHz has 160 phases.
    const unbounded = resamplerOn(dspOf(), 44_100, 48_000, undefined);
    const bytes = tableBytes(unbounded.lookahead, 160);
    expect(unbounded.coefficients).toEqual({
      strategy: CoefficientStrategy.Table,
      tableBytes: bytes,
    });
    unbounded.release();

    const at = resamplerOn(dspOf(), 44_100, 48_000, bytes);
    expect(at.coefficients).toEqual({ strategy: CoefficientStrategy.Table, tableBytes: bytes });
    at.release();

    const below = resamplerOn(dspOf(), 44_100, 48_000, bytes - 1);
    expect(below.coefficients).toEqual({ strategy: CoefficientStrategy.Computed, tableBytes: 0 });
    below.release();
  });

  it('refuses a budget that is not a number of bytes', () => {
    for (const budget of [-1, Number.NaN]) {
      const made = dspOf().createResampler({
        from: expectSuccess(sampleRate(44_100)),
        to: expectSuccess(sampleRate(48_000)),
        channels: 1,
        quality: ResamplingQuality.Draft,
        coefficientBudgetBytes: budget,
      });
      expect(expectFailureCode(made)).toBe('dsp.resampler-budget-invalid');
    }
  });
});
