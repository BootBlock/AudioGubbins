import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { CLICK_DETECTOR } from './click-detector.js';
import { detectionValues, settledValues } from './detector-values.js';
import { SILENCE_DETECTOR } from './silence-detector.js';

describe('the values a detector judges by', () => {
  it('takes each value set, and the default of every one not set', () => {
    const values = expectSuccess(settledValues(SILENCE_DETECTOR, { threshold: -45 }));
    expect([...values]).toEqual([
      ['threshold', -45],
      ['shortest-edge', 0.01],
      ['shortest-pause', 0.5],
      ['pause-kept', 0.25],
    ]);
  });

  it('refuses a value out of its range rather than moving it in, and a setting the detector lacks', () => {
    expect(expectFailureCode(settledValues(SILENCE_DETECTOR, { threshold: -10 }))).toBe(
      'detection.parameter-out-of-range',
    );
    expect(expectFailureCode(settledValues(SILENCE_DETECTOR, { 'pause-kept': -0.1 }))).toBe(
      'detection.parameter-out-of-range',
    );
    expect(expectFailureCode(settledValues(SILENCE_DETECTOR, { threshold: Number.NaN }))).toBe(
      'detection.parameter-out-of-range',
    );
    expect(expectFailureCode(settledValues(SILENCE_DETECTOR, { level: 1 }))).toBe(
      'detection.parameter-unknown',
    );
    expect(expectFailureCode(settledValues(CLICK_DETECTOR, { threshold: -60 }))).toBe(
      'detection.parameter-unknown',
    );
  });

  it('gives each detector a detection runs its values, and refuses values for one it does not run', () => {
    const values = expectSuccess(
      detectionValues([CLICK_DETECTOR, SILENCE_DETECTOR], { silence: { 'shortest-pause': 2 } }),
    );
    expect(values.get('clicks')?.size).toBe(0);
    expect(values.get('silence')?.get('shortest-pause')).toBe(2);
    expect(
      expectFailureCode(detectionValues([CLICK_DETECTOR], { silence: { threshold: -50 } })),
    ).toBe('detection.detector-unknown');
  });
});
