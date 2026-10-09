/**
 * A processor type made for tests of what a chain's latency does to the
 * processors after it: its kernel delays its input by a stated number of
 * frames, exactly, and says so as its latency, so what follows it hears the
 * stream that many frames late and the rack must put it back.
 */

import {
  DeterminismClass,
  ProcessorCategory,
  derivedSampleCount,
  succeed,
} from '@audiogubbins/domain';

import { processorType, type ProcessorType } from '../framework/processor-type.js';

/** A type whose kernel delays its input by `frames` frames, with silence before the stream. */
export function delayingProcessor(frames: number): ProcessorType {
  return processorType({
    descriptor: {
      typeKey: `test-delay-${String(frames)}`,
      label: 'Test delay',
      category: ProcessorCategory.Level,
      version: { implementation: 1, parameters: 1 },
      parameters: [],
      qualitySettings: [],
      determinism: DeterminismClass.Canonical,
      wholePass: false,
      realTime: true,
      outputLayout: (input) => succeed(input),
      latency: () => ({ kind: 'known', frames: derivedSampleCount(frames) }),
      leadIn: () => 0,
      frameGrid: () => 1,
    },
    kernel: (run) => {
      // Each channel's last `frames` frames of input, oldest first, ringed.
      const held = run.input.roles.map(() => new Float32Array(frames));
      let at = 0;
      return succeed({
        process: (inputs, outputs, count) => {
          for (const [channel, into] of (outputs[0]?.channels ?? []).entries()) {
            const ring = held[channel];
            const from = inputs[0]?.channels[channel];
            if (ring === undefined) continue;
            for (let frame = 0; frame < count; frame += 1) {
              const slot = (at + frame) % frames;
              into[frame] = ring[slot] ?? 0;
              ring[slot] = from?.[frame] ?? 0;
            }
          }
          at = (at + count) % frames;
        },
        setParameter: () => succeed(undefined),
        release: () => undefined,
      });
    },
  });
}
