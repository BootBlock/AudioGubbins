import { describe, expect, it } from 'vitest';

import { FadeShape } from '@audiogubbins/domain';

import {
  SpanPairSums,
  crossfadeSuitability,
  largestLevelChange,
  spanPair,
} from './crossfade-suitability.js';

const PAIR = { frames: 480, outPower: 0.1, inPower: 0.1 };

describe("a crossfade's suitability", () => {
  it('suits a linear fade to two identical spans, whose amplitudes add', () => {
    const suitability = crossfadeSuitability({ ...PAIR, correlation: 1 });
    expect(suitability.shape).toBe(FadeShape.Linear);
    expect(suitability.levelChangeDb).toBeCloseTo(0, 12);
    expect(suitability.verdict).toBe('pass');
    // An equal-power fade of the same spans swells by 3 dB at its middle.
    expect(largestLevelChange({ ...PAIR, correlation: 1 }, FadeShape.EqualPower)).toBeCloseTo(
      10 * Math.log10(2),
      2,
    );
  });

  it('suits an equal-power fade to two uncorrelated spans, whose powers add', () => {
    const suitability = crossfadeSuitability({ ...PAIR, correlation: 0 });
    expect(suitability.shape).toBe(FadeShape.EqualPower);
    expect(suitability.levelChangeDb).toBeCloseTo(0, 12);
  });

  it('fails every shape between two spans in anti-phase, which cancel', () => {
    const suitability = crossfadeSuitability({ ...PAIR, correlation: -1 });
    expect(suitability.verdict).toBe('fail');
  });

  it('changes nothing between two silences', () => {
    expect(crossfadeSuitability({ frames: 480, outPower: 0, inPower: 0, correlation: 0 })).toEqual({
      lengthFrames: 480,
      correlation: 0,
      shape: FadeShape.Linear,
      levelChangeDb: 0,
      verdict: 'pass',
    });
  });

  it("measures the spans' powers and their correlation over every channel, a chunk at a time alike", () => {
    const out = [Float32Array.from([1, 0, -1, 0]), Float32Array.from([0.5, 0.5, 0.5, 0.5])];
    const into = [Float32Array.from([1, 0, -1, 0]), Float32Array.from([-0.5, -0.5, -0.5, -0.5])];
    const whole = spanPair(out, into);
    // Σab = 2 − 1, Σa² = Σb² = 2 + 1, over eight samples.
    expect(whole).toEqual({ frames: 4, outPower: 3 / 8, inPower: 3 / 8, correlation: 1 / 3 });
    const sums = new SpanPairSums();
    sums.add(
      out.map((channel) => channel.subarray(0, 3)),
      into.map((channel) => channel.subarray(0, 3)),
      3,
    );
    sums.add(
      out.map((channel) => channel.subarray(3)),
      into.map((channel) => channel.subarray(3)),
      1,
    );
    expect(sums.pair()).toEqual(whole);
  });
});
