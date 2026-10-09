import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import { TEST_RATE, processorValues, runProcessor } from '../testing/processor-run.js';
import { changedFrames, faded, withPop } from '../testing/repair-signals.js';
import { DE_POP } from './de-pop.js';
import { MovingAverageLowPass, averageDelay, averageLength } from './moving-average.js';

/**
 * A 40 Hz thump decaying over 8 ms on a 1 kHz tone, split at 150 Hz: within
 * 30 dB of its peak for 28 ms, so found as a pop up to 50 ms long.
 */
const VALUES = { frequency: 150, 'maximum-length': 50 };
const POP = { at: 20_000, frequency: 40, decay: 0.008, size: 0.5 };
const TONE = faded(
  Float32Array.from({ length: 48_000 }, (_, frame) => 0.2 * Math.sin((2 * Math.PI * frame) / 48)),
);
const DIRTY = withPop(TONE, POP);

function render(): Float32Array {
  const [out] = runProcessor(DE_POP, { layout: StandardLayouts.mono, values: VALUES }, [DIRTY]);
  return out ?? new Float32Array(0);
}

function latency(): number {
  const declared = DE_POP.descriptor.latency({
    values: processorValues(DE_POP, VALUES),
    sampleRate: TEST_RATE,
    quality: MAXIMUM_QUALITY.settings,
  });
  if (declared.kind !== 'known') throw new Error('A de-pop states its latency.');
  return declared.frames;
}

/** The split's impulse response at 150 Hz: `4(K − 1) + 1` frames. */
function splitResponse(length: number): Float64Array {
  const split = new MovingAverageLowPass(1, length);
  const frames = 4 * (length - 1) + 1;
  const impulse = new Float32Array(frames);
  impulse[0] = 1;
  const response = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    split.run(0, impulse, frame, frame);
    response[frame] = split.output[0] ?? 0;
  }
  return response;
}

describe('the de-pop, held to a recorded render', () => {
  it('renders a thump on a tone to the recorded bits', () => {
    expect(fingerprint(render())).toBe(6449483930332600502n);
  });

  it("splits with the moving averages' analytic response and linear phase", () => {
    const length = averageLength(TEST_RATE, 150);
    const delay = averageDelay(length);
    expect(length).toBe(103);
    const response = splitResponse(length);
    for (const frequency of [10, 40, 150, 400, 1_000]) {
      const omega = (2 * Math.PI * frequency) / TEST_RATE;
      let real = 0;
      let imaginary = 0;
      response.forEach((tap, frame) => {
        // Turned back by the delay, a linear phase leaves the response real.
        real += tap * Math.cos(omega * (frame - delay));
        imaginary -= tap * Math.sin(omega * (frame - delay));
      });
      const analytic = (Math.sin((omega * length) / 2) / (length * Math.sin(omega / 2))) ** 4;
      expect(Math.abs(real - analytic)).toBeLessThan(1e-12);
      expect(Math.abs(imaginary)).toBeLessThan(1e-12);
    }
  });

  it('leaves the thump at most −20 dB of itself and touches nothing far from it', () => {
    const out = render();
    const delay = latency();
    let before = 0;
    let after = 0;
    for (let frame = 19_000; frame < 24_000; frame += 1) {
      before += ((DIRTY[frame] ?? 0) - (TONE[frame] ?? 0)) ** 2;
      after += ((out[frame + delay] ?? 0) - (TONE[frame] ?? 0)) ** 2;
    }
    expect(10 * Math.log10(after / before)).toBeLessThan(-20);
    const changed = changedFrames(out, DIRTY, delay);
    expect(changed.filter((frame) => frame < 19_000 || frame >= 24_000)).toEqual([]);
  });
});
