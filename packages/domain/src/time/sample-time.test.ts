import { describe, expect, it } from 'vitest';

import { isSuccess } from '../result.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  addSamples,
  containsSample,
  convertSampleRate,
  sampleCount,
  sampleRate,
  samplesToSeconds,
  secondsToSamples,
  subtractSamples,
  type SampleCount,
} from './sample-time.js';

const RATE_48K = expectSuccess(sampleRate(48_000));

describe('sampleRate', () => {
  it('accepts the rates real hardware produces', () => {
    for (const rate of [8_000, 22_050, 44_100, 48_000, 96_000, 192_000, 384_000]) {
      expect(isSuccess(sampleRate(rate))).toBe(true);
    }
  });

  it('rejects a fractional rate', () => {
    expect(expectFailureCode(sampleRate(44_100.5))).toBe('time.sample-rate-not-an-integer');
  });

  it('rejects a rate below the supported range', () => {
    expect(expectFailureCode(sampleRate(7_999))).toBe('time.sample-rate-out-of-range');
  });

  it('rejects a rate no capture hardware could produce', () => {
    expect(expectFailureCode(sampleRate(1_000_000))).toBe('time.sample-rate-out-of-range');
  });

  it('accepts the highest rate it supports, and nothing above it', () => {
    expect(isSuccess(sampleRate(768_000))).toBe(true);
    expect(expectFailureCode(sampleRate(768_001))).toBe('time.sample-rate-out-of-range');
  });

  it('rejects zero, which would make every conversion divide by zero', () => {
    expect(expectFailureCode(sampleRate(0))).toBe('time.sample-rate-out-of-range');
  });
});

describe('sampleCount', () => {
  it('accepts zero, which is a legitimate empty range', () => {
    expect(isSuccess(sampleCount(0))).toBe(true);
  });

  it('rejects a negative count rather than clamping it', () => {
    expect(expectFailureCode(sampleCount(-1))).toBe('time.sample-count-negative');
  });

  it('rejects a fractional count', () => {
    expect(expectFailureCode(sampleCount(1.5))).toBe('time.sample-count-not-an-integer');
  });

  it('rejects a count beyond exact integer representation', () => {
    expect(expectFailureCode(sampleCount(2 ** 53))).toBe('time.sample-count-too-large');
  });

  it('accepts the largest count it can represent exactly', () => {
    expect(expectSuccess(sampleCount(2 ** 53 - 1))).toBe(2 ** 53 - 1);
  });
});

describe('addSamples and subtractSamples', () => {
  it('adds two counts', () => {
    const result = addSamples(100 as SampleCount, 50 as SampleCount);
    expect(expectSuccess(result)).toBe(150);
  });

  it('subtracts to zero', () => {
    expect(expectSuccess(subtractSamples(100 as SampleCount, 100 as SampleCount))).toBe(0);
  });

  it('refuses to produce a negative position instead of silently clamping', () => {
    expect(expectFailureCode(subtractSamples(10 as SampleCount, 11 as SampleCount))).toBe(
      'time.sample-count-negative',
    );
  });

  it('refuses a sum that would leave exact integer range', () => {
    const nearMaximum = (2 ** 53 - 2) as SampleCount;
    expect(expectFailureCode(addSamples(nearMaximum, 10 as SampleCount))).toBe(
      'time.sample-count-too-large',
    );
  });
});

describe('containsSample', () => {
  it('treats a range as half-open so adjacent ranges do not overlap', () => {
    expect(containsSample(0 as SampleCount, 100 as SampleCount, 0 as SampleCount)).toBe(true);
    expect(containsSample(0 as SampleCount, 100 as SampleCount, 99 as SampleCount)).toBe(true);
    expect(containsSample(0 as SampleCount, 100 as SampleCount, 100 as SampleCount)).toBe(false);
    expect(containsSample(100 as SampleCount, 100 as SampleCount, 100 as SampleCount)).toBe(true);
  });

  it('contains nothing when the range is empty', () => {
    expect(containsSample(50 as SampleCount, 0 as SampleCount, 50 as SampleCount)).toBe(false);
  });
});

describe('conversion between samples and seconds', () => {
  it('converts a whole second at the given rate', () => {
    expect(samplesToSeconds(48_000 as SampleCount, RATE_48K)).toBe(1);
  });

  it('rounds to the nearest frame rather than truncating', () => {
    // 0.5 frames at 48 kHz is 1/96000 s. Truncation would lose it every pass.
    const justOverHalfAFrame = 1 / 96_000 + 1e-12;
    expect(expectSuccess(secondsToSamples(justOverHalfAFrame, RATE_48K))).toBe(1);
  });

  it('round-trips a whole number of frames exactly', () => {
    const original = 123_456 as SampleCount;
    const seconds = samplesToSeconds(original, RATE_48K);
    expect(expectSuccess(secondsToSamples(seconds, RATE_48K))).toBe(original);
  });

  it('rejects a non-finite number of seconds', () => {
    expect(expectFailureCode(secondsToSamples(Number.POSITIVE_INFINITY, RATE_48K))).toBe(
      'time.seconds-not-finite',
    );
  });

  it('rejects a negative time rather than producing a position before the start', () => {
    expect(expectFailureCode(secondsToSamples(-1, RATE_48K))).toBe('time.sample-count-negative');
  });
});

describe('convertSampleRate', () => {
  it('maps a position when the rate doubles', () => {
    const rate96k = expectSuccess(sampleRate(96_000));
    expect(expectSuccess(convertSampleRate(48_000 as SampleCount, RATE_48K, rate96k))).toBe(96_000);
  });

  it('maps a position when the rate falls', () => {
    const rate44k = expectSuccess(sampleRate(44_100));
    expect(expectSuccess(convertSampleRate(48_000 as SampleCount, RATE_48K, rate44k))).toBe(44_100);
  });

  it('leaves a position unchanged when the rates already match', () => {
    expect(expectSuccess(convertSampleRate(1_234 as SampleCount, RATE_48K, RATE_48K))).toBe(1_234);
  });

  it('keeps zero at zero', () => {
    const rate8k = expectSuccess(sampleRate(8_000));
    expect(expectSuccess(convertSampleRate(0 as SampleCount, RATE_48K, rate8k))).toBe(0);
  });
});
