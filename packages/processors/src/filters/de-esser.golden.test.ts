import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise, sine } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { DE_ESSER } from './de-esser.js';
import { sineGain } from '../testing/filter-measures.js';

describe('the de-esser, held to a recorded render', () => {
  it('renders bursts of sibilance over hiss to the recorded bits', () => {
    const sibilant =
      sine(6_000, { amplitude: 0.5, length: TEST_RATE }).channels[0] ?? new Float32Array(0);
    const hiss = noise(3, { length: TEST_RATE, amplitude: 0.1 }).channels[0] ?? new Float32Array(0);
    const input = sibilant.map(
      (sample, frame) => (frame % 9_600 < 2_400 ? sample : 0) + (hiss[frame] ?? 0),
    );
    const values = { threshold: -24, range: 10, attack: 0.5, release: 40 };
    const [output] = runProcessor(DE_ESSER, { layout: StandardLayouts.mono, values }, [input]);
    expect(fingerprint(output ?? new Float32Array(0))).toBe(12206319204711652309n);
  });

  it('follows its static curve: the excess over the threshold taken off, up to the range', () => {
    // A tone at the detection frequency is its own band, so its level is the
    // envelope's; a fast attack and a slow release hold the envelope at its
    // peaks.
    const values = { frequency: 6_000, threshold: -30, range: 12, attack: 0.1, release: 500 };
    for (const level of [-40, -30, -26, -20, -14, -6]) {
      const expected = -Math.min(12, Math.max(0, level + 30));
      const measured = sineGain(DE_ESSER, values, 6_000, 1, 10 ** (level / 20));
      expect(Math.abs(measured - expected)).toBeLessThan(0.05);
    }
  });
});
