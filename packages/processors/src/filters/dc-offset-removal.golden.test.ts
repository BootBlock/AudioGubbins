import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { DC_OFFSET_REMOVAL } from './dc-offset-removal.js';
import { binMagnitudes } from '../testing/filter-measures.js';

const SIZE = 65_536;

describe('DC offset removal, held to a recorded render', () => {
  it('renders offset noise at a 10 Hz cutoff to the recorded bits', () => {
    const source = noise(3, { length: 48_000 }).channels[0] ?? new Float32Array(0);
    const input = [source.map((sample) => sample - 0.125)];
    const values = { cutoff: 10 };
    const [output] = runProcessor(
      DC_OFFSET_REMOVAL,
      { layout: StandardLayouts.mono, values },
      input,
    );
    expect(fingerprint(output ?? new Float32Array(0))).toBe(18322120148371869484n);
  });

  it("measures, by the FFT of its impulse response, the bilinear high-pass's magnitude", () => {
    for (const cutoff of [2, 5, 40]) {
      const impulse = new Float32Array(SIZE);
      impulse[0] = 1;
      const [response = new Float32Array(0)] = runProcessor(
        DC_OFFSET_REMOVAL,
        { layout: StandardLayouts.mono, values: { cutoff } },
        [impulse],
      );
      const measured = binMagnitudes(response);
      // The textbook first-order high-pass, prewarped:
      // `1 / √(1 + (tan(πfc/fs) / tan(πf/fs))²)`, and nothing at 0 Hz.
      const warp = (frequency: number) => Math.tan((Math.PI * frequency) / TEST_RATE);
      expect(measured[0] ?? 1).toBeLessThan(1e-6);
      for (const bin of [1, 3, 8, 27, 55, 1_365]) {
        const ratio = warp(cutoff) / warp((bin * TEST_RATE) / SIZE);
        const expected = 1 / Math.sqrt(1 + ratio * ratio);
        // The response is stored as f32, each sample within a part in 2²⁴.
        expect(Math.abs((measured[bin] ?? 0) - expected)).toBeLessThan(1e-5);
      }
    }
  });
});
