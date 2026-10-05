/**
 * No dynamics kernel allocates while it processes: each makes its histories,
 * ramps and scratch when it is made, and works frame by frame in them.
 */

import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { TEST_RATE, processorKernel } from '../testing/processor-run.js';
import { COMPRESSOR } from './compressor.js';
import { EXPANDER } from './expander.js';
import { GATE } from './gate.js';
import { LIMITER } from './limiter.js';

const FRAMES = 128;

/** Two channels of loud programme, one quantum long, made once. */
function programmeBlock() {
  const source = noisySine(440).channels[0] ?? new Float32Array(0);
  const channels = [0, 1].map((offset) =>
    Float32Array.from({ length: FRAMES }, (_, frame) => 3 * (source[frame + offset * 997] ?? 0)),
  );
  return { layout: StandardLayouts.stereo, sampleRate: TEST_RATE, frames: FRAMES, channels };
}

const CASES: readonly (readonly [ProcessorType, Readonly<Record<string, string | number>>])[] = [
  [COMPRESSOR, { detector: 'rms' }],
  [EXPANDER, {}],
  [GATE, { threshold: -12, hold: 0 }],
  [LIMITER, {}],
];

describe('no dynamics kernel allocates while it processes', () => {
  for (const [type, values] of CASES) {
    it(`in the ${type.descriptor.label.toLowerCase()}`, () => {
      const { kernel } = processorKernel(type, {
        layout: StandardLayouts.stereo,
        values,
        quality: MAXIMUM_QUALITY.settings,
      });
      const input = programmeBlock();
      const output = { ...programmeBlock(), channels: [0, 1].map(() => new Float32Array(FRAMES)) };
      let turn = 0;
      // A parameter moved before each trial, outside the measurement, so the
      // ramp and the coefficient worked out again as it moves are measured.
      const prepare = () => {
        turn += 1;
        kernel.setParameter('release', turn % 2 === 0 ? 200 : 300);
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
