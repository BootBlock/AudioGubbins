/**
 * No kernel allocates while it processes.
 *
 * A kernel runs on the audio thread, where a collection pauses the quantum
 * that triggered it, so everything a kernel touches is made when it is
 * created (`node-implementation.ts`). How an allocation is measured, and why
 * that way, is in `testing/allocation.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
  ambisonicLayout,
  channelCount,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import { ReferenceOscillator } from '../dsp/reference/primitives.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { DelayLine } from '../pcm/delay-line.js';
import { allocateBlock, type AudioFrameBlock } from '../pcm/frame-block.js';
import { QUANTA, allocatedBy, type Run } from '../testing/allocation.js';
import {
  RATE,
  STEMS,
  distinctBlock,
  kernelContext,
  kernelOf,
  nodeOf,
  port,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { BUILT_IN_NODES } from './built-in-nodes.js';
import { CHANNEL_MAP_NODE } from './channel-map.js';
import { DELAY_NODE } from './delay.js';
import { GAIN_NODE } from './gain.js';
import { GRAPH_INPUT_NODE } from './graph-input.js';
import { MATRIX_NODE } from './matrix.js';
import { METER_NODE } from './meter.js';
import { MIX_NODE } from './mix.js';
import type { KernelContext, NodeKernel } from './node-implementation.js';
import { OUTPUT_NODE } from './output.js';
import { TONE_NODE } from './tone.js';

/** The frames of one quantum, the most the test context gives a call. */
const FRAMES = kernelContext().blockFrames;

/** One quantum of a kernel, over blocks made once, as the executor reuses its own. */
function quantumOf(
  kernel: NodeKernel,
  inputs: readonly AudioFrameBlock[],
  outputs: readonly ChannelLayout[],
): () => void {
  const written = outputs.map((layout) => allocateBlock(layout, RATE, FRAMES));
  return () => {
    kernel.process(inputs, written, FRAMES);
  };
}

/** A node of one input and one output, of the given layouts. */
function through(
  type: string,
  from: ChannelLayout,
  to: ChannelLayout,
  settings: Readonly<Record<string, SettingValue>> = {},
) {
  return nodeOf(type, { inputs: [port('in', from)], outputs: [port('out', to)], settings });
}

const SURROUND = StandardLayouts.surround5_1;
const STEREO = StandardLayouts.stereo;
const THIRD_ORDER_FUMA = expectSuccess(
  ambisonicLayout({
    order: 3,
    ordering: AmbisonicOrdering.FuMa,
    normalisation: AmbisonicNormalisation.FuMa,
  }),
);
const THIRD_ORDER_AMBIX = expectSuccess(
  ambisonicLayout({
    order: 3,
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  }),
);

/** Every weight of a square matrix over `layout`, each a different value. */
function denseCoefficients(layout: ChannelLayout): number[] {
  const width = channelCount(layout);
  return Array.from({ length: width * width }, (_, index) => 0.01 * (index + 1));
}

