import { describe, expect, it } from 'vitest';

import { sampleCount, sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { PerformanceProfile, PRESET_SETTINGS } from '../profiles/performance-profile.js';
import { ProcessingMode } from '../profiles/processing-mode.js';
import { JobPriority } from './priority-scheduler.js';
import { assessRender, type RenderStrategyRequest } from './render-strategy.js';

/** Ten seconds of stereo at 48 kHz, as the test signal renders. */
const TEN_SECONDS: RenderStrategyRequest = {
  frames: expectSuccess(sampleCount(480_000)),
  channels: 2,
  sampleRate: expectSuccess(sampleRate(48_000)),
  settings: PRESET_SETTINGS[PerformanceProfile.Balanced],
};

describe('assessing a render', () => {
  it('renders offline in the foreground, in the profile’s chunks, where nothing is warned of', () => {
    const assessment = expectSuccess(assessRender(TEN_SECONDS));
    expect(assessment.safer).toBeUndefined();
    expect(assessment.strategy.choice).toMatchObject({
      mode: ProcessingMode.FinalOffline,
      overridden: false,
    });
    expect(assessment.strategy.priority).toBe(JobPriority.Foreground);
    expect(assessment.strategy.plan).toEqual({ chunkFrames: 24_000, chunks: 20, warnings: [] });
  });

  it('follows the profile’s chunk length, and a Custom one', () => {
    const custom = {
      ...PRESET_SETTINGS[PerformanceProfile.Balanced],
      renderChunkMilliseconds: 250,
    };
    expect(
      expectSuccess(assessRender({ ...TEN_SECONDS, settings: custom })).strategy.plan.chunkFrames,
    ).toBe(12_000);
  });

  it('moves into the background by itself where the processor was measured too slow', () => {
    const assessment = expectSuccess(assessRender({ ...TEN_SECONDS, measuredCostRatio: 2 }));
    expect(assessment.strategy.choice.mode).toBe(ProcessingMode.BackgroundOffline);
    expect(assessment.strategy.priority).toBe(JobPriority.Background);
    expect(assessment.strategy.plan.warnings.map((warning) => warning.resource)).toEqual([
      'compute',
    ]);
    // The safer strategy is the one taken, so there is nothing to decide.
    expect(assessment.safer).toBeUndefined();
  });

  it('keeps the foreground a person chose over the warning, and offers the background beside it', () => {
    const assessment = expectSuccess(
      assessRender({
        ...TEN_SECONDS,
        measuredCostRatio: 2,
        override: ProcessingMode.FinalOffline,
      }),
    );
    expect(assessment.strategy.priority).toBe(JobPriority.Foreground);
    expect(assessment.strategy.choice.overridden).toBe(true);
    expect(assessment.safer?.priority).toBe(JobPriority.Background);
    expect(assessment.safer?.choice.mode).toBe(ProcessingMode.BackgroundOffline);
    expect(assessment.safer?.choice.reason).toContain('Run it in the background');
    expect(assessment.safer?.plan).toBe(assessment.strategy.plan);
  });

  it('queues in the background when background rendering is chosen', () => {
    const assessment = expectSuccess(
      assessRender({ ...TEN_SECONDS, override: ProcessingMode.BackgroundOffline }),
    );
    expect(assessment.strategy.priority).toBe(JobPriority.Background);
    expect(assessment.safer).toBeUndefined();
  });

  it('warns of memory without a decision, since the chunks it plans are the safer strategy', () => {
    const assessment = expectSuccess(assessRender({ ...TEN_SECONDS, availableMemoryBytes: 1e6 }));
    expect(assessment.strategy.plan.warnings.map((warning) => warning.resource)).toEqual([
      'memory',
    ]);
    expect(assessment.strategy.priority).toBe(JobPriority.Foreground);
    expect(assessment.safer).toBeUndefined();
  });

  it('never refuses a render for its size', () => {
    const tenDays = expectSuccess(sampleCount(10 * 24 * 3_600 * 48_000));
    const assessment = expectSuccess(
      assessRender({
        ...TEN_SECONDS,
        frames: tenDays,
        channels: 64,
        availableMemoryBytes: 1e6,
        measuredCostRatio: 3,
      }),
    );
    expect(assessment.strategy.plan.chunks).toBeGreaterThan(0);
  });

  it('refuses a malformed measurement', () => {
    expect(expectFailureCode(assessRender({ ...TEN_SECONDS, measuredCostRatio: -1 }))).toBe(
      'workload.cost-ratio-invalid',
    );
  });
});
