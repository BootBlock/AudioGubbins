import { describe, expect, it } from 'vitest';

import {
  ChannelRole,
  StandardLayouts,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sineOfTurns } from '@audiogubbins/audio-engine';
import type { FakeModel } from '@audiogubbins/ml-runtime/testing';

import type { Measurement } from '../../framework/whole-pass.js';
import { standInModel, standInServices } from '../../testing/model-services.js';
import { CHANNEL_VALUES, spleeterGainGraph } from '../../testing/spleeter-stand-in.js';
import { largestDifference } from '../../testing/sample-difference.js';
import { modelPassOf, passOver, planarChannels } from '../../testing/model-runs.js';
import { modelProcessorType } from '../model-processor.js';
import type { ModelProcessor } from '../model-processor.js';
import { SPLEETER_2_STEMS, SPLEETER_4_STEMS } from './spleeter.js';
import { FRAME, HOP, MODEL_BINS, SEGMENT_FRAMES, SPLEETER_GRAPH } from './spleeter-model.js';

/** `processor` over a stand-in for its graph's file, on the fake runtime. */
function standIn(processor: ModelProcessor): ModelProcessor {
  return { ...processor, model: standInModel(processor.model) };
}

function servicesWith(processor: ModelProcessor, graph: FakeModel) {
  return standInServices(processor.model, new Map([[SPLEETER_GRAPH, graph]]));
}

/** What the pass of `processor` over `graph` answers for `input`, read in `chunks`. */
async function separation(
  processor: ModelProcessor,
  graph: FakeModel,
  input: readonly Float32Array[],
  layout: ChannelLayout,
  values: Readonly<Record<string, string>> = {},
  chunks: readonly number[] = [65_536],
): Promise<DomainResult<Measurement>> {
  const subject = standIn(processor);
  const services = servicesWith(subject, graph);
  const type = modelProcessorType(subject, services);
  const answer = await passOver(
    modelPassOf(type, { layout, values, sampleRate: subject.model.sampleRate }),
    input,
    chunks,
  );
  expect(services.inference.openSessions).toBe(0);
  if (answer.ok) expect(services.inference.opened).toEqual([subject.model.inference]);
  return answer;
}

/** The first reason `result` was refused. */
function refusalOf(result: DomainResult<unknown>): DomainFailure {
  if (result.ok) throw new Error('The pass was answered, not refused.');
  return result.failures[0];
}

async function separated(
  processor: ModelProcessor,
  graph: FakeModel,
  input: readonly Float32Array[],
  layout: ChannelLayout,
  values: Readonly<Record<string, string>> = {},
  chunks: readonly number[] = [65_536],
): Promise<Float32Array[]> {
  const measured = expectSuccess(await separation(processor, graph, input, layout, values, chunks));
  return planarChannels(measured, layout.roles.length);
}

/** The frames each test signal fades in and out over. */
const FADE = 2_048;

/**
 * The gain of frame `frame` of `length`, a raised cosine over the first and
 * last {@link FADE} frames: an abrupt edge would spread over every bin, and
 * the processor rightly drops what lies above the graph's.
 */
function fade(frame: number, length: number): number {
  const edge = Math.min(frame, length - 1 - frame, FADE);
  const sine = sineOfTurns(edge / (4 * FADE));
  return sine * sine;
}

/** `length` frames of tones below 11 kHz, a different pair for each `channel`. */
function voice(length: number, channel: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, frame) =>
      fade(frame, length) *
      (0.4 * sineOfTurns(((frame * (220 + 110 * channel)) % 44_100) / 44_100) +
        0.2 * sineOfTurns(((frame * (3_001 + 517 * channel)) % 44_100) / 44_100)),
  );
}

function programme(length: number, channels: number): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) => voice(length, channel));
}

function tone(length: number, frequency: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, frame) =>
      fade(frame, length) * amplitude * sineOfTurns(((frame * frequency) % 44_100) / 44_100),
  );
}

function scaled(input: readonly Float32Array[], gains: readonly number[]): Float32Array[] {
  return input.map((channel, index) => channel.map((sample) => sample * (gains[index] ?? 0)));
}

const TWO = ['vocals', 'accompaniment'];
const FOUR = ['vocals', 'drums', 'bass', 'other'];

// Each stream crosses two joins between segments and ends part way through
// a third, at a length no whole number of hops, so every edge is run.
const LENGTH = 2 * SEGMENT_FRAMES * HOP + 300_017;

