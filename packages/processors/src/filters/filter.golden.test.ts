import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { FILTER } from './filter.js';
import { binMagnitudes } from '../testing/filter-measures.js';

/** A 24 dB per octave low-pass at 2 kHz, maximally flat. */
const GOLDEN = { mode: 'low-pass', slope: '24-db', cutoff: 2_000 } as const;

const SIZE = 16_384;

/** The kernel's response to a unit impulse at `values`, `SIZE` frames of it. */
function impulseResponse(values: Readonly<Record<string, string | number>>): Float32Array {
  const impulse = new Float32Array(SIZE);
  impulse[0] = 1;
  const [response] = runProcessor(FILTER, { layout: StandardLayouts.mono, values }, [impulse]);
  return response ?? new Float32Array(0);
}

/**
 * The magnitude of a bilinear Butterworth filter of `order`: the analogue
 * response at the prewarped ratio `tan(πf/fs) / tan(πfc/fs)`, inverted for a
 * high-pass. Written from the textbook, not from the cookbook's sections.
 */
function butterworth(order: number, cutoff: number, frequency: number, high: boolean): number {
  const warped =
    Math.tan((Math.PI * frequency) / TEST_RATE) / Math.tan((Math.PI * cutoff) / TEST_RATE);
  const ratio = high ? 1 / warped : warped;
  return 1 / Math.sqrt(1 + ratio ** (2 * order));
}

describe('the filter, held to a recorded render', () => {
  it('renders noise through a 24 dB low-pass to the recorded bits', () => {
    const input = [noise(3, { length: 48_000 }).channels[0] ?? new Float32Array(0)];
    const [output] = runProcessor(FILTER, { layout: StandardLayouts.mono, values: GOLDEN }, input);
    expect(fingerprint(output ?? new Float32Array(0))).toBe(17398193211701596699n);
  });

  it("measures, by the FFT of its impulse response, the textbook Butterworth filter's magnitude", () => {
    // Bins near 500 Hz, 1 kHz, 2 kHz, 4 kHz and 8 kHz, each at its exact frequency.
    const bins = [171, 341, 683, 1_365, 2_731];
    for (const [slope, order] of [
      ['12-db', 2],
      ['24-db', 4],
      ['48-db', 8],
    ] as const) {
      for (const mode of ['low-pass', 'high-pass'] as const) {
        const measured = binMagnitudes(impulseResponse({ ...GOLDEN, slope, mode }));
        for (const bin of bins) {
          const expected = butterworth(
            order,
            2_000,
            (bin * TEST_RATE) / SIZE,
            mode === 'high-pass',
          );
          // The response is stored as f32, each sample within a part in 2²⁴.
          expect(Math.abs((measured[bin] ?? 0) - expected)).toBeLessThan(1e-6);
        }
      }
    }
  });
});
