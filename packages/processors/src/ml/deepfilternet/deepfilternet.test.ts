import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';
import { FAKE_RUNTIME, type FakeModel } from '@audiogubbins/ml-runtime/testing';

import { processorProperties } from '../../testing/processor-properties.js';
import { FakeModels, MemoryModelLibrary, sha256Of } from '../../testing/model-services.js';
import { modelPassOf, passOver, planarChannels } from '../../testing/model-runs.js';
import { modelProcessorType } from '../model-processor.js';
import type { ModelDefinition } from '../model-definition.js';
import { DEEPFILTERNET_3, deepFilterNet3 } from './deepfilternet.js';
import { DEEPFILTERNET_3_MODEL, DeepFilterNetGraph } from './deepfilternet-model.js';

/** Stand-ins for the three graphs' files, each named by its own hash. */
const FILES = {
  [DeepFilterNetGraph.Encoder]: new Uint8Array([1]),
  [DeepFilterNetGraph.ErbDecoder]: new Uint8Array([2]),
  [DeepFilterNetGraph.DeepFilterDecoder]: new Uint8Array([3]),
};

/** DeepFilterNet 3's definition over the stand-in files, on the fake runtime. */
const STAND_IN: ModelDefinition = {
  ...DEEPFILTERNET_3_MODEL,
  identity: { ...DEEPFILTERNET_3_MODEL.identity, runtimeHash: FAKE_RUNTIME.webAssemblySha256 },
  files: Object.entries(FILES).map(([path, bytes]) => ({ path, sha256: sha256Of(bytes) })),
};

function frames(dims: readonly number[]): number {
  return dims[2] ?? 0;
}

/** The encoder, giving outputs of the declared shapes, all zero. */
const ENCODER: FakeModel = {
  inputs: [
    { name: 'feat_erb', dims: [1, 1, 'S', 32] },
    { name: 'feat_spec', dims: [1, 2, 'S', 96] },
  ],
  outputs: [],
  run: (inputs) => {
    const length = frames(inputs.get('feat_erb')?.dims ?? []);
    const zeros = (dims: number[]) => ({
      data: new Float32Array(dims.reduce((product, one) => product * one, 1)),
      dims,
    });
    return new Map([
      ['e0', zeros([1, 64, length, 32])],
      ['e1', zeros([1, 64, length, 16])],
      ['e2', zeros([1, 64, length, 8])],
      ['e3', zeros([1, 64, length, 8])],
      ['emb', zeros([1, length, 512])],
      ['c0', zeros([1, 64, length, 96])],
      ['lsnr', zeros([1, length, 1])],
    ]);
  },
};

/**
 * Decoders that give every band the gain `gain`, and every bin the deep
 * filter whose only tap, on the frame itself, is `tap`.
 */
function decoders(gain: number, tap: number): readonly [FakeModel, FakeModel] {
  const erb: FakeModel = {
    inputs: [
      { name: 'emb', dims: [1, 'S', 512] },
      { name: 'e3', dims: [1, 64, 'S', 8] },
      { name: 'e2', dims: [1, 64, 'S', 8] },
      { name: 'e1', dims: [1, 64, 'S', 16] },
      { name: 'e0', dims: [1, 64, 'S', 32] },
    ],
    outputs: [],
    run: (inputs) => {
      const length = frames(inputs.get('e0')?.dims ?? []);
      return new Map([
        ['m', { data: new Float32Array(length * 32).fill(gain), dims: [1, 1, length, 32] }],
      ]);
    },
  };
  const deep: FakeModel = {
    inputs: [
      { name: 'emb', dims: [1, 'S', 512] },
      { name: 'c0', dims: [1, 64, 'S', 96] },
    ],
    outputs: [],
    run: (inputs) => {
      const length = frames(inputs.get('c0')?.dims ?? []);
      const taps = new Float32Array(length * 96 * 10);
      // Tap 2 of 5 is the frame itself: two of the five lie behind it.
      for (let at = 0; at < length * 96; at += 1) taps[at * 10 + 4] = tap;
      return new Map([['coefs', { data: taps, dims: [1, length, 96, 10] }]]);
    },
  };
  return [erb, deep];
}

function servicesWith(gain: number, tap: number) {
  const [erb, deep] = decoders(gain, tap);
  return {
    inference: new FakeModels(
      new Map([
        [sha256Of(FILES[DeepFilterNetGraph.Encoder]), ENCODER],
        [sha256Of(FILES[DeepFilterNetGraph.ErbDecoder]), erb],
        [sha256Of(FILES[DeepFilterNetGraph.DeepFilterDecoder]), deep],
      ]),
    ),
    models: new MemoryModelLibrary(
      Object.entries(FILES).map(([path, bytes]) => ({
        pack: STAND_IN.identity.pack,
        version: STAND_IN.identity.version,
        path,
        bytes,
      })),
    ),
  };
}

/** `length` frames of each of `channels` channels, each a different mixture of tones. */
function programme(length: number, channels: number): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from(
      { length },
      (_, frame) =>
        0.4 * sineOfTurns((frame * (3 + channel)) / 997) +
        0.2 * sineOfTurns((frame * (41 + 7 * channel)) / 1_009),
    ),
  );
}

