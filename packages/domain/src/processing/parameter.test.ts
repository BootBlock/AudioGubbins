import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type ParameterId } from '../identity/branded-id.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  ParameterTaper,
  type ChoiceParameterDescriptor,
  type NumericParameterDescriptor,
  type ToggleParameterDescriptor,
  defaultParameterValue,
  validateParameterValue,
} from './parameter.js';

const id = (suffix: string): ParameterId => unsafeBrandId<'ParameterId'>(`44444444-${suffix}`);

const gain: NumericParameterDescriptor = {
  kind: 'numeric',
  id: id('gain'),
  key: 'gain',
  label: 'Gain',
  minimum: -60,
  maximum: 12,
  defaultValue: 0,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
};

const slope: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: id('slope'),
  key: 'slope',
  label: 'Slope',
  options: [
    { key: '6', label: '6 dB per octave' },
    { key: '12', label: '12 dB per octave' },
    { key: '24', label: '24 dB per octave' },
  ],
  defaultKey: '12',
};

const invert: ToggleParameterDescriptor = {
  kind: 'toggle',
  id: id('invert'),
  key: 'invert-phase',
  label: 'Invert phase',
  defaultValue: false,
};

describe('validateParameterValue on a numeric parameter', () => {
  it('accepts a value inside the range', () => {
    expect(expectSuccess(validateParameterValue(gain, -6))).toBe(-6);
  });

  it('accepts both endpoints of the range', () => {
    expect(expectSuccess(validateParameterValue(gain, -60))).toBe(-60);
    expect(expectSuccess(validateParameterValue(gain, 12))).toBe(12);
  });

  it('rejects a value above the maximum rather than clamping it', () => {
    expect(expectFailureCode(validateParameterValue(gain, 13))).toBe('parameter.out-of-range');
  });

  it('rejects a value below the minimum rather than clamping it', () => {
    expect(expectFailureCode(validateParameterValue(gain, -61))).toBe('parameter.out-of-range');
  });

  it('rejects a value that is not a number', () => {
    expect(expectFailureCode(validateParameterValue(gain, 'loud'))).toBe(
      'parameter.expected-finite-number',
    );
  });

  it('rejects an infinite value', () => {
    expect(expectFailureCode(validateParameterValue(gain, Number.POSITIVE_INFINITY))).toBe(
      'parameter.expected-finite-number',
    );
  });

  it('rejects a value that is not a number at all', () => {
    expect(expectFailureCode(validateParameterValue(gain, Number.NaN))).toBe(
      'parameter.expected-finite-number',
    );
  });

  it('names the parameter and the range in the failure details', () => {
    const result = validateParameterValue(gain, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures[0].details).toMatchObject({
        key: 'gain',
        minimum: -60,
        maximum: 12,
      });
    }
  });
});

describe('validateParameterValue on a choice parameter', () => {
  it('accepts a declared option key', () => {
    expect(expectSuccess(validateParameterValue(slope, '24'))).toBe('24');
  });

  it('rejects a key the parameter does not offer', () => {
    expect(expectFailureCode(validateParameterValue(slope, '48'))).toBe('parameter.unknown-option');
  });

  it('rejects the visible label, because a label is not an identifier', () => {
    expect(expectFailureCode(validateParameterValue(slope, '12 dB per octave'))).toBe(
      'parameter.unknown-option',
    );
  });

  it('rejects a value that is not a string', () => {
    expect(expectFailureCode(validateParameterValue(slope, 12))).toBe(
      'parameter.expected-option-key',
    );
  });
});

describe('validateParameterValue on a toggle parameter', () => {
  it('accepts both states', () => {
    expect(expectSuccess(validateParameterValue(invert, true))).toBe(true);
    expect(expectSuccess(validateParameterValue(invert, false))).toBe(false);
  });

  it('rejects a truthy value that is not a boolean', () => {
    expect(expectFailureCode(validateParameterValue(invert, 1))).toBe('parameter.expected-boolean');
  });
});

describe('defaultParameterValue', () => {
  it('returns the declared default of each kind', () => {
    expect(defaultParameterValue(gain)).toBe(0);
    expect(defaultParameterValue(slope)).toBe('12');
    expect(defaultParameterValue(invert)).toBe(false);
  });

  it('returns a default that the parameter itself accepts', () => {
    for (const descriptor of [gain, slope, invert]) {
      expect(
        expectSuccess(validateParameterValue(descriptor, defaultParameterValue(descriptor))),
      ).toBe(defaultParameterValue(descriptor));
    }
  });
});
