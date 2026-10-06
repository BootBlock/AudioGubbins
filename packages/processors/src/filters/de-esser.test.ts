import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts, type ParameterValue } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise, sine } from '@audiogubbins/test-fixtures';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { DE_ESSER } from './de-esser.js';
import { EVERY_LAYOUT, binMagnitudes, decibels } from '../testing/filter-measures.js';

processorProperties(DE_ESSER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { mode: 'wideband', threshold: -50, range: 24, attack: 0.1, release: 5 },
    { frequency: 12_000, threshold: -60, range: 12, attack: 20, release: 500 },
  ],
  bound: 4,
  // With no range the gain is unity, and `x − 0·band` is the input to the bit.
  passThrough: { values: { range: 0, threshold: -60 }, tolerance: 0 },
});

const LENGTH = TEST_RATE;

/** A sine of `frequency` at `amplitude`, `LENGTH` frames of it. */
function tone(frequency: number, amplitude: number): Float32Array {
  return sine(frequency, { amplitude, length: LENGTH }).channels[0] ?? new Float32Array(0);
}

/**
 * The magnitude of the 187.5 Hz and 6 kHz bins over the last 4,096 frames of
 * `signal`: each tone a whole number of cycles there, so each its own bin.
 */
function bins(signal: Float32Array): readonly [number, number] {
  const measured = binMagnitudes(signal.slice(LENGTH - 4_096));
  return [measured[16] ?? 0, measured[512] ?? 0];
}

/** The change in decibels of each bin from `input` to `output`. */
function change(input: Float32Array, output: Float32Array): readonly [number, number] {
  const [low, high] = bins(input);
  const [lowOut, highOut] = bins(output);
  return [decibels(lowOut / low), decibels(highOut / high)];
}

const LOUD = { threshold: -30, range: 12, attack: 0.1, release: 500 };

describe('the de-esser', () => {
  it('turns down only the sibilant band in split-band mode, and everything wideband', () => {
    const low = tone(187.5, 0.3);
    const high = tone(6_000, 0.3);
    const input = low.map((sample, frame) => sample + (high[frame] ?? 0));
    const run = (values: Readonly<Record<string, ParameterValue>>) =>
      runProcessor(DE_ESSER, { layout: StandardLayouts.mono, values }, [input])[0] ??
      new Float32Array(0);
    const [splitLow, splitHigh] = change(input, run(LOUD));
    expect(Math.abs(splitLow)).toBeLessThan(0.1);
    expect(Math.abs(splitHigh + 12)).toBeLessThan(0.3);
    const [wideLow, wideHigh] = change(input, run({ ...LOUD, mode: 'wideband' }));
    expect(Math.abs(wideLow + 12)).toBeLessThan(0.3);
    expect(Math.abs(wideHigh + 12)).toBeLessThan(0.3);
  });

  it('links its channels: sibilance in one turns every channel down together', () => {
    const sibilant = tone(6_000, 0.3);
    const plain = tone(187.5, 0.3);
    const values = { ...LOUD, mode: 'wideband' };
    // The sibilance in each channel in turn, so no one channel's envelope
    // stands in for the link.
    for (const sibilantChannel of [0, 1]) {
      const input = sibilantChannel === 0 ? [sibilant, plain] : [plain, sibilant];
      const output = runProcessor(DE_ESSER, { layout: StandardLayouts.stereo, values }, input);
      const other = 1 - sibilantChannel;
      const reduced = change(input[other] ?? plain, output[other] ?? plain)[0];
      expect(Math.abs(reduced + 12)).toBeLessThan(0.3);
    }
  });

  it('moves its threshold while it plays to the same bits however the stream is cut', () => {
    const input = [noise(9, { length: 12_000, amplitude: 0.5 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: { threshold: -10 } };
    const moved = { frame: 4_999, name: 'threshold', value: -40 };
    const [steady] = runProcessor(DE_ESSER, settings, input, [4_096], moved);
    const [cut] = runProcessor(DE_ESSER, settings, input, [1, 7, 128, 333, 31], moved);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const [unmoved] = runProcessor(DE_ESSER, settings, input);
    expect(unmoved?.slice(5_100)).not.toEqual(steady?.slice(5_100));
  });

  it('refuses to change its mode while running, or a range past its own', () => {
    const { kernel } = processorKernel(DE_ESSER, { layout: StandardLayouts.stereo });
    expect(expectFailureCode(kernel.setParameter('mode', 1))).toBe('node.parameter-unknown');
    expect(expectFailureCode(kernel.setParameter('range', 30))).toBe('node.parameter-invalid');
    expect(kernel.setParameter('release', 200).ok).toBe(true);
  });

  it('started part way, matches a whole run once the lead-in it declares has passed', () => {
    const values = { threshold: -40, range: 18, release: 20 };
    const settings = {
      values: processorValues(DE_ESSER, values),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    const leadIn = DE_ESSER.descriptor.leadIn(settings);
    const sibilant = tone(6_000, 0.5);
    const hiss = noise(10, { length: LENGTH, amplitude: 0.2 }).channels[0] ?? new Float32Array(0);
    const programme = sibilant.map(
      (sample, frame) => (frame % 12_000 < 6_000 ? sample : 0) + (hiss[frame] ?? 0),
    );
    const start = 9_000;
    const layout = StandardLayouts.mono;
    const [whole = new Float32Array(0)] = runProcessor(DE_ESSER, { layout, values }, [programme]);
    const [late = new Float32Array(0)] = runProcessor(DE_ESSER, { layout, values }, [
      programme.slice(start),
    ]);
    let worst = 0;
    for (let frame = leadIn; frame < late.length; frame += 1) {
      worst = Math.max(worst, Math.abs((late[frame] ?? 0) - (whole[start + frame] ?? 0)));
    }
    expect(leadIn).toBeLessThan(late.length / 2);
    expect(worst).toBeLessThan(1e-5);
  });
});
