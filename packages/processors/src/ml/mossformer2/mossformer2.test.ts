import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout, type DomainResult } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import type { Tensor } from '@audiogubbins/ml-runtime';
import type { FakeModel } from '@audiogubbins/ml-runtime/testing';

import type { Measurement } from '../../framework/whole-pass.js';
import { processorProperties } from '../../testing/processor-properties.js';
import {
  FakeModels,
  MemoryModelLibrary,
  standInModel,
  standInServices,
} from '../../testing/model-services.js';
import { toneMixture } from '../../testing/model-signals.js';
import { largestDifference } from '../../testing/sample-difference.js';
import { modelPassOf, passOver, planarChannels } from '../../testing/model-runs.js';
import type { ModelDefinition } from '../model-definition.js';
import { modelProcessorType } from '../model-processor.js';
import { FeatureMaker } from './features.js';
import { MOSSFORMER2_SE_48K, mossFormer2Se48k } from './mossformer2.js';
import {
  BINS,
  FEATURES,
  MOSSFORMER2_GRAPH,
  MOSSFORMER2_SE_48K_MODEL,
} from './mossformer2-model.js';

/** MossFormer2 SE 48K's definition over a stand-in for its graph's file, on the fake runtime. */
const STAND_IN: ModelDefinition = standInModel(MOSSFORMER2_SE_48K_MODEL);

/**
 * The decode's segments, as ClearerVoice-Studio states them: four seconds
 * from every three, whose outputs meet at three and a half seconds, six and
 * a half, and every three seconds on.
 */
const SEGMENT = 192_000;
const STRIDE = 144_000;
const JOINS = [168_000, 312_000];

/** A stand-in graph whose mask, for each run, is `gain` of its features, frame and bin. */
function graph(
  gain: (features: Float32Array, frames: number, frame: number, bin: number) => number,
  declared: number = FEATURES,
): FakeModel {
  return {
    inputs: [{ name: 'fbanks', dims: [1, 'T', declared] }],
    outputs: [],
    run: (inputs) => {
      const fbanks = inputs.get('fbanks');
      const frames = fbanks?.dims[1] ?? 0;
      const features = fbanks?.data ?? new Float32Array(0);
      const mask = new Float32Array(frames * BINS);
      for (let frame = 0; frame < frames; frame += 1) {
        for (let bin = 0; bin < BINS; bin += 1) {
          mask[frame * BINS + bin] = gain(features, frames, frame, bin);
        }
      }
      return new Map<string, Tensor>([['mask', { data: mask, dims: [1, frames, BINS] }]]);
    },
  };
}

const UNITY = graph(() => 1);

/**
 * A mask that, like the network, hears the whole run: each bin's gain
 * follows the frame's own feature and the mean of that feature over every
 * frame of the run, so it changes with whatever the run hears anywhere.
 */
const ATTENDING: FakeModel = {
  ...UNITY,
  run: (inputs) => {
    const fbanks = inputs.get('fbanks');
    const frames = fbanks?.dims[1] ?? 0;
    const features = fbanks?.data ?? new Float32Array(0);
    const means = new Float64Array(FEATURES);
    for (const [at, value] of features.entries()) {
      means[at % FEATURES] = (means[at % FEATURES] ?? 0) + value / frames;
    }
    return graph((_, _frames, frame, bin) => {
      const own = features[frame * FEATURES + (bin % FEATURES)] ?? 0;
      return 1 / (1 + Math.abs(own) / 40 + Math.abs(means[bin % FEATURES] ?? 0) / 40);
    }).run(inputs);
  },
};

function servicesWith(model: FakeModel) {
  return standInServices(STAND_IN, new Map([[MOSSFORMER2_GRAPH, model]]));
}

async function measuredBy(
  model: FakeModel,
  input: readonly Float32Array[],
  layout: ChannelLayout,
  chunks: readonly number[] = [4_800],
): Promise<{ readonly answer: DomainResult<Measurement>; readonly open: number }> {
  const services = servicesWith(model);
  const type = modelProcessorType({ ...MOSSFORMER2_SE_48K, model: STAND_IN }, services);
  const answer = await passOver(modelPassOf(type, { layout }), input, chunks);
  return { answer, open: services.inference.openSessions };
}

async function enhanced(
  model: FakeModel,
  input: readonly Float32Array[],
  layout: ChannelLayout,
  chunks?: readonly number[],
): Promise<Float32Array[]> {
  const { answer, open } = await measuredBy(model, input, layout, chunks);
  expect(open).toBe(0);
  return planarChannels(expectSuccess(answer), layout.roles.length);
}

/**
 * Where two runs of samples first differ, or nothing where they are the same
 * bits and length: a failing comparison of whole streams would have the
 * runner print a difference of hundreds of thousands of samples.
 */
function firstDifference(
  left: readonly Float32Array[],
  right: readonly Float32Array[],
): string | undefined {
  if (left.length !== right.length)
    return `${String(left.length)} channels, not ${String(right.length)}`;
  for (const [channel, samples] of left.entries()) {
    const other = right[channel] ?? new Float32Array(0);
    if (samples.length !== other.length) {
      return `channel ${String(channel)}: ${String(samples.length)} samples, not ${String(other.length)}`;
    }
    const at = samples.findIndex((sample, index) => !Object.is(sample, other[index]));
    if (at >= 0) return `channel ${String(channel)}, sample ${String(at)}`;
  }
  return undefined;
}

