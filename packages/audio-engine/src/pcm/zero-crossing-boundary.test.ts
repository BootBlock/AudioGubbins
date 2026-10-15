import { describe, expect, it } from 'vitest';

import {
  type BoundarySamples,
  ZeroCrossingEdges,
  isZeroCrossingBoundary,
} from './zero-crossing-boundary.js';

/** Six frames of two channels: the left crosses at 2 and 4, the right at 3 and 4. */
const WHOLE: BoundarySamples = {
  channels: [
    Float32Array.from([0.5, 0.4, -0.1, -0.2, 0.3, 0.3]),
    Float32Array.from([0.5, 0.4, 0.3, -0.2, 0.3, 0.3]),
  ],
  from: 0,
  length: 6,
};

/** The boundaries from 0 to the end at which `channels` cross, under `edges`. */
function crossings(
  samples: BoundarySamples,
  channels: readonly number[],
  edges: ZeroCrossingEdges,
): number[] {
  const found: number[] = [];
  for (let at = samples.from; at <= samples.length; at += 1) {
    if (isZeroCrossingBoundary(samples, at, channels, edges)) found.push(at);
  }
  return found;
}

describe('the zero-crossing boundary', () => {
  it('is a crossing only where every channel asked for changes sign', () => {
    expect(crossings(WHOLE, [0], ZeroCrossingEdges.Interior)).toEqual([2, 4]);
    expect(crossings(WHOLE, [1], ZeroCrossingEdges.Interior)).toEqual([3, 4]);
    expect(crossings(WHOLE, [0, 1], ZeroCrossingEdges.Interior)).toEqual([4]);
  });

  it('counts a sample of exactly zero on either side as a crossing', () => {
    const zero: BoundarySamples = {
      channels: [Float32Array.from([0.2, 0, 0.3])],
      from: 0,
      length: 3,
    };
    expect(crossings(zero, [0], ZeroCrossingEdges.Interior)).toEqual([1, 2]);
  });

  it("counts a source's ends as crossings where its outside is silence, and never where it is not", () => {
    expect(crossings(WHOLE, [0, 1], ZeroCrossingEdges.Silence)).toEqual([0, 4, 6]);
    expect(crossings(WHOLE, [0, 1], ZeroCrossingEdges.Interior)).toEqual([4]);
  });

  it('reads a window that starts inside the source by its own frames', () => {
    const window: BoundarySamples = {
      channels: WHOLE.channels.map((channel) => channel.subarray(2)),
      from: 2,
      length: 6,
    };
    expect(isZeroCrossingBoundary(window, 4, [0, 1], ZeroCrossingEdges.Interior)).toBe(true);
    expect(isZeroCrossingBoundary(window, 5, [0, 1], ZeroCrossingEdges.Interior)).toBe(false);
    expect(isZeroCrossingBoundary(window, 6, [0, 1], ZeroCrossingEdges.Silence)).toBe(true);
  });

  it('refuses a boundary whose frames the window does not hold, rather than inventing them', () => {
    const window: BoundarySamples = {
      channels: WHOLE.channels.map((channel) => channel.subarray(2, 4)),
      from: 2,
      length: 6,
    };
    expect(() => isZeroCrossingBoundary(window, 2, [0], ZeroCrossingEdges.Interior)).toThrow(
      RangeError,
    );
    expect(() => isZeroCrossingBoundary(window, 3, [2], ZeroCrossingEdges.Interior)).toThrow(
      RangeError,
    );
  });

  it('is never a crossing outside the source', () => {
    expect(isZeroCrossingBoundary(WHOLE, -1, [0], ZeroCrossingEdges.Silence)).toBe(false);
    expect(isZeroCrossingBoundary(WHOLE, 7, [0], ZeroCrossingEdges.Silence)).toBe(false);
  });
});
