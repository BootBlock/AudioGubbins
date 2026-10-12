/**
 * What the measuring objects measure, held to values known independently of
 * the code: analytic spectra, the EBU loudness test signals, and detector
 * features of signals built to have a click, a hum, clipping or an offset
 * where the test puts it. Each runs through the port on both
 * implementations, which also refuse the same settings and calls alike.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { DetectorKind, type DetectorSettings, StftWindow } from './canonical-analysis.js';
import type { CanonicalDsp } from './canonical-dsp.js';
import { decibelsToGain } from './reference/decibels.js';
import { sineOfTurns } from './reference/primitives.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

const RATE = expectSuccess(sampleRate(48_000));

/** `frames` samples of `amplitude · sin(2π · turns · n + phase)`. */
function sine(frames: number, turns: number, amplitude: number, phase = 0): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, n) => amplitude * sineOfTurns(n * turns + phase),
  );
}

/** A seeded generator in `[−1, 1)`: Marsaglia's xorshift. */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2_147_483_648 - 1;
  };
}

/** Every record `settings` describe over one channel of `samples`, pushed whole. */
function recordsOf(dsp: CanonicalDsp, settings: DetectorSettings, samples: Float32Array): number[] {
  const features = expectSuccess(dsp.createDetectorFeatures(settings));
  features.push([samples]);
  const records = new Float64Array(64 * features.recordWidth);
  const all: number[] = [];
  for (let pulled = features.pull(records); pulled > 0; pulled = features.pull(records)) {
    all.push(...records.subarray(0, pulled * features.recordWidth));
  }
  features.release();
  return all;
}

/**
 * Feeds a 1 kHz sine at 48 kHz to a loudness meter of `layout`, segment by
 * segment, each `[levels per channel in dBFS peak, seconds]`, and answers the
 * meter's reading and its last momentary and short-term pair.
 */
function loudnessOf(
  dsp: CanonicalDsp,
  layout: ChannelLayout,
  segments: readonly (readonly [readonly number[], number])[],
): { integrated: number; range: number; last: readonly number[] } {
  const meter = expectSuccess(dsp.createLoudnessMeter({ sampleRate: RATE, layout }));
  // A whole number of periods a chunk, so every chunk is the same.
  const period = Float32Array.from({ length: 4_800 }, (_, n) => sineOfTurns((n % 48) / 48));
  const series = new Float64Array(2);
  const last = [Number.NaN, Number.NaN];
  for (const [levels, seconds] of segments) {
    const chunk = levels.map((level) => period.map((value) => value * decibelsToGain(level)));
    for (let count = 0; count < Math.round(seconds * 10); count += 1) {
      meter.push(chunk);
      while (meter.pullSeries(series) > 0) last.splice(0, 2, ...series);
    }
  }
  const reading = meter.read();
  meter.release();
  return { ...reading, last };
}

