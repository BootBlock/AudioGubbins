import { describe, expect, it } from 'vitest';

import { swapMatrix } from './channel-matrices.js';
import type { PlanStage } from './plan.js';
import { applyStages, type BlockPlace } from './stage-arithmetic.js';

/** A quiet NaN with a payload, which arithmetic need not keep. */
const PAYLOAD_NAN = 0x7fc0_1234;

/** One frame of `samples`, a channel each, with `bits` written over channel `at` where given. */
function frameOf(samples: readonly number[], bits?: { at: number; value: number }): Float32Array[] {
  const channels = samples.map((sample) => Float32Array.of(sample));
  if (bits !== undefined) {
    const channel = channels[bits.at];
    if (channel !== undefined) new Uint32Array(channel.buffer)[0] = bits.value;
  }
  return channels;
}

function bitsOf(channels: readonly Float32Array[]): number[] {
  return channels.map((channel) => new Uint32Array(channel.buffer)[0] ?? -1);
}

const ONE_FRAME: BlockPlace = { first: 0, step: 1, frames: 1 };

function matrixStage(
  matrix: readonly (readonly number[])[],
  range?: { from: number; to: number },
): PlanStage {
  return { kind: 'matrix', matrix, ...(range === undefined ? {} : { range }) };
}

describe('a matrix stage', () => {
  it('swaps two channels without the zero factors reaching an infinity', () => {
    const swapped = applyStages(
      [matrixStage(swapMatrix(3, 0, 1))],
      ONE_FRAME,
      frameOf([1, Infinity, 5]),
    );

    expect(swapped.map((channel) => channel[0])).toEqual([Infinity, 1, 5]);
  });

  it('keeps every bit of a channel it copies or leaves alone: a −0 and a NaN’s payload', () => {
    const channels = frameOf([-0, 0.25, 0], { at: 2, value: PAYLOAD_NAN });
    const swapped = applyStages([matrixStage(swapMatrix(3, 0, 1))], ONE_FRAME, channels);

    const [left, right, untouched] = bitsOf(channels);
    expect(bitsOf(swapped)).toEqual([right, left, untouched]);
    expect(Object.is(swapped[1]?.[0], -0)).toBe(true);
    expect(untouched).toBe(PAYLOAD_NAN);
  });

  it('passes every bit of a frame outside its range', () => {
    const channels = frameOf([-0, 0], { at: 1, value: PAYLOAD_NAN });
    const outside = applyStages(
      [
        matrixStage(
          [
            [0.5, 0.5],
            [0.5, 0.5],
          ],
          { from: 10, to: 20 },
        ),
      ],
      ONE_FRAME,
      channels,
    );

    expect(bitsOf(outside)).toEqual(bitsOf(channels));
  });

  it('mixes only the inputs it gives a factor, from the first product', () => {
    const mixed = applyStages(
      [
        matrixStage([
          [0.5, 0, 0.5],
          [0, 0, 0],
        ]),
      ],
      ONE_FRAME,
      frameOf([-0, Infinity, -0]),
    );

    expect(Object.is(mixed[0]?.[0], -0)).toBe(true);
    expect(Object.is(mixed[1]?.[0], 0)).toBe(true);
  });
});
