import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { decibelsToGain, sineOfTurns } from '@audiogubbins/audio-engine';

import { deepFilterNetGraphs } from '../../testing/deepfilternet-stand-in.js';
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
import { modelProcessorType } from '../model-processor.js';
import type { ModelDefinition } from '../model-definition.js';
import { DEEPFILTERNET_3, deepFilterNet3 } from './deepfilternet.js';
import { DEEPFILTERNET_3_MODEL } from './deepfilternet-model.js';

/** DeepFilterNet 3's definition over stand-ins for its graphs' files, on the fake runtime. */
const STAND_IN: ModelDefinition = standInModel(DEEPFILTERNET_3_MODEL);

function servicesWith(gain: number, tap: number) {
  return standInServices(STAND_IN, deepFilterNetGraphs(gain, tap));
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
    const input = toneMixture(length, 2);
    const output = await enhanced(input, StandardLayouts.stereo, { gain: 1, tap: 1 });
    expect(largestDifference(output, input)).toBeLessThan(2e-7);
  });

  it('gives the same bits however the stream is read in chunks', async () => {
    const input = toneMixture(length, 1);
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
    const input = toneMixture(length, 1);
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
    const input = toneMixture(length, 1);
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
