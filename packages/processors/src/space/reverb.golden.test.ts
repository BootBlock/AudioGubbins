import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { REVERB } from './reverb.js';
import { measuredRt60, reverbImpulse } from '../testing/reverb-measures.js';

/** A one-second hall, undamped, its tail from 10 ms. */
const GOLDEN = { size: 0.8, decay: 1, damping: 0, 'pre-delay': 10, width: 100 } as const;

describe('the reverb, held to a recorded render', () => {
  it('renders stereo noise to the recorded bits', () => {
    const input = [1, 2].map(
      (seed) => noise(seed, { length: 48_000 }).channels[0] ?? new Float32Array(0),
    );
    const output = runProcessor(REVERB, { layout: StandardLayouts.stereo, values: GOLDEN }, input);
    expect(output.map((channel) => fingerprint(channel))).toEqual([
      14508525366751316401n,
      13825250203912241396n,
    ]);
  });

  it('measures, from the energy decay of its impulse response, the RT60 it is set to within 10 %', () => {
    const response = reverbImpulse(GOLDEN, 2 * TEST_RATE);
    expect(Math.abs(measuredRt60(response, TEST_RATE) / GOLDEN.decay - 1)).toBeLessThan(0.1);
  });
});
