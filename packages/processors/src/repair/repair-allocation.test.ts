/**
 * No repair kernel allocates while it processes: each makes its rings, flags,
 * queues, model scratch and the detector's chunks when it is made, and works
 * frame by frame in them, the canonical click detector among them once its
 * event queue has grown to the most events a block has found.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { QUANTA, allocatedBy } from '@audiogubbins/audio-engine/testing';

import type { ProcessorType } from '../framework/processor-type.js';
import { TEST_RATE, processorKernel } from '../testing/processor-run.js';
import { partials, withClicks, withPop } from '../testing/repair-signals.js';
import { DE_CLICK } from './de-click.js';
import { DE_POP } from './de-pop.js';

const FRAMES = 128;

/**
 * The milliseconds a case may take: a de-click repairing a span in every
 * block of six channels runs the thousands of warming and measured quanta
 * for longer than a test's default.
 */
const TRIAL_TIMEOUT = 120_000;

/**
 * Four detector blocks, 32 quanta, of partials with a click and a pop in
 * them, repeated: every quantum is a different one of the 32, and at either
 * sensitivity the trials move between the de-click repairs a span and the
 * de-pop lowers a pop in every round of them.
 */
const PERIOD = 32 * FRAMES;
const SOURCE = withPop(withClicks(partials(PERIOD), [{ at: 300, width: 6, size: 0.5 }]), {
  at: 100,
  frequency: 50,
  decay: 0.008,
  size: 0.5,
});

/** The quanta of the repeated block on every channel of `layout`, made once. */
function quanta(layout: ChannelLayout) {
  return Array.from({ length: PERIOD / FRAMES }, (_, quantum) => ({
    layout,
    sampleRate: TEST_RATE,
    frames: FRAMES,
    channels: layout.roles.map(() => SOURCE.slice(quantum * FRAMES, (quantum + 1) * FRAMES)),
  }));
}

/** Each kernel, the layout it is run on, its values, and the parameter moved before each trial. */
const CASES: readonly (readonly [
  ProcessorType,
  ChannelLayout,
  Readonly<Record<string, string | number | boolean>>,
  string,
])[] = [
  [DE_CLICK, StandardLayouts.stereo, {}, 'sensitivity'],
  [DE_CLICK, StandardLayouts.surround5_1, { output: 'clicks', 'maximum-length': 2 }, 'sensitivity'],
  [DE_POP, StandardLayouts.stereo, { frequency: 150, 'maximum-length': 10 }, 'sensitivity'],
  [DE_POP, StandardLayouts.mono, { frequency: 150 }, 'sensitivity'],
];

describe('no repair kernel allocates while it processes', () => {
  for (const [type, layout, values, moved] of CASES) {
    it(
      `in the ${type.descriptor.label.toLowerCase()} on ${String(layout.roles.length)} channels`,
      () => {
        const { kernel, output: made } = processorKernel(type, { layout, values });
        const inputs = quanta(layout).map((block) => [block]);
        const output = {
          layout: made,
          sampleRate: TEST_RATE,
          frames: FRAMES,
          channels: made.roles.map(() => new Float32Array(FRAMES)),
        };
        // The port lists are made once, as the executor makes them.
        const outputs = [output];
        let turn = 0;
        // The sensitivity moved before each trial, outside the measurement, so
        // its ramp and the thresholds worked out as it moves are measured.
        const prepare = () => {
          turn += 1;
          kernel.setParameter(moved, turn % 2 === 0 ? 8 : 10);
        };
        let quantum = 0;
        const run = () => {
          kernel.process(inputs[quantum % inputs.length] ?? [], outputs, FRAMES);
          quantum += 1;
        };
        expect(allocatedBy({ prepare, quantum: run })).toBeLessThan(QUANTA);
      },
      TRIAL_TIMEOUT,
    );
  }
});