// Each test runs about seven seconds of audio, three segments, through the
// features and the transforms in TypeScript, once or twice: about a second
// alone, and several under the whole suite's load.
describe('MossFormer2 SE 48K, around a stand-in graph', { timeout: 60_000 }, () => {
  // Over two joins, into a third segment, a length no whole number of hops.
  const length = 330_017;

  it('gives back each channel aligned and as long as it came, where the mask is one', async () => {
    const input = toneMixture(length, 2);
    const output = await enhanced(UNITY, input, StandardLayouts.stereo);
    expect(largestDifference(output, input)).toBeLessThan(1e-7);
  });

  it('gives the graph each segment’s features, silence past the stream’s end', async () => {
    const heard: Float32Array[] = [];
    const listening: FakeModel = {
      ...UNITY,
      run: (inputs) => {
        heard.push(inputs.get('fbanks')?.data.slice() ?? new Float32Array(0));
        return UNITY.run(inputs);
      },
    };
    const [input = new Float32Array(0)] = toneMixture(length, 1);
    await enhanced(listening, [input], StandardLayouts.mono);
    const maker = new FeatureMaker(REFERENCE_DSP, SEGMENT);
    const expected = [0, 1, 2].map((index) => {
      const segment = new Float32Array(SEGMENT);
      segment.set(input.subarray(index * STRIDE, index * STRIDE + SEGMENT));
      return maker.features(segment);
    });
    maker.release();
    expect(firstDifference(heard, expected)).toBeUndefined();
  });

  it('keeps each segment’s output between its edges, the first from the stream’s start', async () => {
    // Each run's mask is its own gain, so each sample's output is scaled by
    // the gain of the segment that kept it.
    const gains = [0.5, 0.25, 0.125];
    let runs = 0;
    const counting: FakeModel = {
      ...UNITY,
      run: (inputs) => {
        const gain = gains[runs] ?? 0;
        runs += 1;
        return graph(() => gain).run(inputs);
      },
    };
    const [input = new Float32Array(0)] = toneMixture(length, 1);
    const [output = new Float32Array(0)] = await enhanced(counting, [input], StandardLayouts.mono);
    expect(runs).toBe(gains.length);
    const bounds = [0, ...JOINS, length];
    const expected = input.map((sample, at) => {
      const index = bounds.findIndex((bound) => bound > at) - 1;
      return sample * (gains[index] ?? 0);
    });
    expect(largestDifference([output], [expected])).toBeLessThan(1e-7);
  });

  it('gives the same bits however the stream is read in chunks', async () => {
    const input = toneMixture(length, 1);
    const once = await enhanced(ATTENDING, input, StandardLayouts.mono);
    const piecemeal = await enhanced(
      ATTENDING,
      input,
      StandardLayouts.mono,
      [1, 479, 4_096, 77_777],
    );
    expect(firstDifference(piecemeal, once)).toBeUndefined();
  });

  it('renders a stream as it renders the stream followed by silence, whatever its length', async () => {
    const input = toneMixture(length, 1);
    const followed = input.map((channel) => {
      const longer = new Float32Array(length + 200_000);
      longer.set(channel);
      return longer;
    });
    const alone = await enhanced(ATTENDING, input, StandardLayouts.mono);
    const longer = await enhanced(ATTENDING, followed, StandardLayouts.mono);
    const shared = longer.map((channel) => channel.subarray(0, length));
    expect(firstDifference(alone, shared)).toBeUndefined();
  });

  it('enhances every channel on its own', async () => {
    const input = toneMixture(length, 2);
    const together = await enhanced(ATTENDING, input, StandardLayouts.stereo);
    const alone = await enhanced(
      ATTENDING,
      [input[1] ?? new Float32Array(0)],
      StandardLayouts.mono,
    );
    expect(firstDifference(together.slice(1), alone)).toBeUndefined();
  });

  it('refuses a mask of another shape than the graph declares, letting its session go', async () => {
    const short: FakeModel = {
      ...UNITY,
      run: (inputs) => {
        const data = UNITY.run(inputs).get('mask')?.data.slice(BINS) ?? new Float32Array(0);
        return new Map([['mask', { data, dims: [1, data.length / BINS, BINS] }]]);
      },
    };
    const { answer, open } = await measuredBy(short, toneMixture(length, 1), StandardLayouts.mono);
    expect(expectFailureCode(answer)).toBe('processor.model-output-invalid');
    expect(open).toBe(0);
  });

  it('refuses with the runtime’s reason where the graph takes other features', async () => {
    const other = graph(() => 1, FEATURES - 1);
    const { answer, open } = await measuredBy(other, toneMixture(length, 1), StandardLayouts.mono);
    expect(expectFailureCode(answer)).toBe('inference.input-mismatch');
    expect(open).toBe(0);
  });
});

// Unmeasured, the kernel passes its input on, which is all a kernel does
// beside playing back, and the playback is the framework's
// (`model-playback.test.ts`).
processorProperties(
  mossFormer2Se48k({
    inference: new FakeModels(new Map()),
    models: new MemoryModelLibrary([]),
  }),
  {
    layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
    bound: 1,
    passThrough: { values: {}, tolerance: 0 },
  },
);
