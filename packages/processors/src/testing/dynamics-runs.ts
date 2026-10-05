/**
 * What the dynamics processors' tests share: steady and stepped signals, a
 * run keyed from a side-chain, the gain a run applied, and a true-peak
 * measure at eight times the rate made independently of the limiter's own.
 */

import {
  StandardLayouts,
  ZERO_SAMPLES,
  type ChannelLayout,
  type ParameterValue,
  type QualitySettings,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  REFERENCE_DSP,
  blockView,
  plannedShape,
  type AudioFrameBlock,
} from '@audiogubbins/audio-engine';
import type { ProcessingNodeDescriptor } from '@audiogubbins/audio-graph';

import { ProcessorPort, type ProcessorType } from '../framework/processor-type.js';
import { TEST_BLOCK_FRAMES, TEST_RATE, processorStep, runProcessor } from './processor-run.js';

/** Parameter values by key. */
export type Values = Readonly<Record<string, ParameterValue>>;

/** A signal that holds `levels[0]` until frame `at`, then `levels[1]`, for `frames` frames. */
export function stepped(
  levels: readonly [number, number],
  at: number,
  frames: number,
): Float32Array {
  const signal = new Float32Array(frames);
  signal.fill(levels[0], 0, at);
  signal.fill(levels[1], at);
  return signal;
}

/** A sine of `frequency` Hz and peak `amplitude`, starting at `phase` turns, at the test rate. */
export function tone(
  frequency: number,
  amplitude: number,
  frames: number,
  phase = 0,
): Float32Array {
  const signal = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    signal[frame] = amplitude * Math.sin(2 * Math.PI * (phase + (frequency * frame) / TEST_RATE));
  }
  return signal;
}

/** One channel through `type` at `values`, in mono. */
export function runMono(
  type: ProcessorType,
  values: Values,
  signal: Float32Array,
  quality?: QualitySettings,
): Float32Array {
  const layout = StandardLayouts.mono;
  const [out] = runProcessor(
    type,
    { layout, values, ...(quality === undefined ? {} : { quality }) },
    [signal],
  );
  if (out === undefined) throw new Error('A mono run gave no channel.');
  return out;
}

/** The gain a run applied at each frame: the output over the input, where the input is not 0. */
export function appliedGain(input: Float32Array, output: Float32Array): Float64Array {
  return Float64Array.from(input, (sample, frame) => (output[frame] ?? 0) / sample);
}

/** The first frame from `from` at which `holds` is true of the value, or −1. */
export function firstFrame(
  values: ArrayLike<number>,
  from: number,
  holds: (value: number) => boolean,
): number {
  for (let frame = from; frame < values.length; frame += 1) {
    if (holds(values[frame] ?? 0)) return frame;
  }
  return -1;
}

/** The ratio in decibels of the RMS of `output` to that of `input` over frames `from` to `to`. */
export function rmsGainDecibels(
  input: Float32Array,
  output: Float32Array,
  from: number,
  to: number,
): number {
  let into = 0;
  let out = 0;
  for (let frame = from; frame < to; frame += 1) {
    into += (input[frame] ?? 0) ** 2;
    out += (output[frame] ?? 0) ** 2;
  }
  return 10 * Math.log10(out / into);
}

/** A node of `type` with a side-chain of `sideChain`, as a graph holds it. */
export function sideChainNode(
  type: ProcessorType,
  layout: ChannelLayout,
  sideChain: ChannelLayout,
  values: Values = {},
): ProcessingNodeDescriptor {
  const shape = plannedShape(processorStep(type, { layout, values }));
  return {
    ...shape,
    kind: 'processing',
    inputs: [...shape.inputs, { name: ProcessorPort.SideChain, layout: sideChain }],
  };
}

/** The output of `type` for `input`, keyed from `sideChain`, in blocks of 128 frames. */
export function runKeyed(
  type: ProcessorType,
  settings: { readonly layout: ChannelLayout; readonly values: Values },
  input: readonly Float32Array[],
  key: { readonly layout: ChannelLayout; readonly channels: readonly Float32Array[] },
): Float32Array[] {
  const step = processorStep(type, settings);
  const kernel = expectSuccess(
    type.createKernel(
      {
        ...step,
        inputs: [
          ...step.inputs,
          { port: ProcessorPort.SideChain, layout: key.layout, slot: 2, delay: ZERO_SAMPLES },
        ],
      },
      {
        sampleRate: TEST_RATE,
        blockFrames: TEST_BLOCK_FRAMES,
        dsp: REFERENCE_DSP,
        feedFor: () => undefined,
        sinkFor: () => undefined,
        meterFor: () => undefined,
      },
    ),
  );
  const length = input[0]?.length ?? 0;
  const block = (layout: ChannelLayout, channels: readonly Float32Array[]): AudioFrameBlock => ({
    layout,
    sampleRate: TEST_RATE,
    frames: length,
    channels,
  });
  const output = settings.layout.roles.map(() => new Float32Array(length));
  const source = block(settings.layout, input);
  const keyed = block(key.layout, key.channels);
  const sink = block(settings.layout, output);
  for (let position = 0; position < length; position += 128) {
    const frames = Math.min(128, length - position);
    kernel.process(
      [blockView(source, position, frames), blockView(keyed, position, frames)],
      [blockView(sink, position, frames)],
      frames,
    );
  }
  kernel.release();
  return output;
}

/** Frames the measuring interpolator reaches each side of a point, and its window's β. */
const MEASURE_REACH = 96;
const MEASURE_BETA = 12;

function besselI0(x: number): number {
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 200; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/**
 * The largest magnitude of `samples` read at eight times the rate, by a
 * Kaiser-windowed sinc of 193 taps a phase with its cut-off at Nyquist,
 * written here with the platform's functions so it shares nothing with the
 * limiter's detector.
 */
export function truePeakAtEightTimes(samples: Float32Array): number {
  const phases = 8;
  const taps: number[][] = [];
  for (let phase = 1; phase < phases; phase += 1) {
    const row: number[] = [];
    for (let offset = -MEASURE_REACH; offset <= MEASURE_REACH; offset += 1) {
      const t = phase / phases - offset;
      const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
      const position = t / (MEASURE_REACH + 1);
      const window =
        besselI0(MEASURE_BETA * Math.sqrt(1 - position * position)) / besselI0(MEASURE_BETA);
      row.push(sinc * window);
    }
    taps.push(row);
  }
  let largest = 0;
  for (let frame = 0; frame < samples.length; frame += 1) {
    largest = Math.max(largest, Math.abs(samples[frame] ?? 0));
    if (frame < MEASURE_REACH || frame + MEASURE_REACH + 1 >= samples.length) continue;
    for (const row of taps) {
      let sum = 0;
      for (const [index, weight] of row.entries()) {
        sum += weight * (samples[frame + index - MEASURE_REACH] ?? 0);
      }
      largest = Math.max(largest, Math.abs(sum));
    }
  }
  return largest;
}
