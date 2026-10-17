import { describe, expect, it } from 'vitest';

import type { ParameterValue } from '@audiogubbins/domain';

import { bandOn, sineGain } from '../testing/filter-measures.js';
import { TEST_RATE, processorValues } from '../testing/processor-run.js';
import { equaliserResponse } from './equaliser-response.js';
import { PARAMETRIC_EQUALISER } from './parametric-equaliser.js';

/** The response drawn for the equaliser set by `byKey` at each of `frequencies`. */
function drawn(
  byKey: Readonly<Record<string, ParameterValue>>,
  frequencies: readonly number[],
  band?: number,
): readonly number[] {
  const into = new Float64Array(frequencies.length);
  equaliserResponse(
    processorValues(PARAMETRIC_EQUALISER, byKey),
    TEST_RATE,
    Float64Array.from(frequencies),
    into,
    band,
  );
  return [...into];
}

describe('the parametric equaliser’s drawn response', () => {
  // The curve a panel draws is a claim about what is heard, so each point is
  // held against the gain the running kernel gives a sine there.
  it('is the gain the running equaliser gives a sine, bands of every shape together', () => {
    const settings = {
      ...bandOn(1, { frequency: 60 }),
      ...bandOn(2, { frequency: 150, gain: 4 }),
      ...bandOn(4, { frequency: 1_200, gain: 4.5, q: 1.4 }),
      ...bandOn(6, { frequency: 5_000, gain: -3.5, q: 3 }),
      ...bandOn(7, { frequency: 8_000, gain: 2 }),
      ...bandOn(8, { frequency: 19_000 }),
    };
    const frequencies = [40, 100, 400, 1_200, 3_000, 5_000, 12_000, 22_000];
    const heard = frequencies.map((frequency) =>
      sineGain(PARAMETRIC_EQUALISER, settings, frequency),
    );
    drawn(settings, frequencies).forEach((decibels, index) => {
      expect(Math.abs(decibels - (heard[index] ?? Number.NaN))).toBeLessThan(0.1);
    });
  });

  it('is flat where every band is off, and draws one band alone as it would sound on', () => {
    expect(drawn({}, [20, 1_000, 20_000])).toEqual([0, 0, 0]);
    const off = { 'band-3-frequency': 1_000, 'band-3-gain': 6, 'band-3-q': 2 };
    const [alone] = drawn(off, [1_000], 2);
    expect(alone).toBeCloseTo(6, 6);
    expect(drawn(off, [1_000])).toEqual([0]);
  });
});
