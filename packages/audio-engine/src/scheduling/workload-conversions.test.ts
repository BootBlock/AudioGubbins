import { describe, expect, it } from 'vitest';

import { sampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { CoefficientStrategy, ResamplingQuality } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { estimateWorkload } from './workload.js';

const RATE = expectSuccess(sampleRate(48_000));

describe('estimating a workload with conversions of rate', () => {
  it('counts the memory of each table and the conversions that compute their taps', () => {
    const report = (budget: number | undefined) => {
      const resampler = expectSuccess(
        REFERENCE_DSP.createResampler({
          from: expectSuccess(sampleRate(44_100)),
          to: RATE,
          channels: 2,
          quality: ResamplingQuality.Maximum,
          ...(budget === undefined ? {} : { coefficientBudgetBytes: budget }),
        }),
      );
      resampler.release();
      return resampler.coefficients;
    };
    const tabled = report(undefined);
    const computed = report(0);
    expect(tabled.strategy).toBe(CoefficientStrategy.Table);

    const estimate = expectSuccess(
      estimateWorkload({
        frames: expectSuccess(sampleCount(48_000)),
        channels: 2,
        sampleRate: RATE,
        conversions: [tabled, computed, tabled],
      }),
    );

    expect(estimate.coefficientTableBytes).toBe(2 * tabled.tableBytes);
    expect(estimate.computedConversions).toBe(1);
  });
});