async function enhanced(
  input: readonly Float32Array[],
  layout: ChannelLayout,
  graphs: { readonly gain: number; readonly tap: number },
  values: Readonly<Record<string, number | boolean>> = {},
  chunks: readonly number[] = [4_800],
): Promise<Float32Array[]> {
  const services = servicesWith(graphs.gain, graphs.tap);
  const type = modelProcessorType({ ...DEEPFILTERNET_3, model: STAND_IN }, services);
  const measured = expectSuccess(
    await passOver(modelPassOf(type, { layout, values }), input, chunks),
  );
  expect(services.inference.openSessions).toBe(0);
  return planarChannels(measured, layout.roles.length);
}

function largestDifference(left: readonly Float32Array[], right: readonly Float32Array[]): number {
  let largest = 0;
  for (const [channel, samples] of left.entries()) {
    const other = right[channel] ?? new Float32Array(0);
    expect(samples.length).toBe(other.length);
    for (const [index, sample] of samples.entries()) {
      largest = Math.max(largest, Math.abs(sample - (other[index] ?? 0)));
    }
  }
  return largest;
}

function scaled(input: readonly Float32Array[], gain: number): Float32Array[] {
  return input.map((channel) => channel.map((sample) => sample * gain));
}

// Each test runs 25 seconds of audio through the whole pipeline, its
// transforms in TypeScript, two or three times: about a second alone, and
// several under the whole suite's load.
describe('DeepFilterNet 3, around stand-in graphs', { timeout: 30_000 }, () => {
  // Over 2.5 runs of the graphs, a length no whole number of hops.
  const length = 25_000 * 48 + 317;

  it('gives back each channel aligned and as long as it came, where the graphs change nothing', async () => {
    const input = programme(length, 2);
    const output = await enhanced(input, StandardLayouts.stereo, { gain: 1, tap: 1 });
    expect(largestDifference(output, input)).toBeLessThan(2e-7);
  });

  it('gives the same bits however the stream is read in chunks', async () => {
    const input = programme(length, 1);
    const once = await enhanced(input, StandardLayouts.mono, { gain: 0.5, tap: 0.25 });
    const piecemeal = await enhanced(
      input,
      StandardLayouts.mono,
      { gain: 0.5, tap: 0.25 },
      {},
      [1, 479, 4_096, 77_777],
    );
    expect(piecemeal).toEqual(once);
  });

  it('applies the band gains above the deep filter, and the deep filter below it', async () => {
    // A tone at 100 Hz, in bin 2, under the deep filter; one at 10 kHz, bin
    // 200, in the ERB bands' reach alone.
    const at = (frequency: number, amplitude: number) =>
      Float32Array.from(
        { length },
        (_, frame) => amplitude * sineOfTurns((frame * frequency) / 48_000),
      );
    const low = await enhanced([at(100, 0.5)], StandardLayouts.mono, { gain: 0.5, tap: 0.25 });
    const high = await enhanced([at(10_000, 0.5)], StandardLayouts.mono, { gain: 0.5, tap: 0.25 });
    // The stream's abrupt start and end spread over every bin, so the two
    // scales meet there; a frame on, each tone is in its own region alone.
    const inner = (channels: readonly Float32Array[]) =>
      channels.map((channel) => channel.subarray(2 * 960, channel.length - 2 * 960));
    expect(largestDifference(inner(low), inner([at(100, 0.125)]))).toBeLessThan(1e-6);
    expect(largestDifference(inner(high), inner([at(10_000, 0.25)]))).toBeLessThan(1e-6);
  });

  it('mixes the input back at the attenuation limit, as libDF does', async () => {
    const input = programme(length, 1);
    const limited = await enhanced(
      input,
      StandardLayouts.mono,
      { gain: 0, tap: 0 },
      {
        'attenuation-limit': 12,
      },
    );
    expect(largestDifference(limited, scaled(input, decibelsToGain(-12)))).toBeLessThan(2e-7);
    const unchanged = await enhanced(
      input,
      StandardLayouts.mono,
      { gain: 0, tap: 0 },
      {
        'attenuation-limit': 0,
      },
    );
    expect(largestDifference(unchanged, input)).toBeLessThan(2e-7);
    const unlimited = await enhanced(input, StandardLayouts.mono, { gain: 0, tap: 0 });
    expect(largestDifference(unlimited, scaled(input, 0))).toBe(0);
  });

  it('deepens the attenuation by the post-filter where it is on, by its β', async () => {
    // Every bin's gain is a half, so Valin's post-filter scales it by
    // (1 + β) / (1 + β / sin²(π/4)), the same for every bin.
    const input = programme(length, 1);
    const beta = 0.05;
    const filtered = await enhanced(
      input,
      StandardLayouts.mono,
      { gain: 0.5, tap: 0.5 },
      {
        'post-filter': true,
        'post-filter-beta': beta,
      },
    );
    const scale = (1 + beta) / (1 + beta / 0.5);
    expect(largestDifference(filtered, scaled(input, 0.5 * scale))).toBeLessThan(2e-7);
  });
});

// Unmeasured, the kernel passes its input on, which is all a kernel does
// beside playing back, and the playback is the framework's
// (`model-playback.test.ts`).
processorProperties(
  deepFilterNet3({
    inference: new FakeModels(new Map()),
    models: new MemoryModelLibrary([]),
  }),
  {
    layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
    bound: 1,
    passThrough: { values: {}, tolerance: 0 },
  },
);