// Each test runs about 30 seconds of stereo through the transforms in
// TypeScript, once or twice: a few seconds alone, more under the suite's load.
describe('Spleeter, around stand-in graphs', { timeout: 60_000 }, () => {
  it('gives back each channel aligned and as long as it came, its first samples whole', async () => {
    const input = programme(LENGTH, 2);
    const output = await separated(
      SPLEETER_2_STEMS,
      spleeterGainGraph(TWO, (stem) => (stem === 0 ? 1 : 0)),
      input,
      StandardLayouts.stereo,
    );
    expect(largestDifference(output, input)).toBeLessThan(1e-6);
  });

  it('gives the same bits however the stream is read in chunks', async () => {
    const input = programme(LENGTH, 2);
    const graph = () => spleeterGainGraph(TWO, (stem, channel) => (stem === 0 ? 1 : 0.5 + channel));
    const once = await separated(SPLEETER_2_STEMS, graph(), input, StandardLayouts.stereo, {}, [
      LENGTH,
    ]);
    const piecemeal = await separated(
      SPLEETER_2_STEMS,
      graph(),
      input,
      StandardLayouts.stereo,
      {},
      [1, 4_095, 524_288, 77_777],
    );
    expect(piecemeal).toEqual(once);
  });

  it("hears each frame's magnitudes, from one frame of silence before the stream", async () => {
    const input = programme(LENGTH, 2);
    const heard: Float32Array[] = [];
    await separated(
      SPLEETER_2_STEMS,
      spleeterGainGraph(TWO, () => 1, heard),
      input,
      StandardLayouts.stereo,
    );
    expect(heard).toHaveLength(3);
    // Frame 9 of the second segment of the right channel starts 4 096
    // samples before the frame on the stream's grid, the silence's length.
    const frame = SEGMENT_FRAMES + 9;
    const start = frame * HOP - FRAME;
    const samples = input[1] ?? new Float32Array(0);
    for (const bin of [0, 5, 70, 300, 1_023]) {
      let real = 0;
      let imaginary = 0;
      for (let n = 0; n < FRAME; n += 1) {
        const windowed =
          (samples[start + n] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FRAME));
        const angle = (2 * Math.PI * ((bin * n) % FRAME)) / FRAME;
        real += windowed * Math.cos(angle);
        imaginary -= windowed * Math.sin(angle);
      }
      const value = heard[1]?.[CHANNEL_VALUES + 9 * MODEL_BINS + bin];
      expect(value, `bin ${String(bin)}`).toBeCloseTo(Math.hypot(real, imaginary), 3);
    }
  });

  it("lays each stem's ratio mask on the mix, by the stem its parameter chooses", async () => {
    const input = programme(LENGTH, 2);
    // Gains 1 to 4: each mask is its gain squared over 30.
    const graph = spleeterGainGraph(FOUR, (stem) => stem + 1);
    for (const [stem, mask] of [
      ['vocals', 1 / 30],
      ['bass', 9 / 30],
      ['other', 16 / 30],
    ] as const) {
      const output = await separated(SPLEETER_4_STEMS, graph, input, StandardLayouts.stereo, {
        stem,
      });
      expect(largestDifference(output, scaled(input, [mask, mask])), stem).toBeLessThan(1e-6);
    }
  });

  it("shares a bin no stem claims equally among the stems, by the masks' floor", async () => {
    // Every estimate zero: each mask is (0 + ε/4) / (0 + ε), a quarter.
    const input = programme(LENGTH, 2);
    const output = await separated(
      SPLEETER_4_STEMS,
      spleeterGainGraph(FOUR, () => 0),
      input,
      StandardLayouts.stereo,
      { stem: 'drums' },
    );
    expect(largestDifference(output, scaled(input, [0.25, 0.25]))).toBeLessThan(1e-6);
  });

  it('gives no stem anything above the bins the graph hears', async () => {
    const graph = spleeterGainGraph(TWO, (stem) => (stem === 0 ? 1 : 0));
    const low = await separated(
      SPLEETER_2_STEMS,
      graph,
      [tone(LENGTH, 5_000, 0.5)],
      StandardLayouts.mono,
    );
    const high = await separated(
      SPLEETER_2_STEMS,
      graph,
      [tone(LENGTH, 15_000, 0.5)],
      StandardLayouts.mono,
    );
    expect(largestDifference(low, [tone(LENGTH, 5_000, 0.5)])).toBeLessThan(1e-6);
    // Bin 1 024 is 11 025 Hz; the window's leakage from 15 kHz reaches
    // below it at well under a millionth.
    expect(largestDifference(high, [new Float32Array(LENGTH)])).toBeLessThan(1e-6);
  });

  it('hears mono as both channels of stereo and gives back the mean of the two', async () => {
    // The left channel's masks are a half, the right's one.
    const graph = spleeterGainGraph(TWO, (stem, channel) => (channel === 0 || stem === 0 ? 1 : 0));
    const stereo = programme(LENGTH, 2);
    const fromStereo = await separated(SPLEETER_2_STEMS, graph, stereo, StandardLayouts.stereo);
    expect(largestDifference(fromStereo, scaled(stereo, [0.5, 1]))).toBeLessThan(1e-6);
    const mono = [voice(LENGTH, 0)];
    const fromMono = await separated(SPLEETER_2_STEMS, graph, mono, StandardLayouts.mono);
    expect(largestDifference(fromMono, scaled(mono, [0.75]))).toBeLessThan(1e-6);
  });
});

describe("Spleeter's refusals", () => {
  it('refuses a layout that is not mono or a left and right pair, with the reason', () => {
    for (const { descriptor } of [SPLEETER_2_STEMS, SPLEETER_4_STEMS]) {
      const pairNotStereo: ChannelLayout = { roles: [ChannelRole.Left, ChannelRole.Centre] };
      for (const layout of [StandardLayouts.surround5_1, StandardLayouts.lcr, pairNotStereo]) {
        const refusal = refusalOf(descriptor.outputLayout(layout, new Map()));
        expect(refusal.code).toBe('processor.layout-refused');
        expect(refusal.summary).toMatch(/stereo/);
      }
      expect(expectSuccess(descriptor.outputLayout(StandardLayouts.stereo, new Map()))).toBe(
        StandardLayouts.stereo,
      );
      expect(expectSuccess(descriptor.outputLayout(StandardLayouts.mono, new Map()))).toBe(
        StandardLayouts.mono,
      );
    }
  });

  it('refuses a graph that gives no estimate of a stem, letting its session go', async () => {
    const graph = spleeterGainGraph(['vocals', 'drums', 'bass'], () => 1);
    const refusal = refusalOf(
      await separation(SPLEETER_4_STEMS, graph, programme(44_100, 2), StandardLayouts.stereo),
    );
    expect(refusal.code).toBe('processor.model-output-invalid');
    expect(refusal.details).toEqual({
      pack: 'spleeter-4-stems',
      graph: 'model.onnx',
      output: 'other',
    });
  });
});
