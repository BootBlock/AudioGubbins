/**
 * The pitch shift's kernel allocates nothing while it processes: its
 * histories, sums, spectra, peaks, rotations and ramps are made when it is,
 * and each frame is transformed, shifted and added back in them.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, namedQualityMode, type ChannelLayout } from '@audiogubbins/domain';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import { TEST_RATE, processorKernel } from '../testing/processor-run.js';
import { setLayout } from '../testing/space-measures.js';
import { PITCH_SHIFT } from './pitch-shift.js';

const FRAMES = 128;

/** A quantum of loud programme on every channel of `layout`, made once. */
function programmeBlock(layout: ChannelLayout) {
  const source = noisySine(440).channels[0] ?? new Float32Array(0);
  const channels = layout.roles.map((_, offset) =>
    Float32Array.from({ length: FRAMES }, (_, frame) => source[frame + offset * 997] ?? 0),
  );
  return { layout, sampleRate: TEST_RATE, frames: FRAMES, channels };
}

/** Each layout, the quality level, and the parameter moved before each trial, between two values. */
const CASES = [
  [StandardLayouts.mono, 'draft', 'semitones', [-7.5, 12]],
  [StandardLayouts.stereo, 'maximum', 'semitones', [3, -19.25]],
  [StandardLayouts.surround5_1, 'standard', 'cents', [-60, 45]],
  [setLayout(1, 'sn3d'), 'maximum', 'cents', [10, -90]],
] as const;

describe('the pitch shift allocates nothing while it processes', () => {
  for (const [layout, level, moved, [one, other]] of CASES) {
    it(`on ${String(layout.roles.length)} channels at ${level} quality`, () => {
      const { kernel } = processorKernel(PITCH_SHIFT, {
        layout,
        values: { semitones: 5 },
        quality: namedQualityMode(level).settings,
      });
      const input = programmeBlock(layout);
      const output = { ...input, channels: layout.roles.map(() => new Float32Array(FRAMES)) };
      let turn = 0;
      // A parameter moved before each trial, outside the measurement, so its
      // ramp and the ratio worked out again each frame are measured.
      const prepare = () => {
        turn += 1;
        kernel.setParameter(moved, turn % 2 === 0 ? one : other);
      };
      // The port lists are made once, as the executor makes them.
      const inputs = [input];
      const outputs = [output];
      const quantum = () => {
        kernel.process(inputs, outputs, FRAMES);
      };
      expect(allocatedBy({ prepare, quantum })).toBeLessThan(QUANTA);
      kernel.release();
    });
  }
});
