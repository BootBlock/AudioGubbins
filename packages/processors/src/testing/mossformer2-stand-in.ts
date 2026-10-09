/**
 * MossFormer2 SE 48K's graph played by a model written in TypeScript, for the
 * tests that run the processor without its pack: a mask worked out from the
 * features the graph is given, by a rule the test states.
 */

import type { Tensor } from '@audiogubbins/ml-runtime';
import type { FakeModel } from '@audiogubbins/ml-runtime/testing';

import { BINS, FEATURES } from '../ml/mossformer2/mossformer2-model.js';

/**
 * A stand-in graph whose mask, for each run, is `gain` of its features, frame
 * and bin, declaring `declared` features a frame.
 */
export function mossFormer2Graph(
  gain: (features: Float32Array, frames: number, frame: number, bin: number) => number,
  declared: number = FEATURES,
): FakeModel {
  return {
    inputs: [{ name: 'fbanks', dims: [1, 'T', declared] }],
    outputs: [],
    run: (inputs) => {
      const fbanks = inputs.get('fbanks');
      const frames = fbanks?.dims[1] ?? 0;
      const features = fbanks?.data ?? new Float32Array(0);
      const mask = new Float32Array(frames * BINS);
      for (let frame = 0; frame < frames; frame += 1) {
        for (let bin = 0; bin < BINS; bin += 1) {
          mask[frame * BINS + bin] = gain(features, frames, frame, bin);
        }
      }
      return new Map<string, Tensor>([['mask', { data: mask, dims: [1, frames, BINS] }]]);
    },
  };
}
