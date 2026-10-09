/**
 * Spleeter's graph played by a model written in TypeScript, for the tests
 * that run the processor without its pack: each stem's magnitude estimated as
 * the mixture's times a gain the test states.
 */

import type { FakeModel } from '@audiogubbins/ml-runtime/testing';

import { MODEL_BINS, SEGMENT_FRAMES } from '../ml/spleeter/spleeter-model.js';

/** The values one channel of one segment holds in the graph's input and outputs. */
export const CHANNEL_VALUES = SEGMENT_FRAMES * MODEL_BINS;

/**
 * A graph that estimates each of `stems` as the mixture's magnitude times a
 * gain of the stem's and channel's, so each stem's ratio mask is its gain
 * squared over the sum of every stem's; it keeps each input it heard in
 * `heard`.
 */
export function spleeterGainGraph(
  stems: readonly string[],
  gain: (stem: number, channel: number) => number,
  heard: Float32Array[] = [],
): FakeModel {
  return {
    inputs: [{ name: 'x', dims: [2, 'S', SEGMENT_FRAMES, MODEL_BINS] }],
    outputs: [],
    run: (inputs) => {
      const x = inputs.get('x');
      if (x === undefined) throw new Error('The graph is given x.');
      heard.push(x.data.slice());
      return new Map(
        stems.map((name, stem) => [
          name,
          {
            data: x.data.map(
              (value, index) => value * gain(stem, Math.floor(index / CHANNEL_VALUES)),
            ),
            dims: x.dims,
          },
        ]),
      );
    },
  };
}
