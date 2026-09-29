import { describe, expect, it } from 'vitest';

import { sampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { CoefficientStrategy, ResamplingQuality } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { PerformanceProfile, PRESET_SETTINGS } from '../profiles/performance-profile.js';
import { conversionTableBudget, estimateWorkload, planChunks } from './workload.js';

const RATE = expectSuccess(sampleRate(48_000));

/** What a conversion from 44.1 kHz to the render's rate reports, its table built. */
function tabledConversion() {
  const resampler = expectSuccess(
    REFERENCE_DSP.createResampler({
      from: expectSuccess(sampleRate(44_100)),
      to: RATE,
      channels: 2,
      quality: ResamplingQuality.Maximum,
    }),
  );
  resampler.release();
  return resampler.coefficients;
}

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

describe('planning a render whose conversions hold tables', () => {
  const settings = PRESET_SETTINGS[PerformanceProfile.Balanced];
  const shape = { frames: expectSuccess(sampleCount(48_000)), channels: 2, sampleRate: RATE };

  it('counts the tables in the memory holding the render whole would need', () => {
    const table = tabledConversion();
    // Room for the audio whole, and not for the audio and the table.
    const audioBytes = 48_000 * 2 * 4;
    const plan = expectSuccess(
      planChunks({ ...shape, settings, conversions: [table], availableMemoryBytes: audioBytes }),
    );

    expect(table.tableBytes).toBeGreaterThan(0);
    expect(plan.warnings.map((warning) => warning.resource)).toEqual(['memory']);
    expect(plan.warnings[0]?.needed).toBe(audioBytes + table.tableBytes);
  });

  it('fits each chunk in the memory the tables leave', () => {
    const table = tabledConversion();
    const plan = expectSuccess(
      planChunks({
        ...shape,
        settings,
        conversions: [table],
        availableMemoryBytes: table.tableBytes + 800,
      }),
    );

    // 800 bytes is 100 frames of two channels of 32-bit samples.
    expect(plan.chunkFrames).toBe(100);
  });

  it('gives the tables what the measurement leaves beside the chunk, and nothing unmeasured', () => {
    const plan = expectSuccess(planChunks({ ...shape, settings, availableMemoryBytes: 1e6 }));

    expect(conversionTableBudget({ channels: 2, availableMemoryBytes: 1e6 }, plan)).toBe(
      1e6 - plan.chunkFrames * 2 * 4,
    );
    expect(conversionTableBudget({ channels: 2, availableMemoryBytes: 100 }, plan)).toBe(0);
    expect(conversionTableBudget({ channels: 2, availableMemoryBytes: undefined }, plan)).toBe(
      undefined,
    );
  });
});
