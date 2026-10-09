/**
 * No filter kernel allocates while it processes, as a moved parameter has its
 * sections designed again every few frames: the cookbook's designs and the
 * fitted ones a section above 0.49 of the rate takes, each in arrays made
 * once.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import type { ProcessorType } from '../framework/processor-type.js';
import { processorKernel } from '../testing/processor-run.js';
import { bandOn } from '../testing/filter-measures.js';
import { DE_ESSER } from './de-esser.js';
import { FILTER } from './filter.js';
import { PARAMETRIC_EQUALISER } from './parametric-equaliser.js';

const FRAMES = 128;

/** A rate at which the frequencies the parameters reach run past 0.49 of it. */
const RATE = expectSuccess(sampleRate(32_000));

/** Two channels of programme, one quantum long, made once. */
function programmeBlock() {
  const source = noisySine(440).channels[0] ?? new Float32Array(0);
  const channels = [0, 1].map((offset) =>
    Float32Array.from({ length: FRAMES }, (_, frame) => source[frame + offset * 997] ?? 0),
  );
  return { layout: StandardLayouts.stereo, sampleRate: RATE, frames: FRAMES, channels };
}

/**
 * Each kernel, its values, the parameter moved, and the two values it moves
 * between: across 0.49 of the rate, so a fitted design and a cookbook one are
 * each made while it processes, or both above it.
 */
const CASES: readonly (readonly [
  ProcessorType,
  Readonly<Record<string, string | number | boolean>>,
  string,
  number,
  number,
])[] = [
  [FILTER, { mode: 'low-pass', slope: '48-db', resonance: 4 }, 'cutoff', 12_000, 18_000],
  [FILTER, { mode: 'all-pass' }, 'cutoff', 16_500, 19_000],
  [
    PARAMETRIC_EQUALISER,
    bandOn(1, { type: 'bell', frequency: 20_000, gain: 12 }),
    'band-1-frequency',
    15_000,
    20_000,
  ],
  [DE_ESSER, { frequency: 12_000 }, 'frequency', 9_000, 12_000],
];

describe('no filter kernel allocates while it processes', () => {
  for (const [type, values, moved, low, high] of CASES) {
    it(`in the ${type.descriptor.label.toLowerCase()}, its ${moved} moved from ${String(low)} to ${String(high)} Hz`, () => {
      const { kernel } = processorKernel(type, {
        layout: StandardLayouts.stereo,
        sampleRate: RATE,
        values,
      });
      const input = programmeBlock();
      const output = { ...programmeBlock(), channels: [0, 1].map(() => new Float32Array(FRAMES)) };
      let turn = 0;
      // Moved before each trial, outside the measurement, so the ramp and
      // the designs made again as it moves are measured.
      const prepare = () => {
        turn += 1;
        expectSuccess(kernel.setParameter(moved, turn % 2 === 0 ? low : high));
      };
      const inputs = [input];
      const outputs = [output];
      const quantum = () => {
        kernel.process(inputs, outputs, FRAMES);
      };
      // A design is made only while a parameter ramps, a few quanta after each
      // move, so the warming the measurement gives runs the fitted design's
      // code too few times for V8 to have optimised it; it is warmed here over
      // many ramps first, so what is measured is the optimised code.
      for (let ramp = 0; ramp < 256; ramp += 1) {
        prepare();
        for (let count = 0; count < 16; count += 1) quantum();
      }
      expect(allocatedBy({ prepare, quantum })).toBeLessThan(QUANTA);
    });
  }
});
