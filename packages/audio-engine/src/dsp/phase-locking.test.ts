import { describe, expect, it } from 'vitest';

import { findPeaks } from './phase-locking.js';

/** The peaks `findPeaks` finds in `levels`. */
function peaksOf(levels: readonly number[]): number[] {
  const peaks = new Int32Array(levels.length);
  const count = findPeaks(Float64Array.from(levels), levels.length, peaks);
  return [...peaks.subarray(0, count)];
}

describe('the peaks of a frame’s magnitudes', () => {
  it('finds none in silence or a flat spectrum, where there is no partial', () => {
    expect(peaksOf(new Array<number>(9).fill(0))).toEqual([]);
    expect(peaksOf(new Array<number>(9).fill(0.3))).toEqual([]);
  });

  it('finds a partial at either end of the frame, louder than the neighbours it has', () => {
    expect(peaksOf([5, 3, 1, 0, 0, 0, 0, 1, 2])).toEqual([0, 8]);
    expect(peaksOf([5, 5, 1, 0])).toEqual([0]);
    expect(peaksOf([5, 4, 5, 0])).toEqual([0]);
  });

  it('finds bins louder than the two on each side, a tie counting for the earlier bin', () => {
    expect(peaksOf([0, 1, 3, 3, 1, 0, 2, 0, 0])).toEqual([2, 6]);
  });
});
