import { describe, expect, it } from 'vitest';

import { sampleRate, type SampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import {
  PerformanceProfile,
  PRESET_SETTINGS,
  type PerformanceSettings,
} from './performance-profile.js';
import { STABILITY_WINDOW_SECONDS, UnderrunHistory, assessStability } from './stability.js';

const RATE: SampleRate = expectSuccess(sampleRate(48_000));
const WINDOW = STABILITY_WINDOW_SECONDS * 48_000;
const BALANCED = PRESET_SETTINGS[PerformanceProfile.Balanced];

function withUnderruns(frames: readonly number[]): UnderrunHistory {
  const history = new UnderrunHistory(RATE);
  for (const frame of frames) expectSuccess(history.record(frame));
  return history;
}

describe('recording underruns', () => {
  it('counts the events in the window ending at a frame', () => {
    const history = withUnderruns([100, 200, 300]);
    expect(history.size).toBe(3);
    expect(history.underrunsAt(300)).toBe(3);
    expect(history.underrunsAt(250)).toBe(2);
  });

  it('lets go of events that have left the window, so memory stays bounded', () => {
    const history = withUnderruns([0, 1_000, WINDOW, WINDOW + 1_000, 3 * WINDOW]);
    expect(history.size).toBe(1);
    expect(history.underrunsAt(3 * WINDOW)).toBe(1);
  });

  it('stays as small as the window however long the session runs', () => {
    // An underrun every second for an hour.
    const frames = Array.from({ length: 3_600 }, (_, second) => second * 48_000);
    const history = withUnderruns(frames);
    expect(history.size).toBe(STABILITY_WINDOW_SECONDS);
    expect(history.underrunsAt(3_599 * 48_000)).toBe(STABILITY_WINDOW_SECONDS);
  });

  it('keeps every event in order when it grows past its first places', () => {
    // Thirty reports a second for the whole window: far more than the ring starts with.
    const frames = Array.from({ length: 300 }, (_, report) => report * 1_600);
    const history = withUnderruns(frames);
    expect(history.size).toBe(300);
    expect(history.underrunsAt(299 * 1_600)).toBe(300);
    expect(history.underrunsAt(150 * 1_600)).toBe(151);
    expectSuccess(history.record(WINDOW + 1_600));
    // The first two reports, at 0 and 1 600, have left the window.
    expect(history.underrunsAt(WINDOW + 1_600)).toBe(299);
  });

  it('records a batch the feed counted together', () => {
    const history = new UnderrunHistory(RATE);
    expectSuccess(history.record(500, 7));
    expect(history.underrunsAt(500)).toBe(7);
  });

  it.each([
    [-1, 1, 'stability.context-frame-invalid'],
    [1.5, 1, 'stability.context-frame-invalid'],
    [Number.NaN, 1, 'stability.context-frame-invalid'],
    [10, 0, 'stability.count-invalid'],
    [10, 2.5, 'stability.count-invalid'],
  ])('refuses a report at frame %s counting %s', (frame, count, code) => {
    expect(expectFailureCode(new UnderrunHistory(RATE).record(frame, count))).toBe(code);
  });

  it('refuses a frame before the latest, which belongs to a replaced context', () => {
    expect(expectFailureCode(withUnderruns([1_000]).record(999))).toBe(
      'stability.context-frame-out-of-order',
    );
  });

  it('accepts two reports at the same frame', () => {
    expect(withUnderruns([1_000, 1_000]).underrunsAt(1_000)).toBe(2);
  });
});

describe('assessing stability', () => {
  it('is stable with no underruns, and recommends nothing', () => {
    const assessment = assessStability(
      new UnderrunHistory(RATE),
      5 * WINDOW,
      PerformanceProfile.Balanced,
      BALANCED,
    );
    expect(assessment).toEqual({
      stable: true,
      underrunsInWindow: 0,
      explanation: 'No underruns in the last 10 seconds.',
    });
  });

  it('warns of underruns in the window and recommends the next more stable preset', () => {
    const history = withUnderruns([1_000]);
    expectSuccess(history.record(2_000, 2));
    const assessment = assessStability(
      history,
      3_000,
      PerformanceProfile.LowLatency,
      PRESET_SETTINGS[PerformanceProfile.LowLatency],
    );
    expect(assessment.stable).toBe(false);
    expect(assessment.underrunsInWindow).toBe(3);
    expect(assessment.recommendation).toBe(PerformanceProfile.Balanced);
    expect(assessment.explanation).toContain('3 underruns in the last 10 seconds');
    expect(assessment.explanation).toContain('The Balanced profile keeps more audio buffered');
  });

  it('recommends Maximum Stability from Balanced', () => {
    const assessment = assessStability(
      withUnderruns([1]),
      2,
      PerformanceProfile.Balanced,
      BALANCED,
    );
    expect(assessment.recommendation).toBe(PerformanceProfile.MaximumStability);
    expect(assessment.explanation).toMatch(/^1 underrun in/);
  });

  it('has nothing more stable to recommend from Maximum Stability, and says what may help', () => {
    const assessment = assessStability(
      withUnderruns([1]),
      2,
      PerformanceProfile.MaximumStability,
      PRESET_SETTINGS[PerformanceProfile.MaximumStability],
    );
    expect(assessment.stable).toBe(false);
    expect(assessment).not.toHaveProperty('recommendation');
    expect(assessment.explanation).toContain('No preset keeps more audio buffered');
  });

  it('places custom settings by how far their feed keeps ahead', () => {
    const custom = (feedAheadMilliseconds: number): PerformanceSettings => ({
      ...BALANCED,
      feedAheadMilliseconds,
    });
    const history = withUnderruns([1]);
    const recommend = (feed: number) =>
      assessStability(history, 2, PerformanceProfile.Custom, custom(feed)).recommendation;
    expect(recommend(10)).toBe(PerformanceProfile.LowLatency);
    expect(recommend(50)).toBe(PerformanceProfile.Balanced);
    expect(recommend(600)).toBe(PerformanceProfile.MaximumStability);
    expect(recommend(5_000)).toBeUndefined();
  });

  it('forgets underruns once they leave the window', () => {
    const history = withUnderruns([1_000]);
    expect(
      assessStability(history, 1_000 + WINDOW - 1, PerformanceProfile.Balanced, BALANCED).stable,
    ).toBe(false);
    expect(
      assessStability(history, 1_000 + WINDOW, PerformanceProfile.Balanced, BALANCED).stable,
    ).toBe(true);
  });

  it('does not count an underrun after the frame being assessed', () => {
    const history = withUnderruns([5_000]);
    expect(
      assessStability(history, 4_999, PerformanceProfile.Balanced, BALANCED).underrunsInWindow,
    ).toBe(0);
  });
});
