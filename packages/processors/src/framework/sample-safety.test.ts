import { describe, expect, it } from 'vitest';

import { finiteSample, flushSubnormal } from './sample-safety.js';

describe('sample safety', () => {
  it('hears a NaN or an infinity as silence and passes every finite sample unchanged', () => {
    expect(finiteSample(Number.NaN)).toBe(0);
    expect(finiteSample(Number.POSITIVE_INFINITY)).toBe(0);
    expect(finiteSample(Number.NEGATIVE_INFINITY)).toBe(0);
    for (const sample of [0, -0.5, 1, Number.MIN_VALUE, -Number.MAX_VALUE]) {
      expect(Object.is(finiteSample(sample), sample)).toBe(true);
    }
  });

  it('flushes a state decayed far below hearing to zero and keeps one that is audible', () => {
    expect(flushSubnormal(Number.MIN_VALUE)).toBe(0);
    expect(flushSubnormal(-1e-35)).toBe(0);
    expect(flushSubnormal(2 ** -101)).toBe(0);
    for (const state of [2 ** -99, -(2 ** -99), 1e-10, -0.25, 3]) {
      expect(flushSubnormal(state)).toBe(state);
    }
  });
});
