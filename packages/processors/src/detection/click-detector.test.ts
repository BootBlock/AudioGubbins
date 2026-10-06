import { describe, expect, it } from 'vitest';

import { MeasureUnit } from '@audiogubbins/domain';
import { gainToDecibels } from '@audiogubbins/audio-engine';

import { MERGE_GAP } from '../repair/click-geometry.js';
import { partials, withClicks, type Click } from '../testing/repair-signals.js';
import { detect } from '../testing/detection-signals.js';
import { CLICK_DETECTOR } from './click-detector.js';
import { CLICK_SENSITIVITY } from './treatments.js';

const LENGTH = 96_000;
const clean = partials(LENGTH);

/** The ranges and channels of the clicks found in `channels`. */
function clicksIn(...channels: Float32Array[]) {
  return detect(CLICK_DETECTOR, channels).map(({ range, channels: on }) => ({
    start: range.start,
    end: range.end,
    channels: on,
  }));
}

describe('the click detector', () => {
  it('finds each click at its frames, measured past the de-click’s sensitivity', () => {
    // The last is in the audio's last part block, 96 000 being 93¾ blocks of
    // 1024: heard only with the audio mirrored after its end.
    const clicks: readonly Click[] = [
      { at: 14_000, width: 30, size: 0.2 },
      { at: 40_003, width: 10, size: 0.1 },
      { at: 95_900, width: 6, size: 0.2 },
    ];
    const found = detect(CLICK_DETECTOR, [withClicks(clean, clicks)]);
    expect(found).toHaveLength(clicks.length);
    for (const [index, { at, width }] of clicks.entries()) {
      const finding = found[index];
      // A click's first sample is flagged, and its residual spreads at most
      // the predictor's order past its last.
      expect(finding?.range.start).toBe(at);
      expect(finding?.range.end).toBeGreaterThanOrEqual(at + width / 2);
      expect(finding?.range.end).toBeLessThanOrEqual(Math.min(LENGTH, at + width + MERGE_GAP));
      expect(finding?.channels).toEqual([0]);
      expect(finding?.measure.unit).toBe(MeasureUnit.Decibels);
      // Each is far past the threshold it was judged at.
      expect(finding?.measure.value).toBeGreaterThan(
        gainToDecibels(4 * CLICK_SENSITIVITY.defaultValue),
      );
    }
  });

  it('finds nothing in music with no click', () => {
    expect(clicksIn(clean)).toEqual([]);
    expect(clicksIn(new Float32Array(LENGTH))).toEqual([]);
  });

  it('makes one finding of events closer than the merge gap, and two of events further apart', () => {
    // Two bursts of 4 frames 12 frames apart are one click; 60 apart, two.
    const near = clicksIn(
      withClicks(clean, [
        { at: 30_000, width: 4, size: 0.2 },
        { at: 30_016, width: 4, size: 0.2, seed: 5 },
      ]),
    );
    expect(near).toEqual([{ start: 30_000, end: expect.any(Number) as number, channels: [0] }]);
    expect(near[0]?.end).toBeGreaterThan(30_016);
    const far = clicksIn(
      withClicks(clean, [
        { at: 30_000, width: 4, size: 0.2 },
        { at: 30_064, width: 4, size: 0.2, seed: 5 },
      ]),
    );
    expect(far.map(({ start }) => start)).toEqual([30_000, 30_064]);
  });

  it('finds a click on the channel it is on, one finding per channel, in order', () => {
    const left = withClicks(clean, [{ at: 50_000, width: 12, size: 0.2 }]);
    const right = withClicks(clean, [
      { at: 20_000, width: 12, size: 0.2 },
      { at: 50_000, width: 12, size: 0.2, seed: 9 },
    ]);
    expect(clicksIn(left, right).map(({ start, channels }) => [start, channels])).toEqual([
      [20_000, [1]],
      [50_000, [0]],
      [50_000, [1]],
    ]);
  });

  it('treats a click with a de-click at the sensitivity it was judged at', () => {
    const [finding] = detect(CLICK_DETECTOR, [
      withClicks(clean, [{ at: 9_000, width: 9, size: 0.2 }]),
    ]);
    expect(finding?.treatment).toEqual({
      kind: 'steps',
      steps: [{ typeKey: 'de-click', values: { sensitivity: CLICK_SENSITIVITY.defaultValue } }],
    });
  });
});
