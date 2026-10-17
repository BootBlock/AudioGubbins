import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ParameterValue } from '@audiogubbins/domain';

import { processorValues, runProcessor } from '../testing/processor-run.js';
import { COMPRESSOR } from './compressor.js';
import { compressorTransfer } from './compressor-transfer.js';

const SECOND = 48_000;

/** The level the running compressor gives out, once settled, for a steady level in. */
function heard(values: Readonly<Record<string, ParameterValue>>, level: number): number {
  const steady = new Float32Array(SECOND).fill(10 ** (level / 20));
  const [output] = runProcessor(COMPRESSOR, { layout: StandardLayouts.mono, values }, [steady]);
  return 20 * Math.log10(output?.at(-1) ?? 0);
}

describe('the compressor’s drawn transfer curve', () => {
  // The curve a panel draws is a claim about what is heard, so each point is
  // held against the level the running compressor settles at.
  it('is the level the running compressor gives out, below, through and above its knee', () => {
    const values = { threshold: -18, ratio: 4, knee: 6, 'make-up': 3 };
    const levels = [-40, -24, -20, -18, -16, -9, -3];
    const into = new Float64Array(levels.length);
    compressorTransfer(processorValues(COMPRESSOR, values), Float64Array.from(levels), into);
    levels.forEach((level, index) => {
      expect(Math.abs((into[index] ?? Number.NaN) - heard(values, level))).toBeLessThan(0.05);
    });
  });
});
