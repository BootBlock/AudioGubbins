/**
 * No time or space kernel allocates while it processes: each makes its rings,
 * lines, matrices, ramps and scratch when it is made, and works frame by
 * frame in them, the engine's conversion and matrix kernels among them.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { TEST_RATE, processorKernel } from '../testing/processor-run.js';
import { AMBISONIC_DECODER } from './ambisonic-decode.js';
import { AMBISONIC_ENCODER } from './ambisonic-encode.js';
import { AMBISONIC_ROTATION } from './ambisonic-rotate.js';
import { DELAY } from './delay.js';
import { REVERB } from './reverb.js';
import { setLayout } from '../testing/space-measures.js';

const FRAMES = 128;

/** A quantum of loud programme on every channel of `layout`, made once. */
function programmeBlock(layout: ChannelLayout) {
  const source = noisySine(440).channels[0] ?? new Float32Array(0);
  const channels = layout.roles.map((_, offset) =>
    Float32Array.from({ length: FRAMES }, (_, frame) => source[frame + offset * 997] ?? 0),
  );
  return { layout, sampleRate: TEST_RATE, frames: FRAMES, channels };
}

/** Each kernel, the layout it is run on, its values, and the parameter moved before each trial. */
const CASES: readonly (readonly [
  ProcessorType,
  ChannelLayout,
  Readonly<Record<string, string | number | boolean>>,
  string | undefined,
])[] = [
  [DELAY, StandardLayouts.stereo, { 'cross-feed': true }, 'time'],
  [DELAY, StandardLayouts.stereo, {}, 'damping'],
  [REVERB, StandardLayouts.surround5_1, {}, 'decay'],
  [REVERB, StandardLayouts.stereo, {}, 'pre-delay'],
  [AMBISONIC_ENCODER, StandardLayouts.mono, { order: 'third', normalisation: 'fuma' }, 'azimuth'],
  [AMBISONIC_ROTATION, setLayout(3, 'fuma'), {}, 'yaw'],
  [AMBISONIC_ROTATION, setLayout(2, 'sn3d'), {}, 'roll'],
  [AMBISONIC_DECODER, setLayout(3, 'n3d'), { speakers: 'surround-7-1' }, undefined],
];

describe('no time or space kernel allocates while it processes', () => {
  for (const [type, layout, values, moved] of CASES) {
    it(`in the ${type.descriptor.label.toLowerCase()} on ${String(layout.roles.length)} channels`, () => {
      const { kernel, output: made } = processorKernel(type, { layout, values });
      const input = programmeBlock(layout);
      const output = {
        ...programmeBlock(made),
        channels: made.roles.map(() => new Float32Array(FRAMES)),
      };
      let turn = 0;
      // A parameter moved before each trial, outside the measurement, so its
      // ramp and the designs made as it moves are measured.
      const prepare = () => {
        turn += 1;
        if (moved !== undefined) kernel.setParameter(moved, turn % 2 === 0 ? 20 : 40);
      };
      // The port lists are made once, as the executor makes them.
      const inputs = [input];
      const outputs = [output];
      const quantum = () => {
        kernel.process(inputs, outputs, FRAMES);
      };
      expect(allocatedBy({ prepare, quantum })).toBeLessThan(QUANTA);
    });
  }
});
