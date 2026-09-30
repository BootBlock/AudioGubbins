import { describe, expect, it } from 'vitest';

import { QUANTA, allocatedBy } from './allocation.js';

describe('measuring allocation', () => {
  it('measures an allocation of a few bytes a quantum', () => {
    // The measure is only worth its passes if it can fail: a run that keeps
    // one small array a quantum must show at least that array each quantum.
    let kept: number[] = [];
    const allocated = allocatedBy({
      quantum: () => {
        kept = [kept.length];
      },
    });
    expect(kept).toHaveLength(1);
    expect(allocated).toBeGreaterThanOrEqual(QUANTA * 16);
  });

  it('measures nothing for a run that allocates nothing', () => {
    const into = new Float64Array(8);
    expect(
      allocatedBy({
        quantum: () => {
          into[0] = (into[0] ?? 0) + 1;
        },
      }),
    ).toBeLessThan(QUANTA);
  });
});
