/**
 * The pressure choice a person's preferences keep: read field by field from
 * whatever storage holds, and the fixed strength held to the steps its
 * control offers, so a stroke drawn at a fixed strength is the same anywhere.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_GESTURE_SETTINGS } from './pointer.js';
import {
  DEFAULT_PRESSURE_PREFERENCE,
  FIXED_STRENGTH_RANGE,
  fixedStrengthOf,
  pressurePreferenceOf,
} from './pressure-preference.js';

describe('the fixed strength', () => {
  it('is taken to the nearest step its control offers', () => {
    expect(fixedStrengthOf(0.62)).toBe(0.6);
    expect(fixedStrengthOf(0.63)).toBe(0.65);
    expect(fixedStrengthOf(0.15)).toBe(3 / 20);
  });

  it('is held within the control, never at nothing, which would make a tool do nothing', () => {
    expect(fixedStrengthOf(0)).toBe(FIXED_STRENGTH_RANGE.minimum);
    expect(fixedStrengthOf(-3)).toBe(FIXED_STRENGTH_RANGE.minimum);
    expect(fixedStrengthOf(7)).toBe(FIXED_STRENGTH_RANGE.maximum);
  });

  it('is the default where the value is no number', () => {
    expect(fixedStrengthOf(Number.NaN)).toBe(DEFAULT_PRESSURE_PREFERENCE.fixedStrength);
    expect(fixedStrengthOf(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_PRESSURE_PREFERENCE.fixedStrength,
    );
  });

  it('keeps every step the control offers as it is', () => {
    const { minimum, maximum, step } = FIXED_STRENGTH_RANGE;
    for (let index = Math.round(minimum / step); index <= Math.round(maximum / step); index += 1) {
      const value = index / 20;
      expect(fixedStrengthOf(value)).toBe(value);
    }
  });
});

describe('reading the pressure choice back', () => {
  it('reads both fields where they are usable', () => {
    expect(pressurePreferenceOf({ usePenPressure: false, fixedStrength: 0.4 })).toEqual({
      usePenPressure: false,
      fixedStrength: 0.4,
    });
  });

  it('costs an unusable field and keeps the other', () => {
    expect(pressurePreferenceOf({ usePenPressure: 'no', fixedStrength: 0.4 })).toEqual({
      usePenPressure: DEFAULT_PRESSURE_PREFERENCE.usePenPressure,
      fixedStrength: 0.4,
    });
    expect(pressurePreferenceOf({ usePenPressure: false, fixedStrength: '0.4' })).toEqual({
      usePenPressure: false,
      fixedStrength: DEFAULT_PRESSURE_PREFERENCE.fixedStrength,
    });
  });

  it('takes a stored strength off the steps to its nearest, within the control', () => {
    expect(pressurePreferenceOf({ usePenPressure: true, fixedStrength: 0.333 })).toEqual({
      usePenPressure: true,
      fixedStrength: 0.35,
    });
    expect(pressurePreferenceOf({ usePenPressure: true, fixedStrength: 0 }).fixedStrength).toBe(
      FIXED_STRENGTH_RANGE.minimum,
    );
  });

  it('is the default where nothing usable is stored', () => {
    expect(pressurePreferenceOf(undefined)).toEqual(DEFAULT_PRESSURE_PREFERENCE);
    expect(pressurePreferenceOf([true, 0.5])).toEqual(DEFAULT_PRESSURE_PREFERENCE);
  });

  it('is the gesture settings’ own default', () => {
    expect(DEFAULT_GESTURE_SETTINGS).toMatchObject(DEFAULT_PRESSURE_PREFERENCE);
  });
});
