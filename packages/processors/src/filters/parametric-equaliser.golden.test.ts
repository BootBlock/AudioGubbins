import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { BiquadCascade } from './biquad.js';
import { BiquadShape } from './biquad-shape.js';
import { PARAMETRIC_EQUALISER } from './parametric-equaliser.js';
import { analyticMagnitude, binMagnitudes, decibels } from '../testing/filter-measures.js';

const SIZE = 16_384;

/** The frequency of FFT bin `bin` of `SIZE` frames. */
const binFrequency = (bin: number): number => (bin * TEST_RATE) / SIZE;

/**
 * A low shelf, a bell centred on bin 341 (999.0234375 Hz), and a high cut:
 * the bell's centre is a frequency the FFT measures exactly.
 */
const GOLDEN = {
  'band-2-on': true,
  'band-2-frequency': 120,
  'band-2-gain': -4,
  'band-5-on': true,
  'band-5-frequency': binFrequency(341),
  'band-5-gain': 9,
  'band-5-q': 1.5,
  'band-8-on': true,
  'band-8-frequency': 12_000,
} as const;

function impulseResponse(
  values: Readonly<Record<string, string | number | boolean>>,
): Float32Array {
  const impulse = new Float32Array(SIZE);
  impulse[0] = 1;
  const [response] = runProcessor(PARAMETRIC_EQUALISER, { layout: StandardLayouts.mono, values }, [
    impulse,
  ]);
  return response ?? new Float32Array(0);
}

describe('the parametric equaliser, held to a recorded render', () => {
  it('renders noise through a shelf, a bell and a cut to the recorded bits', () => {
    const input = [noise(3, { length: 48_000 }).channels[0] ?? new Float32Array(0)];
    const [output] = runProcessor(
      PARAMETRIC_EQUALISER,
      { layout: StandardLayouts.mono, values: GOLDEN },
      input,
    );
    expect(fingerprint(output ?? new Float32Array(0))).toBe(5254815747477499596n);
  });

  it('measures, by the FFT of its impulse response, the response its sections give', () => {
    const sections = new BiquadCascade(1, 3);
    sections.design(0, BiquadShape.LowShelf, 120, TEST_RATE, -4, 1);
    sections.design(1, BiquadShape.Peaking, binFrequency(341), TEST_RATE, 9, 1.5);
    sections.design(2, BiquadShape.LowPass, 12_000, TEST_RATE, 0, Math.SQRT1_2);
    const measured = binMagnitudes(impulseResponse(GOLDEN));
    for (const bin of [6, 41, 341, 1_365, 4_096, 6_826]) {
      const expected = analyticMagnitude(sections.coefficients, bin / SIZE);
      // The response is stored as f32, each sample within a part in 2²⁴.
      expect(Math.abs((measured[bin] ?? 0) - expected)).toBeLessThan(1e-5);
    }
  });

  it("gives a lone bell the cookbook's gain at its centre, measured within 0.01 dB", () => {
    for (const gain of [-12, 9, 24]) {
      const values = {
        'band-5-on': true,
        'band-5-frequency': binFrequency(341),
        'band-5-gain': gain,
        'band-5-q': 1.5,
      };
      const measured = binMagnitudes(impulseResponse(values));
      expect(Math.abs(decibels(measured[341] ?? 0) - gain)).toBeLessThan(0.01);
    }
  });
});
