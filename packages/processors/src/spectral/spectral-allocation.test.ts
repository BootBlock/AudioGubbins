/**
 * No spectral kernel allocates while it processes, nor the learner of a noise
 * profile while it learns: each makes its histories, spectra, statistics,
 * factor and scratch when it is made, and works a frame at a time in them.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout, type ProcessorState } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, type NodeKernel } from '@audiogubbins/audio-engine';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';
import { noise, noisySine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import {
  TEST_RATE,
  processorKernel,
  processorKernelOf,
  processorValues,
} from '../testing/processor-run.js';
import { learnedProfile } from '../testing/spectral-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { DEREVERBERATION } from './dereverb.js';
import { NOISE_REDUCTION, noiseProfileLearner } from './noise-reduction.js';

const FRAMES = 128;

/** A quantum of programme on every channel of `layout`, made once. */
function programmeBlock(layout: ChannelLayout) {
  const source = noisySine(440).channels[0] ?? new Float32Array(0);
  const channels = layout.roles.map((_, offset) =>
    Float32Array.from({ length: FRAMES }, (_, frame) => source[frame + offset * 997] ?? 0),
  );
  return { layout, sampleRate: TEST_RATE, frames: FRAMES, channels };
}

/** A second of noise on every channel of `layout`, a profile's stretch. */
function profileOf(layout: ChannelLayout): ProcessorState {
  return learnedProfile(
    layout,
    layout.roles.map(
      (_, channel) =>
        noise(50 + channel, { length: TEST_RATE, amplitude: 0.1 }).channels[0] ??
        new Float32Array(0),
    ),
  );
}

/** Each kernel, the layout it runs on, its values, its profile, and the parameter moved before each trial between two values. */
const CASES: readonly (readonly [
  ProcessorType,
  ChannelLayout,
  Readonly<Record<string, string | number>>,
  ProcessorState | undefined,
  readonly [string, number, number],
])[] = [
  [
    NOISE_REDUCTION,
    StandardLayouts.stereo,
    {},
    profileOf(StandardLayouts.stereo),
    ['reduction', 20, 40],
  ],
  [
    NOISE_REDUCTION,
    setLayout(1, 'sn3d'),
    { mode: 'noise' },
    profileOf(setLayout(1, 'sn3d')),
    ['smoothing', 20, 80],
  ],
  [NOISE_REDUCTION, StandardLayouts.stereo, {}, undefined, ['sensitivity', 2, 9]],
  [DEREVERBERATION, StandardLayouts.mono, {}, undefined, ['strength', 20, 90]],
  [DEREVERBERATION, StandardLayouts.stereo, { order: 2 }, undefined, ['adaptation', 1, 8]],
];

function kernelOf(
  type: ProcessorType,
  layout: ChannelLayout,
  values: Readonly<Record<string, string | number>>,
  profile: ProcessorState | undefined,
): NodeKernel {
  return profile === undefined
    ? processorKernel(type, { layout, values }).kernel
    : expectSuccess(processorKernelOf(type, { layout, values, state: profile }));
}

describe('no spectral kernel allocates while it processes', () => {
  for (const [type, layout, values, profile, [moved, low, high]] of CASES) {
    const held = profile === undefined ? 'no profile' : 'a profile';
    it(`in the ${type.descriptor.label.toLowerCase()} on ${String(layout.roles.length)} channels with ${held}`, () => {
      const kernel = kernelOf(type, layout, values, profile);
      const input = programmeBlock(layout);
      const output = { ...input, channels: layout.roles.map(() => new Float32Array(FRAMES)) };
      let turn = 0;
      // A parameter moved before each trial, outside the measurement, so its
      // ramp and what the frames make of it as it moves are measured.
      const prepare = () => {
        turn += 1;
        expectSuccess(kernel.setParameter(moved, turn % 2 === 0 ? low : high));
      };
      const inputs = [input];
      const outputs = [output];
      const quantum = () => {
        kernel.process(inputs, outputs, FRAMES);
      };
      expect(allocatedBy({ prepare, quantum })).toBeLessThan(QUANTA);
      kernel.release();
    });
  }

  it('in the noise profile learner while it learns', () => {
    const layout = StandardLayouts.stereo;
    const learner = expectSuccess(
      noiseProfileLearner({
        values: processorValues(NOISE_REDUCTION),
        input: layout,
        sampleRate: TEST_RATE,
        dsp: REFERENCE_DSP,
      }),
    );
    const { channels } = programmeBlock(layout);
    const quantum = () => {
      learner.add(channels, FRAMES);
    };
    expect(allocatedBy({ quantum })).toBeLessThan(QUANTA);
    learner.release();
  });
});
