import { describe, expect, it } from 'vitest';

import { sampleRate, type DomainResult, type SampleRate } from '@audiogubbins/domain';
import { noise } from '@audiogubbins/test-fixtures';

import {
  CALIBRATION_SIGNAL_LENGTH,
  CALIBRATION_SIGNAL_PEAK,
  calibrationSignal,
} from './calibration-signal.js';
import {
  MINIMUM_PEAK_RATIO,
  loopbackCaptureLength,
  measureRoundTrip,
} from './loopback-analysis.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE: SampleRate = valueOf(sampleRate(8_000));

/** A capture of the burst heard back after `delay` frames at `gain`, over `floor`. */
function heardBack(
  delay: number,
  gain: number,
  floor: Float32Array = new Float32Array(loopbackCaptureLength(RATE)),
): Float32Array {
  const captured = floor.slice();
  calibrationSignal().forEach((sample, index) => {
    captured[delay + index] = (captured[delay + index] ?? 0) + gain * sample;
  });
  return captured;
}

/** Noise of `amplitude` the length of a capture, deterministic by `seed`. */
function roomNoise(seed: number, amplitude: number, rate = RATE): Float32Array {
  return (
    noise(seed, { length: loopbackCaptureLength(rate), amplitude }).channels[0] ??
    new Float32Array()
  );
}

function codeOf<T>(result: DomainResult<T>): string | undefined {
  return result.ok ? undefined : result.failures[0].code;
}

describe('the calibration signal', () => {
  const signal = calibrationSignal();

  it('is a maximum-length sequence: a step up or down at a quarter of full scale, balanced to one', () => {
    expect(signal).toHaveLength(4_095);
    expect(signal.every((sample) => Math.abs(sample) === CALIBRATION_SIGNAL_PEAK)).toBe(true);
    expect(signal.filter((sample) => sample > 0)).toHaveLength(2_048);
  });

  it('correlates with itself in one peak: every other cyclic shift gives the same small value', () => {
    // The register passes through every state before repeating only for a
    // primitive feedback polynomial, and only then is the off-peak cyclic
    // correlation a constant -1 in units of the step squared.
    const unit = CALIBRATION_SIGNAL_PEAK * CALIBRATION_SIGNAL_PEAK;
    const length = CALIBRATION_SIGNAL_LENGTH;
    for (const shift of [0, 1, 2, 17, 1_000, 2_047, 4_094]) {
      let sum = 0;
      for (let index = 0; index < length; index += 1) {
        sum += (signal[index] ?? 0) * (signal[(index + shift) % length] ?? 0);
      }
      expect(Math.round(sum / unit)).toBe(shift === 0 ? length : -1);
    }
  });

  it('is given as a copy, so playing one cannot change the analysis', () => {
    const played = calibrationSignal();
    played.fill(0);
    expect(calibrationSignal()).toEqual(signal);
  });
});

describe('the loopback analysis (REQ-REC-095)', () => {
  it('finds the round trip of a burst heard back cleanly', () => {
    const found = valueOf(measureRoundTrip(heardBack(1_234, 0.5), RATE));
    expect(found.roundTrip).toBe(1_234);
    expect(found.peakRatio).toBeGreaterThan(MINIMUM_PEAK_RATIO);
  });

  it('finds it through room noise louder than the burst', () => {
    const found = valueOf(measureRoundTrip(heardBack(321, 0.2, roomNoise(7, 0.25)), RATE));
    expect(found.roundTrip).toBe(321);
  });

  it('finds it through a path that inverts the signal', () => {
    expect(valueOf(measureRoundTrip(heardBack(2_000, -0.4), RATE)).roundTrip).toBe(2_000);
  });

  it('finds the direct sound, not a quieter reflection after it', () => {
    const reflected = heardBack(900, 0.3, heardBack(600, 0.5));
    expect(valueOf(measureRoundTrip(reflected, RATE)).roundTrip).toBe(600);
  });

  it('finds the longest round trip it searches for, and none at zero', () => {
    expect(valueOf(measureRoundTrip(heardBack(8_000, 0.5), RATE)).roundTrip).toBe(8_000);
    expect(valueOf(measureRoundTrip(heardBack(0, 0.5), RATE)).roundTrip).toBe(0);
  });

  it('measures at the rate given, in frames of that rate', () => {
    const rate = valueOf(sampleRate(48_000));
    const captured = new Float32Array(loopbackCaptureLength(rate));
    captured.set(
      calibrationSignal().map((sample) => sample * 0.5),
      9_600,
    );
    expect(valueOf(measureRoundTrip(captured, rate)).roundTrip).toBe(9_600);
  });

  it('refuses a capture with no loopback: noise alone has a largest lag, and it is not a round trip', () => {
    const result = measureRoundTrip(roomNoise(11, 0.25), RATE);
    expect(codeOf(result)).toBe('recording.loopback-unclear');
    if (!result.ok)
      expect(result.failures[0].details?.['peakRatio']).toBeLessThan(MINIMUM_PEAK_RATIO);
  });

  it('refuses a burst heard too faintly under the noise to stand clear', () => {
    expect(codeOf(measureRoundTrip(heardBack(500, 0.01, roomNoise(3, 0.25)), RATE))).toBe(
      'recording.loopback-unclear',
    );
  });

  it('refuses a silent capture', () => {
    expect(codeOf(measureRoundTrip(new Float32Array(loopbackCaptureLength(RATE)), RATE))).toBe(
      'recording.loopback-silent',
    );
  });

  it('refuses a capture too short for every lag to be searched', () => {
    const short = heardBack(100, 0.5).subarray(0, loopbackCaptureLength(RATE) - 1);
    expect(codeOf(measureRoundTrip(short, RATE))).toBe('recording.loopback-too-short');
  });

  it('asks for the burst plus a second of lags', () => {
    expect(loopbackCaptureLength(RATE)).toBe(8_000 + 4_095);
  });
});
