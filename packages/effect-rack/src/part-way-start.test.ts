import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, type ChainRequest, type StreamReader } from '@audiogubbins/audio-engine';
import { PROCESSOR_TYPES_BY_KEY, type ProcessorType } from '@audiogubbins/processors';
import {
  TEST_RATE,
  delayingProcessor,
  learnedProfile,
  processorValues,
  recurrentType,
} from '@audiogubbins/processors/testing';
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

/** A request to run `of` over `LENGTH` frames of mono from frame `start`. */
function request(of: EffectChain, start: number): ChainRequest {
  return {
    chain: of,
    input: StandardLayouts.mono,
    sampleRate: TEST_RATE,
    length: LENGTH,
    quality: MAXIMUM_QUALITY.settings,
    blockFrames: 4_096,
    dsp: REFERENCE_DSP,
    start,
  };
}

/** Reads `stream` as a chain's measuring pass reads its stream. */
function readerOf(stream: Float32Array): StreamReader {
  return async (start, frames, into) => {
    into[0]?.set(stream.subarray(start, start + frames));
    await Promise.resolve();
  };
}

/**
 * `of` run over `stream` from frame `from` to its end, by the rack of
 * `types`, its output as it comes, `latency` frames late.
 */
async function runFrom(
  from: number,
  of: EffectChain = chain,
  types: ReadonlyMap<string, ProcessorType> = PROCESSOR_TYPES_BY_KEY,
  stream: Float32Array = input,
) {
  const processing = chainProcessing(types);
  const run = expectSuccess(await processing.prepare(request(of, from), readerOf(stream)));
  const out = new Float32Array(LENGTH - from);
  for (let done = 0; done < out.length; done += 4_096) {
    const frames = Math.min(4_096, out.length - done);
    run.process(
      [stream.subarray(from + done, from + done + frames)],
      [out.subarray(done, done + frames)],
      frames,
    );
  }
  const { latency } = run;
  run.release();
  const { leadIn, frameGrid } = expectSuccess(processing.partWayStart(request(of, from)));
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

const RECURRENT = recurrentType(TEST_RATE);
const DELAY = delayingProcessor(300);
const MODEL_TYPES = new Map([RECURRENT, DELAY].map((type) => [type.descriptor.typeKey, type]));

/** A chain of a processor of each of `types`, in order. */
function chainOf(...types: readonly ProcessorType[]): EffectChain {
  return {
    id: ids.next(),
    slots: types.map((type) => instantiateProcessor(ids.next(), type.descriptor)),
  };
}

/** What a run of `of` from `from` gives for frames `from` on, its latency cut. */
async function heardFrom(from: number, of: EffectChain): Promise<Float32Array> {
  const { out, latency } = await runFrom(from, of, MODEL_TYPES, tone);
  return out.subarray(latency);
}

describe('a chain holding a model processor, started part way through', () => {
  it('plays from the frame it starts at what a run from the start plays there', async () => {
    const model = chainOf(RECURRENT);
    const whole = await heardFrom(0, model);
    expect(whole.some((sample) => sample !== 0)).toBe(true);
    for (const from of [1, 4_099, 30_001]) {
      // The model's output carries the whole stream before it, so playing
      // its pass from its first frame would give other samples entirely.
      expect(await heardFrom(from, model), String(from)).toEqual(whole.subarray(from));
    }
  });

  it('plays its pass in time with the stream behind a processor that delays it', async () => {
    const model = await heardFrom(0, chainOf(RECURRENT));
    const delayed = chainOf(DELAY, RECURRENT);
    const whole = await heardFrom(0, delayed);
    expect(whole).toEqual(model.subarray(0, whole.length));
    expect(await heardFrom(12_345, delayed)).toEqual(whole.subarray(12_345));
  });

  it('refuses a start that is not a frame of the stream', async () => {
    const processing = chainProcessing(MODEL_TYPES);
    for (const start of [-1, LENGTH + 1, 0.5]) {
      expect(
        expectFailureCode(
          await processing.prepare(request(chainOf(RECURRENT), start), readerOf(tone)),
        ),
      ).toBe('effect-rack.start-invalid');
    }
  });
});
