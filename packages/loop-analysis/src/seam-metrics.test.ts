import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, gainToDecibels, sineOfTurns } from '@audiogubbins/audio-engine';
import {
  FadeShape,
  StandardLayouts,
  createCancellationSource,
  sampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analyseLoop } from './analyse-loop.js';
import { binOf, binValue } from './envelope-histogram.js';
import type { LoopMetrics } from './seam-metrics.js';
import { fixtureSource } from './testing/loop-fixtures.js';

const RATE = expectSuccess(sampleRate(48_000));

/** The current metrics of the loop `[start, end)` over `channels`. */
async function metricsOf(
  channels: readonly Float32Array[],
  start: number,
  end: number,
): Promise<LoopMetrics> {
  const source = fixtureSource({
    layout: channels.length === 1 ? StandardLayouts.mono : StandardLayouts.stereo,
    sampleRate: RATE,
    channels,
  });
  const analysis = await analyseLoop(
    source,
    source,
    { loop: { start, end, crossfadeLength: 0, crossfadeShape: FadeShape.Linear } },
    {
      dsp: REFERENCE_DSP,
      signal: createCancellationSource().signal,
      yieldToHost: () => Promise.resolve(),
      onProgress: () => undefined,
    },
  );
  return expectSuccess(analysis).current;
}

/** `frames` frames of `value` from `from`, with each `[from, to, value)` run set over them. */
function runs(
  frames: number,
  value: number,
  ...set: readonly (readonly [number, number, number])[]
): Float32Array {
  const samples = new Float32Array(frames).fill(value);
  for (const [from, to, run] of set) samples.fill(run, from, to);
  return samples;
}

/** A sine of `frequency` whole hertz. */
function sine(frequency: number, frames: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, n) => amplitude * sineOfTurns(((frequency * n) % 48_000) / 48_000),
  );
}

/** A uniform value in `[−1, 1)`, from a 32-bit counter hash. */
function noiseAt(index: number): number {
  let state = Math.imul(index ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 15)) >>> 0) / 2 ** 31 - 1;
}

describe('the level mismatch', () => {
  it('is the dB between what plays after E and what follows E', async () => {
    // The head is at 0.25, the audio after E at 0.5: 6 dB apart.
    const metrics = await metricsOf([runs(30_000, 0.25, [25_000, 30_000, 0.5])], 5_000, 25_000);
    expect(metrics.levelMismatch.reference).toBe('post-end');
    expect(metrics.levelMismatch.value).toBeCloseTo(gainToDecibels(2), 9);
    expect(metrics.levelMismatch.verdict).toBe('fail');
  });

  it('is zero between two silences, and floors a silent side at 2⁻²⁴ against a sound one', async () => {
    expect((await metricsOf([new Float32Array(30_000)], 5_000, 25_000)).levelMismatch.value).toBe(
      0,
    );
    const silentHead = await metricsOf([runs(30_000, 0.5, [5_000, 7_400, 0])], 5_000, 25_000);
    expect(silentHead.levelMismatch.value).toBeCloseTo(-gainToDecibels(2 ** -24 / 0.5), 9);
  });
});

describe('the DC mismatch and net DC', () => {
  it("weighs each side's mean against the other's", async () => {
    const samples = sine(480, 40_000, 0.5);
    for (let n = 28_800; n < samples.length; n += 1) samples[n] = (samples[n] ?? 0) + 0.02;
    const metrics = await metricsOf([samples], 4_800, 28_800);
    expect(metrics.dcMismatch.value).toBeCloseTo(gainToDecibels(0.02), 2);
    expect(metrics.dcMismatch.verdict).toBe('fail');
  });

  it("is the loop's own mean, a steady offset there no mismatch", async () => {
    const metrics = await metricsOf([new Float32Array(30_000).fill(0.002)], 5_000, 25_000);
    expect(metrics.netDc.value).toBeCloseTo(gainToDecibels(0.002), 6);
    expect(metrics.netDc.verdict).toBe('warn');
    expect(metrics.dcMismatch.verdict).toBe('pass');
  });
});

describe('the phase mismatch', () => {
  it('is the phase the head arrives at against what follows E, at the dominant partial', async () => {
    // A 400 Hz sine, 120 frames a period, its loop 10 frames short of whole periods: 30°.
    const metrics = await metricsOf([sine(400, 40_000, 0.5)], 4_800, 28_790);
    expect(metrics.phaseMismatch.value).toBeCloseTo(30, 0);
    expect(metrics.phaseMismatch.verdict).toBe('warn');
  });

  it('is not applicable to noise, which has no partial standing 20 dB above the median', async () => {
    const noise = Float32Array.from({ length: 30_000 }, (_, n) => 0.3 * noiseAt(n));
    const metrics = await metricsOf([noise], 5_000, 25_000);
    expect(metrics.phaseMismatch.verdict).toBe('not-applicable');
    expect(metrics.phaseMismatch.reason).toBe(
      'No partial stands 20 dB above the median of the spectrum.',
    );
  });
});

