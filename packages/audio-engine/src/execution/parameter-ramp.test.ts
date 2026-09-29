import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { ParameterRamp, rampFrames } from './parameter-ramp.js';

function take(ramp: ParameterRamp, count: number): number[] {
  const values = new Float64Array(count);
  ramp.fill(values, count);
  return Array.from(values);
}

describe('a parameter ramp', () => {
  it('lasts ten milliseconds at the rate, and at least one frame', () => {
    expect(rampFrames(expectSuccess(sampleRate(48_000)))).toBe(480);
    expect(rampFrames(expectSuccess(sampleRate(44_100)))).toBe(441);
    expect(rampFrames(expectSuccess(sampleRate(22_050)))).toBe(221);
  });

  it('holds its value until it is set', () => {
    const ramp = new ParameterRamp(0.5, 4);
    expect(ramp.steady).toBe(true);
    expect(take(ramp, 3)).toEqual([0.5, 0.5, 0.5]);
  });

  it('spreads a change over its length and ends on the target exactly', () => {
    const ramp = new ParameterRamp(0, 4);
    ramp.set(1);
    expect(ramp.steady).toBe(false);
    expect(take(ramp, 6)).toEqual([0, 0.25, 0.5, 0.75, 1, 1]);
    expect(ramp.steady).toBe(true);

    // 0.2 + (0.9 - 0.2) is 0.8999999999999999 in binary floating point.
    const awkward = new ParameterRamp(0.2, 3);
    awkward.set(0.9);
    expect(take(awkward, 4).at(-1)).toBe(0.9);
  });

  it('gives the same values filled in blocks of any size', () => {
    const whole = new ParameterRamp(0.2, 7);
    whole.set(0.9);
    const pieces = new ParameterRamp(0.2, 7);
    pieces.set(0.9);
    expect([...take(pieces, 3), ...take(pieces, 1), ...take(pieces, 6)]).toEqual(take(whole, 10));
  });

  it('starts a new ramp from where the last one had reached', () => {
    const ramp = new ParameterRamp(0, 4);
    ramp.set(1);
    take(ramp, 2);
    ramp.set(0);
    expect(take(ramp, 5)).toEqual([0.5, 0.375, 0.25, 0.125, 0]);
  });
});
