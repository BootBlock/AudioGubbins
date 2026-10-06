import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE, learnedProfile, processorValues } from '@audiogubbins/processors/testing';
import { noise, sine } from '@audiogubbins/test-fixtures';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(85);
const TYPE = PROCESSOR_TYPES_BY_KEY.get('noise-reduction');
if (TYPE === undefined) throw new Error('The catalogue has a noise reduction.');
const NOISE_REDUCTION = TYPE;

const LENGTH = TEST_RATE;
const hiss = noise(5, { length: LENGTH, amplitude: 0.1 }).channels[0] ?? new Float32Array(0);
const tone = sine(440, { amplitude: 0.25, length: LENGTH }).channels[0] ?? new Float32Array(0);
const input = tone.map((sample, frame) => sample + (hiss[frame] ?? 0));

const values = { reduction: 30, smoothing: 0 };
const chain: EffectChain = {
  id: ids.next(),
  slots: [
    {
      ...instantiateProcessor(ids.next(), NOISE_REDUCTION.descriptor),
      values: processorValues(NOISE_REDUCTION, values),
      state: learnedProfile(
        StandardLayouts.mono,
        [noise(9, { length: LENGTH, amplitude: 0.1 }).channels[0] ?? new Float32Array(0)],
        values,
      ),
    },
  ],
};

/** The chain run over `input` from frame `from` to its end. */
async function runFrom(from: number) {
  const run = expectSuccess(
    await chainProcessing(PROCESSOR_TYPES_BY_KEY).prepare(
      {
        chain,
        input: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        length: LENGTH,
        quality: MAXIMUM_QUALITY.settings,
        blockFrames: 4_096,
        dsp: REFERENCE_DSP,
      },
      () => Promise.reject(new Error('A chain with nothing to measure reads nothing.')),
    ),
  );
  const out = new Float32Array(LENGTH - from);
  for (let done = 0; done < out.length; done += 4_096) {
    const frames = Math.min(4_096, out.length - done);
    run.process(
      [input.subarray(from + done, from + done + frames)],
      [out.subarray(done, done + frames)],
      frames,
    );
  }
  const { leadIn, frameGrid, latency } = run;
  run.release();
  return { out, leadIn, frameGrid, latency };
}

/** The largest difference, from output frame `settled` on, of a run begun at `from` and one from the start. */
function worstFrom(late: Float32Array, whole: Float32Array, from: number, settled: number) {
  let worst = 0;
  for (let frame = settled; frame < late.length; frame += 1)
    worst = Math.max(worst, Math.abs((late[frame] ?? 0) - (whole[from + frame] ?? 0)));
  return worst;
}

describe('a chain run started part way through a stream, as a preview starts one', () => {
  it('gives what a run from the start gives once settled, only when started on its frame grid', async () => {
    const whole = await runFrom(0);
    const { leadIn, frameGrid, latency } = whole;
    expect(frameGrid).toBe(2_048 / MAXIMUM_QUALITY.settings.spectralOverlap);
    const aligned = Math.floor((30_000 - leadIn) / frameGrid) * frameGrid;
    // With no smoothing a frame's gains depend on that frame alone, so a
    // run on the grid settles to the very bits of one from the start, and a
    // run 100 frames off it judges other stretches together.
    const settled = leadIn + latency;
    const on = await runFrom(aligned);
    expect(worstFrom(on.out, whole.out, aligned, settled)).toBe(0);
    const off = await runFrom(aligned + 100);
    expect(worstFrom(off.out, whole.out, aligned + 100, settled)).toBeGreaterThan(1e-3);
  });
});
