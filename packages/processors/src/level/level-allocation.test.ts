/**
 * No normalisation kernel allocates while it processes: each makes its finite
 * block and its gain node when it is made, and works frame by frame in them,
 * a moved level making one new gain for the node to ramp to.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { TEST_RATE, processorKernel } from '../testing/processor-run.js';
import { setLayout } from '../testing/space-measures.js';
import { LOUDNESS_NORMALISATION } from './loudness-normalisation.js';
import { PEAK_NORMALISATION } from './peak-normalisation.js';
import { GAIN_PROCESSOR } from './gain-processor.js';

const FRAMES = 128;

/** A quantum of loud programme on every channel of `layout`, made once. */
function programmeBlock(layout: ChannelLayout) {
  const source = noisySine(440).channels[0] ?? new Float32Array(0);
  const channels = layout.roles.map((_, offset) =>
    Float32Array.from({ length: FRAMES }, (_, frame) => source[frame + offset * 997] ?? 0),
  );
  return { layout, sampleRate: TEST_RATE, frames: FRAMES, channels };
}

/**
 * Each kernel, its layout, its values, its measurement after the header (none
 * for a processor that measures nothing), and the level moved.
 */
const CASES: readonly (readonly [
  ProcessorType,
  ChannelLayout,
  Readonly<Record<string, string | number | boolean>>,
  readonly number[] | undefined,
  string,
])[] = [
  [GAIN_PROCESSOR, StandardLayouts.surround5_1, {}, undefined, 'gain'],
  [PEAK_NORMALISATION, StandardLayouts.stereo, {}, [0.5, 0.6], 'target'],
  [
    PEAK_NORMALISATION,
    StandardLayouts.surround5_1,
    { detection: 'true-peak' },
    [0.5, 0.6],
    'target',
  ],
  [LOUDNESS_NORMALISATION, StandardLayouts.stereo, {}, [1, -30, 0.5], 'target'],
  [
    LOUDNESS_NORMALISATION,
    setLayout(1, 'sn3d'),
    { 'limit-true-peak': true },
    [1, -20, 0.9],
    'ceiling',
  ],
];

describe('no level kernel allocates while it processes', () => {
  for (const [type, layout, values, body, moved] of CASES) {
    it(`in the ${type.descriptor.label.toLowerCase()} on ${String(layout.roles.length)} channels`, () => {
      const { kernel, output: made } = processorKernel(type, {
        layout,
        values,
        ...(body === undefined ? {} : { measured: [TEST_RATE, layout.roles.length, ...body] }),
      });
      const input = programmeBlock(layout);
      const output = {
        ...programmeBlock(made),
        channels: made.roles.map(() => new Float32Array(FRAMES)),
      };
      let turn = 0;
      // A level moved before each trial, outside the measurement, so the ramp
      // to the gain it makes is measured.
      const prepare = () => {
        turn += 1;
        kernel.setParameter(moved, turn % 2 === 0 ? -2 : -6);
      };
      const inputs = [input];
      const outputs = [output];
      const quantum = () => {
        kernel.process(inputs, outputs, FRAMES);
      };
      expect(allocatedBy({ prepare, quantum })).toBeLessThan(QUANTA);
    });
  }
});
