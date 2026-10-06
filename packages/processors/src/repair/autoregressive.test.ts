import { describe, expect, it } from 'vitest';

import { GapInterpolator } from './autoregressive.js';

const ORDER = 32;
const CONTEXT = 256;

/** Three partials, the kind of signal an all-pole model of order 32 predicts. */
function partial(frame: number): number {
  return (
    0.4 * Math.sin(0.031 * frame) +
    0.2 * Math.sin(0.113 * frame + 1) +
    0.1 * Math.sin(0.29 * frame + 2)
  );
}

/** The gap of `gap` frames from `start` of `signal`, interpolated from its context. */
function interpolated(signal: (frame: number) => number, start: number, gap: number): Float64Array {
  const interpolator = new GapInterpolator(ORDER, CONTEXT, 128);
  for (let offset = 0; offset < CONTEXT; offset += 1) {
    interpolator.context[offset] = signal(start - CONTEXT + offset);
    interpolator.context[CONTEXT + offset] = signal(start + gap + offset);
  }
  interpolator.fit();
  for (let offset = 0; offset < gap + 2 * ORDER; offset += 1) {
    // The gap's own frames are given as nonsense, which must not be read.
    const inGap = offset >= ORDER && offset < ORDER + gap;
    interpolator.surround[offset] = inGap ? 1e3 : signal(start - ORDER + offset);
  }
  expect(interpolator.interpolate(gap)).toBe(true);
  return interpolator.solution.slice(0, gap);
}

describe('least-squares autoregressive interpolation', () => {
  it('restores a gap of partials, to −80 dB over 2 ms where their normal equations are singular', () => {
    // The gap's length and the most its samples may differ from the partials'.
    // The context's two segments meet in a jump, the gap having been taken
    // from between them, which a fit across their junction would read.
    for (const [gap, bound] of [
      [1, 1e-8],
      [7, 1e-8],
      [40, 1e-8],
      [96, 1e-4],
    ] as const) {
      const solution = interpolated(partial, 5_000, gap);
      let worst = 0;
      for (let offset = 0; offset < gap; offset += 1) {
        worst = Math.max(worst, Math.abs((solution[offset] ?? 0) - partial(5_000 + offset)));
      }
      expect(worst).toBeLessThan(bound);
    }
  });
});