describe.each([
  ['the WebAssembly module', (): CanonicalDsp => wasm],
  ['the reference path', (): CanonicalDsp => REFERENCE_DSP],
])('the measuring objects in %s', (_name, dspOf) => {
  it('refuse settings out of range, with the reason', () => {
    const dsp = dspOf();
    expect(
      expectFailureCode(
        dsp.createStft({ channels: 1, size: 48, hop: 16, window: StftWindow.Hann }),
      ),
    ).toBe('dsp.stft-settings-invalid');
    expect(
      expectFailureCode(
        dsp.createStft({ channels: 0, size: 64, hop: 16, window: StftWindow.Hann }),
      ),
    ).toBe('dsp.stft-settings-invalid');
    // Settings may be read from data, where a window can be one neither path knows.
    expect(
      expectFailureCode(
        dsp.createStft({ channels: 1, size: 64, hop: 16, window: 'flat-top' as StftWindow }),
      ),
    ).toBe('dsp.stft-settings-invalid');
    expect(expectFailureCode(dsp.createPeakMeter({ channels: 257, sampleRate: RATE }))).toBe(
      'dsp.peak-meter-settings-invalid',
    );
    const basis = { channels: 1, sampleRate: RATE } as const;
    for (const settings of [
      { ...basis, kind: DetectorKind.Clicks, block: 63, sensitivity: 3 },
      { ...basis, kind: DetectorKind.Hum, size: 4_096, hop: 1_024, searchWidth: 5, floorWidth: 5 },
      { ...basis, kind: DetectorKind.NoiseFloor, frame: 256, hop: 128, percentile: 2, history: 8 },
      { ...basis, kind: DetectorKind.Clipping, block: 256, epsilon: -1, minimumRun: 2 },
      { ...basis, kind: DetectorKind.DcOffset, window: 100, hop: 101 },
      { ...basis, kind: DetectorKind.Silence, block: 0, threshold: 0.001 },
      { ...basis, kind: DetectorKind.Silence, block: 256, threshold: Number.NaN },
    ] satisfies DetectorSettings[]) {
      expect(expectFailureCode(dsp.createDetectorFeatures(settings))).toBe(
        'dsp.detector-settings-invalid',
      );
    }
  });

  it('throw the same fault for input and output of the wrong shape', () => {
    const stft = expectSuccess(
      dspOf().createStft({ channels: 2, size: 8, hop: 4, window: StftWindow.Hann }),
    );
    expect(() => {
      stft.push([new Float32Array(4)]);
    }).toThrow('A short-time Fourier transform of 2 channels was given 1 arrays.');
    expect(() => stft.pullComplex(new Float64Array(9), new Float64Array(10))).toThrow(
      'A short-time Fourier transform’s real parts takes 10 values, and was given 9.',
    );
    expect(() => stft.pullPolar(new Float64Array(10), new Float64Array(11))).toThrow(
      'A short-time Fourier transform’s phases takes 10 values, and was given 11.',
    );
    stft.release();
    const meter = expectSuccess(dspOf().createPeakMeter({ channels: 2, sampleRate: RATE }));
    expect(() => {
      meter.push([new Float32Array(4), new Float32Array(5)]);
    }).toThrow('A peak meter was given channel arrays of different lengths.');
    meter.release();
  });

  it('transforms a sine centred on a bin to its analytic spectrum', () => {
    // A full-scale sine on bin 8 of 64, Hann windowed: N/4 at bin 8, N/8 at
    // its neighbours, nothing elsewhere, and the sine's phase of −1/4 turn.
    const stft = expectSuccess(
      dspOf().createStft({ channels: 1, size: 64, hop: 64, window: StftWindow.Hann }),
    );
    stft.push([sine(64, 8 / 64, 1)]);
    const magnitudes = new Float64Array(stft.bins);
    const phases = new Float64Array(stft.bins);
    expect(stft.pullPolar(magnitudes, phases)).toBe(true);
    expect(stft.pullPolar(magnitudes, phases)).toBe(false);
    stft.release();
    expect(magnitudes[8]).toBeCloseTo(16, 5);
    expect(magnitudes[7]).toBeCloseTo(8, 5);
    expect(magnitudes[9]).toBeCloseTo(8, 5);
    expect(phases[8]).toBeCloseTo(-0.25, 6);
    const elsewhere = magnitudes.filter((_, bin) => bin < 7 || bin > 9);
    expect(Math.max(...elsewhere)).toBeLessThan(1e-5);
  });

  it('finds the true peak between the samples of EBU Tech 3341 case 16', () => {
    // A quarter-rate sine at −6 dBFS from 45°: every sample is 3 dB lower.
    const meter = expectSuccess(dspOf().createPeakMeter({ channels: 1, sampleRate: RATE }));
    meter.push([sine(4_800, 0.25, decibelsToGain(-6), 0.125)]);
    const reading = new Float64Array(4);
    meter.read(reading);
    meter.release();
    // The sample peak in dBFS, then the true peak in dBTP.
    expect(reading[1]).toBeCloseTo(-9.01, 2);
    expect(Math.abs((reading[3] ?? 0) + 6)).toBeLessThan(0.1);
  });

  it('never reads the true peak of a full-scale impulse under its sample peak, at any rate', () => {
    // The interpolating filter writes a sample at 0.972 of itself at most.
    for (const hertz of [44_100, 48_000, 96_000, 192_000]) {
      const impulse = new Float32Array(64);
      impulse[20] = -1;
      const meter = expectSuccess(
        dspOf().createPeakMeter({ channels: 1, sampleRate: expectSuccess(sampleRate(hertz)) }),
      );
      meter.push([impulse]);
      const reading = new Float64Array(4);
      meter.read(reading);
      meter.release();
      expect([...reading]).toEqual([1, 0, 1, 0]);
    }
  });

  it('measures EBU Tech 3341 case 1 at −23 LUFS within a tenth', () => {
    const { integrated, last } = loudnessOf(dspOf(), StandardLayouts.stereo, [[[-23, -23], 20]]);
    for (const value of [integrated, ...last]) expect(Math.abs(value + 23)).toBeLessThan(0.1);
  });

  it('weights a 5.0 programme by its roles, as EBU Tech 3341 case 6', () => {
    // Left, right, centre, the silent low-frequency channel, and the surrounds.
    const levels = [-28, -28, -24, -200, -30, -30];
    const { integrated } = loudnessOf(dspOf(), StandardLayouts.surround5_1, [[levels, 20]]);
    expect(Math.abs(integrated + 23)).toBeLessThan(0.1);
  });

  it('measures the loudness range of EBU Tech 3342 case 1 within one LU', () => {
    const { range } = loudnessOf(dspOf(), StandardLayouts.stereo, [
      [[-20, -20], 20],
      [[-30, -30], 20],
    ]);
    expect(Math.abs(range - 10)).toBeLessThan(1);
  });

  it('finds a click within a sample', () => {
    const next = noise(5);
    const samples = Float32Array.from(
      { length: 8_192 },
      (_, n) => 0.4 * sineOfTurns(n * 0.011) + 0.2 * sineOfTurns(n * 0.037) + 0.001 * next(),
    );
    samples[5_000] = (samples[5_000] ?? 0) + 0.3;
    const settings = {
      kind: DetectorKind.Clicks,
      channels: 1,
      sampleRate: RATE,
      block: 1_024,
      sensitivity: 8,
    } as const;
    const events = recordsOf(dspOf(), settings, samples);
    let loudest = 0;
    for (let at = 0; at < events.length; at += 4) {
      if (Math.abs(events[at + 2] ?? 0) > Math.abs(events[loudest + 2] ?? 0)) loudest = at;
    }
    expect(Math.abs((events[loudest + 1] ?? 0) - 5_000)).toBeLessThanOrEqual(1);
  });

  it('finds a hum of known level and frequency', () => {
    const next = noise(9);
    const samples = Float32Array.from(
      { length: 96_000 },
      (_, n) => 0.01 * sineOfTurns((n * 50) / 48_000) + 1e-4 * next(),
    );
    const settings = {
      kind: DetectorKind.Hum,
      channels: 1,
      sampleRate: RATE,
      size: 16_384,
      hop: 8_192,
      searchWidth: 4,
      floorWidth: 20,
    } as const;
    const records = recordsOf(dspOf(), settings, samples);
    expect(records).toHaveLength(12 * 10);
    for (let at = 0; at < records.length; at += 12) {
      expect(Math.abs((records[at] ?? 0) - 50)).toBeLessThan(0.1);
      expect(Math.abs((records[at + 1] ?? 0) + 40)).toBeLessThan(0.5);
      expect(records[at + 2]).toBeLessThan(-70);
    }
  });

  it('finds the 13-sample runs of a sine clipped at full scale', () => {
    // 1.5 sin(2πn/48) clipped to ±1 holds full scale from n = 6 to 18 of
    // every half period.
    const samples = sine(960, 1 / 48, 1.5).map((value) => Math.min(Math.max(value, -1), 1));
    const settings = {
      kind: DetectorKind.Clipping,
      channels: 1,
      sampleRate: RATE,
      block: 480,
      epsilon: 0,
      minimumRun: 2,
    } as const;
    const expected = Array.from({ length: 40 }, (_, half) => [0, 24 * half + 6, 13, 1]).flat();
    expect(recordsOf(dspOf(), settings, samples)).toEqual(expected);
  });

  it('finds a DC offset of known value', () => {
    const samples = sine(4_800, 1 / 48, 0.5).map((value) => value + 0.25);
    const settings = {
      kind: DetectorKind.DcOffset,
      channels: 1,
      sampleRate: RATE,
      window: 480,
      hop: 240,
    } as const;
    const means = recordsOf(dspOf(), settings, samples);
    expect(means).toHaveLength(19);
    for (const mean of means) expect(Math.abs(mean - 0.25)).toBeLessThan(1e-7);
  });
});
