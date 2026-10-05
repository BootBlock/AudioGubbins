import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { DELAY } from './delay.js';

/** Echoes every 10 ms, a whole 480 frames, at 60 % feedback, damped at 6 kHz. */
const GOLDEN = { time: 10, feedback: 60, damping: 6_000 } as const;
const D = 480;
const AT = 1_000;

describe('the delay, held to a recorded render', () => {
  it('renders noise to the recorded bits', () => {
    const input = [noise(5, { length: 48_000 }).channels[0] ?? new Float32Array(0)];
    const [output] = runProcessor(DELAY, { layout: StandardLayouts.mono, values: GOLDEN }, input);
    expect(fingerprint(output ?? new Float32Array(0))).toBe(17416776384923137161n);
  });

  it('puts each echo of an impulse at its exact frame, each the feedback times the last', () => {
    const impulse = new Float32Array(12_000);
    impulse[AT] = 1;
    const [response = new Float32Array(0)] = runProcessor(
      DELAY,
      { layout: StandardLayouts.mono, values: GOLDEN },
      [impulse],
    );
    // The low-pass's coefficient, written apart from the kernel's canonical one.
    const a = 1 - Math.exp((-2 * Math.PI * GOLDEN.damping) / TEST_RATE);
    const gain = GOLDEN.feedback / 100;
    expect(response.slice(0, AT + D).every((sample) => sample === 0)).toBe(true);
    for (let k = 1; k <= 8; k += 1) {
      const first = AT + k * D;
      // Each echo starts on its frame: the first sample of the k-th has passed
      // the low-pass k − 1 times at its first tap, a, each time.
      expect(response[first - 1] ?? 1).toBeLessThan(1e-3 * gain ** (k - 1));
      expect(response[first]).toBeCloseTo((gain * a) ** (k - 1), 6);
      let sum = 0;
      for (let frame = first; frame < first + D; frame += 1) sum += response[frame] ?? 0;
      // The low-pass keeps DC, so the echo carries the feedback to the power.
      expect(sum).toBeCloseTo(gain ** (k - 1), 5);
    }
  });
});
