import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { DE_HUM } from './de-hum.js';
import { binMagnitudes, decibels } from '../testing/filter-measures.js';

const SIZE = 65_536;

/**
 * An offset that puts the fundamental on bin 68 of the FFT, 49.8046875 Hz,
 * and so every harmonic on a bin: the notches' centres are frequencies the
 * FFT measures exactly.
 */
const ON_A_BIN = (68 * TEST_RATE) / SIZE - 50;

function impulseResponse(values: Readonly<Record<string, string | number>>): Float32Array {
  const impulse = new Float32Array(SIZE);
  impulse[0] = 1;
  const [response] = runProcessor(DE_HUM, { layout: StandardLayouts.mono, values }, [impulse]);
  return response ?? new Float32Array(0);
}

describe('de-hum, held to a recorded render', () => {
  it('renders noise through partial notches to the recorded bits', () => {
    const input = [noise(3, { length: 48_000 }).channels[0] ?? new Float32Array(0)];
    const values = { fundamental: '60-hz', harmonics: 6, q: 20, depth: 30, offset: 0.4 };
    const [output] = runProcessor(DE_HUM, { layout: StandardLayouts.mono, values }, input);
    expect(fingerprint(output ?? new Float32Array(0))).toBe(3421675414661379073n);
  });

  it('measures a lone notch at the depth asked for, at its centre, within 0.01 dB', () => {
    for (const depth of [10, 25, 40]) {
      const values = { offset: ON_A_BIN, q: 5, depth, harmonics: 1 };
      const measured = binMagnitudes(impulseResponse(values));
      expect(Math.abs(decibels(measured[68] ?? 0) + depth)).toBeLessThan(0.01);
      // Far from the notch the response is whole again.
      expect(Math.abs(decibels(measured[68 * 6] ?? 0))).toBeLessThan(0.01);
    }
  });

  it("measures a full notch's centre as nothing, and the notch as wide at every depth", () => {
    const full = binMagnitudes(impulseResponse({ offset: ON_A_BIN, q: 5, depth: 60 }));
    for (const harmonic of [1, 2, 3, 4]) {
      expect(decibels(full[68 * harmonic] ?? 0)).toBeLessThan(-100);
    }
    // A partial notch has the full notch's poles: at the full notch's −3 dB
    // edge, `f·(1 + 1/2Q)`, a notch 40 dB deep is within a decibel of it.
    const partial = binMagnitudes(impulseResponse({ offset: ON_A_BIN, q: 5, depth: 40 }));
    const edge = Math.round(68 * 4 * (1 + 1 / 10));
    expect(Math.abs(decibels(partial[edge] ?? 0) - decibels(full[edge] ?? 0))).toBeLessThan(1);
  });
});
