import { describe, expect, it } from 'vitest';

import { ChannelRole, StandardLayouts, discreteLayout } from '../audio/channel-layout.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import { conversionMatrix, copyMatrix, selectionMatrix, swapMatrix } from './channel-matrices.js';

const HALF_POWER = 0.7071067811865476;

describe('converting between layouts by role', () => {
  it('averages a stereo pair into mono', () => {
    expect(expectSuccess(conversionMatrix(StandardLayouts.stereo, StandardLayouts.mono))).toEqual([
      [0.5, 0.5],
    ]);
  });

  it('puts mono on both sides of a stereo pair, and on the centre where there is one', () => {
    expect(expectSuccess(conversionMatrix(StandardLayouts.mono, StandardLayouts.stereo))).toEqual([
      [1],
      [1],
    ]);
    expect(
      expectSuccess(conversionMatrix(StandardLayouts.mono, StandardLayouts.surround5_1)),
    ).toEqual([[0], [0], [1], [0], [0], [0]]);
  });

  it('folds 5.1 into stereo at minus three decibels and leaves out the low-frequency channel', () => {
    expect(
      expectSuccess(conversionMatrix(StandardLayouts.surround5_1, StandardLayouts.stereo)),
    ).toEqual([
      [1, 0, HALF_POWER, 0, HALF_POWER, 0],
      [0, 1, HALF_POWER, 0, 0, HALF_POWER],
    ]);
  });

  it('carries stereo into the front pair of 5.1 and leaves the rest silent', () => {
    const matrix = expectSuccess(
      conversionMatrix(StandardLayouts.stereo, StandardLayouts.surround5_1),
    );
    expect(matrix[0]).toEqual([1, 0]);
    expect(matrix[1]).toEqual([0, 1]);
    expect(matrix.slice(2).every((row) => row.every((value) => value === 0))).toBe(true);
  });

  it('states no conversion for channels with no position', () => {
    const discrete = expectSuccess(discreteLayout(4));
    expect(expectFailureCode(conversionMatrix(discrete, StandardLayouts.stereo))).toBe(
      'editing.no-layout-conversion',
    );
    expect(expectSuccess(conversionMatrix(discrete, discrete))).toHaveLength(4);
  });

  it('takes one channel to one channel unchanged, whatever its role', () => {
    expect(
      expectSuccess(conversionMatrix({ roles: [ChannelRole.Left] }, StandardLayouts.mono)),
    ).toEqual([[1]]);
  });
});

describe('the matrices of a change between channels', () => {
  it('swaps, copies and selects channels by index', () => {
    expect(swapMatrix(3, 0, 2)).toEqual([
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ]);
    expect(copyMatrix(2, 1, 0)).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(selectionMatrix(3, [2])).toEqual([[0, 0, 1]]);
  });
});
