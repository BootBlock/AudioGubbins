import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '../identity/branded-id.js';
import { ParameterTaper, type NumericParameterDescriptor } from './parameter.js';
import { controlPosition, parameterAtPosition } from './parameter-control.js';

function numeric(
  taper: ParameterTaper,
  minimum: number,
  maximum: number,
  step?: number,
): NumericParameterDescriptor {
  return {
    kind: 'numeric',
    id: unsafeBrandId<'ParameterId'>('11111111-0001'),
    key: 'value',
    label: 'Value',
    minimum,
    maximum,
    defaultValue: minimum,
    taper,
    ...(step === undefined ? {} : { step }),
  };
}

describe('where a parameter lies on its control (ParameterTaper)', () => {
  it('puts the geometric middle of a logarithmic range at the middle of its travel', () => {
    const frequency = numeric(ParameterTaper.Logarithmic, 20, 20_000);

    expect(controlPosition(frequency, 20)).toBe(0);
    expect(controlPosition(frequency, 20_000)).toBe(1);
    // 20 Hz to 20 kHz is three decades, so 632 Hz is half way along them.
    expect(controlPosition(frequency, Math.sqrt(20 * 20_000))).toBeCloseTo(0.5, 12);
    expect(controlPosition(frequency, 200)).toBeCloseTo(1 / 3, 12);
    expect(parameterAtPosition(frequency, 2 / 3)).toBeCloseTo(2_000, 9);
  });

  it('keeps a linear and a decibel taper linear in the value, decibels being the value', () => {
    for (const taper of [ParameterTaper.Linear, ParameterTaper.Decibel]) {
      const level = numeric(taper, -60, 12);

      expect(controlPosition(level, -24)).toBe(0.5);
      expect(parameterAtPosition(level, 0.25)).toBe(-42);
    }
  });

  it('gives a value on the parameter’s step, counted from its minimum and written to its places', () => {
    const ratio = numeric(ParameterTaper.Linear, 1, 20, 0.1);

    expect(parameterAtPosition(ratio, 0.123_456)).toBe(3.3);
    expect(parameterAtPosition(ratio, 1)).toBe(20);
    expect(parameterAtPosition(numeric(ParameterTaper.Linear, 3, 10, 2), 1)).toBe(9);
  });

  it('never gives a value outside the range, wherever it is asked', () => {
    const frequency = numeric(ParameterTaper.Logarithmic, 20, 20_000, 1);

    expect(parameterAtPosition(frequency, -1)).toBe(20);
    expect(parameterAtPosition(frequency, 2)).toBe(20_000);
    expect(controlPosition(frequency, 40_000)).toBeGreaterThan(1);
  });

  it('maps every position back to itself through its value, where the parameter is continuous', () => {
    const frequency = numeric(ParameterTaper.Logarithmic, 0.1, 18_000);
    for (let place = 0; place <= 100; place += 1) {
      const position = place / 100;
      expect(controlPosition(frequency, parameterAtPosition(frequency, position))).toBeCloseTo(
        position,
        12,
      );
    }
  });
});