/** The kernel runs of each built-in type, each named for the path it measures. */
function runsByType(): ReadonlyMap<string, readonly (readonly [string, () => Run])[]> {
  const block = distinctBlock(SURROUND, FRAMES);
  const surround = [block];
  const context = (bindings: Parameters<typeof kernelContext>[0] = {}): KernelContext =>
    kernelContext(bindings);
  return new Map<string, readonly (readonly [string, () => Run])[]>([
    [
      BuiltInNodeType.GraphInput,
      [
        [
          'reading a bound feed',
          () => {
            const node = nodeOf(BuiltInNodeType.GraphInput, { outputs: [port('out', SURROUND)] });
            const feed = { layout: SURROUND, fill: (into: AudioFrameBlock) => into.frames };
            const kernel = kernelOf(
              GRAPH_INPUT_NODE,
              node,
              context({ feeds: new Map([[node.id, feed]]) }),
            );
            return { quantum: quantumOf(kernel, [], [SURROUND]) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Output,
      [
        [
          'delivering to a bound target',
          () => {
            const node = nodeOf(BuiltInNodeType.Output, { inputs: [port('in', SURROUND)] });
            const kernel = kernelOf(
              OUTPUT_NODE,
              node,
              context({ sinks: new Map([[node.id, { receive: () => undefined }]]) }),
            );
            return { quantum: quantumOf(kernel, surround, []) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Gain,
      [
        [
          'at a steady gain',
          () => {
            const kernel = kernelOf(
              GAIN_NODE,
              through(BuiltInNodeType.Gain, SURROUND, SURROUND, { gain: 0.5 }),
            );
            return { quantum: quantumOf(kernel, surround, [SURROUND]) };
          },
        ],
        [
          'while its gain ramps',
          () => {
            const kernel = kernelOf(
              GAIN_NODE,
              through(BuiltInNodeType.Gain, SURROUND, SURROUND, { gain: 0.5 }),
            );
            let target = 0.25;
            return {
              // A ramp lasts 480 frames at the test rate, so three quanta of 128 are all ramping.
              prepare: () => {
                target = target === 0.25 ? 0.75 : 0.25;
                expectSuccess(kernel.setParameter('gain', target));
              },
              quantum: quantumOf(kernel, surround, [SURROUND]),
              quanta: 3,
            };
          },
        ],
        [
          "while one channel's polarity and gain ramp",
          () => {
            const kernel = kernelOf(
              GAIN_NODE,
              through(BuiltInNodeType.Gain, SURROUND, SURROUND, {
                'channel-gains': [1, 0.5, 0.5, 0, 1, 1],
                polarity: [1, 1, -1, 1, 1, -1],
              }),
            );
            let polarity = 1;
            return {
              prepare: () => {
                polarity = -polarity;
                expectSuccess(kernel.setParameter('polarity.4', polarity));
                expectSuccess(kernel.setParameter('channel-gain.1', polarity === 1 ? 0.5 : 0.25));
              },
              quantum: quantumOf(kernel, surround, [SURROUND]),
              quanta: 3,
            };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Mix,
      [
        [
          'summing three inputs',
          () => {
            const kernel = kernelOf(
              MIX_NODE,
              nodeOf(BuiltInNodeType.Mix, {
                inputs: [port('a', SURROUND), port('b', SURROUND), port('c', SURROUND)],
                outputs: [port('out', SURROUND)],
                settings: { gains: [0.5, 0.25, 0.125] },
              }),
            );
            const inputs = [block, block, block];
            return { quantum: quantumOf(kernel, inputs, [SURROUND]) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.ChannelMap,
      [
        [
          'reordering and duplicating',
          () => {
            const kernel = kernelOf(
              CHANNEL_MAP_NODE,
              through(BuiltInNodeType.ChannelMap, SURROUND, STEMS, { map: [5, 0, 0] }),
            );
            return { quantum: quantumOf(kernel, surround, [STEMS]) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Matrix,
      [
        [
          'with coefficients over a third-order ambisonic set',
          () => {
            const kernel = kernelOf(
              MATRIX_NODE,
              through(BuiltInNodeType.Matrix, THIRD_ORDER_AMBIX, THIRD_ORDER_AMBIX, {
                coefficients: denseCoefficients(THIRD_ORDER_AMBIX),
              }),
            );
            const inputs = [distinctBlock(THIRD_ORDER_AMBIX, FRAMES)];
            return { quantum: quantumOf(kernel, inputs, [THIRD_ORDER_AMBIX]) };
          },
        ],
        [
          'with the named conversion of a third-order Furse-Malham set to AmbiX',
          () => {
            const kernel = kernelOf(
              MATRIX_NODE,
              through(BuiltInNodeType.Matrix, THIRD_ORDER_FUMA, THIRD_ORDER_AMBIX, {
                named: 'ambisonic-conversion',
              }),
            );
            const inputs = [distinctBlock(THIRD_ORDER_FUMA, FRAMES)];
            return { quantum: quantumOf(kernel, inputs, [THIRD_ORDER_AMBIX]) };
          },
        ],
        [
          'with the named 5.1 downmix',
          () => {
            const kernel = kernelOf(
              MATRIX_NODE,
              through(BuiltInNodeType.Matrix, SURROUND, STEREO, {
                named: 'itu-bs775-5.1-to-stereo',
              }),
            );
            return { quantum: quantumOf(kernel, surround, [STEREO]) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Delay,
      [
        [
          'delaying by frames',
          () => {
            const kernel = kernelOf(
              DELAY_NODE,
              through(BuiltInNodeType.Delay, SURROUND, SURROUND, { frames: 300 }),
            );
            return { quantum: quantumOf(kernel, surround, [SURROUND]) };
          },
        ],
        [
          'delaying each channel by its own frames',
          () => {
            const kernel = kernelOf(
              DELAY_NODE,
              through(BuiltInNodeType.Delay, SURROUND, SURROUND, {
                frames: 30,
                'channel-delays': [0, 7, 129, 0, 256, 3],
              }),
            );
            return { quantum: quantumOf(kernel, surround, [SURROUND]) };
          },
        ],
        [
          'delaying by no frames',
          () => {
            const kernel = kernelOf(
              DELAY_NODE,
              through(BuiltInNodeType.Delay, SURROUND, SURROUND, { frames: 0 }),
            );
            return { quantum: quantumOf(kernel, surround, [SURROUND]) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Tone,
      [
        [
          'on the reference oscillator',
          () => {
            const kernel = kernelOf(
              TONE_NODE,
              nodeOf(BuiltInNodeType.Tone, {
                outputs: [port('out', SURROUND)],
                settings: { frequency: 997 },
              }),
              context({ dsp: REFERENCE_DSP }),
            );
            return { quantum: quantumOf(kernel, [], [SURROUND]) };
          },
        ],
      ],
    ],
    [
      BuiltInNodeType.Meter,
      [
        [
          'reporting to a bound target',
          () => {
            const node = nodeOf(BuiltInNodeType.Meter, { inputs: [port('in', SURROUND)] });
            const kernel = kernelOf(
              METER_NODE,
              node,
              context({ meters: new Map([[node.id, { receive: () => undefined }]]) }),
            );
            return { quantum: quantumOf(kernel, surround, []) };
          },
        ],
        [
          'correlating pairs of channels',
          () => {
            const node = nodeOf(BuiltInNodeType.Meter, {
              inputs: [port('in', SURROUND)],
              settings: { correlate: [0, 1, 4, 5, 2, 0] },
            });
            const kernel = kernelOf(
              METER_NODE,
              node,
              context({ meters: new Map([[node.id, { receive: () => undefined }]]) }),
            );
            return { quantum: quantumOf(kernel, surround, []) };
          },
        ],
      ],
    ],
  ]);
}

describe('processing allocates nothing', () => {
  it('has a run for every built-in node type', () => {
    expect([...runsByType().keys()].sort()).toEqual([...BUILT_IN_NODES.keys()].sort());
  });

  for (const [type, runs] of runsByType()) {
    for (const [path, make] of runs) {
      it(`in a ${type} kernel ${path}`, () => {
        const run = make();
        expect(allocatedBy(run)).toBeLessThan(run.quanta ?? QUANTA);
      });
    }
  }

  it('in the reference oscillator', () => {
    const oscillator = new ReferenceOscillator(997, RATE, 0.25, 0.5);
    const into = new Float32Array(FRAMES);
    const quantum = () => {
      oscillator.render(into);
    };
    expect(allocatedBy({ quantum })).toBeLessThan(QUANTA);
  });

  it('in a delay line of no frames, reading and writing different blocks', () => {
    const line = new DelayLine(SURROUND.roles.map(() => 0));
    const from = distinctBlock(SURROUND, FRAMES);
    const to = allocateBlock(SURROUND, RATE, FRAMES);
    const quantum = () => {
      line.process(from, to, FRAMES);
    };
    expect(allocatedBy({ quantum })).toBeLessThan(QUANTA);
  });
});
