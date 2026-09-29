import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { PRESET_SETTINGS, PerformanceProfile } from '@audiogubbins/audio-engine';

import { POSTED_FEED_BLOCKS } from '../feed/posted-feed.js';
import { feedPlanFor } from './feed-plan.js';

describe('feedPlanFor', () => {
  it('reads an eighth of the time ahead a chunk, in whole quanta, and rings one chunk more', () => {
    expect(
      expectSuccess(feedPlanFor(PRESET_SETTINGS[PerformanceProfile.Balanced], 48_000)),
    ).toEqual({
      feedAheadMilliseconds: 200,
      aheadFrames: 9_600,
      chunkFrames: 1_280,
      ringFrames: 10_880,
      wakeMilliseconds: (1_280 * 1000) / 48_000,
    });
  });

  it('changes only buffering between profiles, and never needs more blocks than a posted feed holds', () => {
    for (const profile of [
      PerformanceProfile.LowLatency,
      PerformanceProfile.Balanced,
      PerformanceProfile.MaximumStability,
    ]) {
      for (const rate of [8_000, 44_100, 48_000, 192_000]) {
        const plan = expectSuccess(feedPlanFor(PRESET_SETTINGS[profile], rate));
        expect(plan.chunkFrames % 128 === 0 || plan.chunkFrames === plan.aheadFrames).toBe(true);
        expect(Math.ceil(plan.aheadFrames / plan.chunkFrames) + 1).toBeLessThanOrEqual(
          POSTED_FEED_BLOCKS,
        );
        expect(plan.ringFrames).toBe(plan.aheadFrames + plan.chunkFrames);
      }
    }
  });

  it('never reads a chunk longer than the time ahead', () => {
    const plan = expectSuccess(
      feedPlanFor(
        { ...PRESET_SETTINGS[PerformanceProfile.LowLatency], feedAheadMilliseconds: 1 },
        48_000,
      ),
    );

    expect(plan.aheadFrames).toBe(48);
    expect(plan.chunkFrames).toBe(48);
  });

  it('refuses a time ahead shorter than a frame', () => {
    expect(
      expectFailureCode(
        feedPlanFor(
          { ...PRESET_SETTINGS[PerformanceProfile.LowLatency], feedAheadMilliseconds: 0.01 },
          48_000,
        ),
      ),
    ).toBe('playback.feed-ahead-too-short');
  });
});