describe('the spectral mismatch', () => {
  it('is the dB between the bands of the two windows', async () => {
    // What follows E is the head at half its level: 6 dB in every band.
    const samples = Float32Array.from({ length: 30_000 }, (_, n) => 0.3 * noiseAt(n));
    for (let n = 0; n < 2_400; n += 1) samples[25_000 + n] = 0.5 * (samples[5_000 + n] ?? 0);
    const metrics = await metricsOf([samples], 5_000, 25_000);
    expect(metrics.spectralMismatch.value).toBeCloseTo(gainToDecibels(2), 6);
    expect(metrics.spectralMismatch.verdict).toBe('fail');
  });
});

describe('the zero crossings', () => {
  // Positive but for two negative runs: crossings at 5,003, 5,060, 24,999 and 25,001.
  const crossings = runs(30_000, 0.25, [5_003, 5_060, -0.25], [24_999, 25_001, -0.25]);

  it('are the frames from each boundary to the nearest crossing inside the region', async () => {
    const metrics = await metricsOf([crossings], 5_000, 25_000);
    expect([metrics.zeroCrossing.start.value, metrics.zeroCrossing.start.verdict]).toEqual([
      3,
      'warn',
    ]);
    expect([metrics.zeroCrossing.end.value, metrics.zeroCrossing.end.verdict]).toEqual([1, 'pass']);
  });

  it("count the channels whose sign after the seam differs from the region's own after E", async () => {
    expect((await metricsOf([crossings], 5_000, 25_000)).zeroCrossing.signs.value).toBe(1);
    const steady = runs(30_000, 0.25);
    const stereo = await metricsOf([crossings, steady], 5_000, 25_000);
    expect([stereo.zeroCrossing.signs.value, stereo.zeroCrossing.signs.verdict]).toEqual([
      0.5,
      'warn',
    ]);
  });

  it('never count the start of the region as a crossing', async () => {
    const whole = await metricsOf([runs(30_000, 0.25, [3, 30_000, -0.25])], 0, 30_000);
    expect(whole.zeroCrossing.start.value).toBe(3);
  });
});

describe('the reference each seam metric uses', () => {
  const samples = sine(480, 24_000, 0.5);

  it('is the audio before S where the region ends at E', async () => {
    expect((await metricsOf([samples], 4_800, 24_000)).levelMismatch.reference).toBe('pre-start');
  });

  it("is the loop's own tail and head for a loop over the whole region", async () => {
    expect((await metricsOf([samples], 0, 24_000)).levelMismatch.reference).toBe('adjacent');
  });
});

describe('the discontinuity', () => {
  it('finds a click at the head, which only the audio before S also has', async () => {
    const samples = sine(480, 40_000, 0.5);
    samples[4_800] = 0.5;
    const metrics = await metricsOf([samples], 4_800, 28_800);
    expect(metrics.discontinuity.verdict).toBe('fail');
    expect(metrics.discontinuity.reference).toBe('post-end');
  });
});

describe('the cycle stability', () => {
  it('measures a steady seam against the 0.05 dB floor, not a zero deviation', async () => {
    const metrics = await metricsOf([new Float32Array(30_000).fill(0.25)], 5_000, 25_000);
    const level = gainToDecibels(0.25);
    expect(metrics.cycleStability.seam.value).toBeCloseTo(
      Math.abs(level - binValue(binOf(level))) / 0.05,
      9,
    );
  });

  it('finds a loop taken from a fade, whose start is louder than what follows its end', async () => {
    // The level falls 20 dB across the region: the loop's start is 8 dB
    // above the audio after its end.
    const frames = 60_000;
    const fading = Float32Array.from(
      { length: frames },
      (_, n) => 0.5 * 10 ** (-n / frames) * sineOfTurns(((480 * n) % 48_000) / 48_000),
    );
    const metrics = await metricsOf([fading], 4_800, 4_800 + 24_000);
    expect(metrics.cycleStability.drift.reference).toBe('post-end');
    expect(metrics.cycleStability.drift.value).toBeGreaterThan(7);
    expect(metrics.cycleStability.drift.verdict).toBe('fail');
  });
});
