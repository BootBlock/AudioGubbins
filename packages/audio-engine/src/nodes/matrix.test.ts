import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  ZERO_SAMPLES,
  labelledLayout,
  layoutsMatch,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import {
  GENERIC_LAYOUTS,
  RATE,
  blockOf,
  distinctBlock,
  distinctSample,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { MATRIX_NODE } from './matrix.js';
import { MID_SIDE, NamedMatrix } from './named-matrices.js';

function matrix(
  from: ChannelLayout,
  to: ChannelLayout,
  settings: Readonly<Record<string, SettingValue>>,
) {
  return nodeOf(BuiltInNodeType.Matrix, {
    inputs: [port('in', from)],
    outputs: [port('out', to)],
    settings,
  });
}

function codes(node: ReturnType<typeof matrix>) {
  return MATRIX_NODE.check(node).map((one) => one.code);
}

/** Runs a matrix over one block and answers its output channels. */
function applied(
  from: ChannelLayout,
  to: ChannelLayout,
  settings: Readonly<Record<string, SettingValue>>,
  input: readonly (readonly number[])[],
): Float32Array[] {
  const block = blockOf(from, input);
  const kernel = kernelOf(MATRIX_NODE, matrix(from, to, settings));
  const [out] = runInCalls(kernel, [block], [to], block.frames, [block.frames]);
  return out ?? [];
}

const S = Math.SQRT1_2;
const STEREO = StandardLayouts.stereo;
const SURROUND = StandardLayouts.surround5_1;

/** Three frames of 5.1, a distinct level on every channel. */
const FIVE_ONE = [
  [0.1, -0.2, 0.3],
  [0.15, 0.25, -0.35],
  [0.4, -0.45, 0.5],
  [0.9, 0.9, 0.9],
  [-0.6, 0.65, 0.7],
  [0.05, -0.75, 0.8],
];

describe('the matrix node', () => {
  it('accepts coefficients or a name, of no latency', () => {
    const given = matrix(STEREO, StandardLayouts.mono, { coefficients: [0.5, 0.5] });
    expect(MATRIX_NODE.check(given)).toEqual([]);
    expect(
      MATRIX_NODE.check(matrix(SURROUND, STEREO, { named: NamedMatrix.Bs775FiveOneToStereo })),
    ).toEqual([]);
    expect(MATRIX_NODE.latency(given, RATE)).toEqual({ kind: 'known', frames: ZERO_SAMPLES });
  });

  it('reports each malformed shape with its own code', () => {
    const mono = StandardLayouts.mono;
    expect(codes(matrix(STEREO, mono, {}))).toEqual(['node-settings-invalid']);
    expect(
      codes(matrix(STEREO, STEREO, { coefficients: [1, 0, 0, 1], named: 'mid-side-encode' })),
    ).toEqual(['node-settings-invalid', 'layout-unsupported']);
    expect(codes(matrix(STEREO, mono, { coefficients: [1] }))).toEqual(['node-settings-invalid']);
    expect(codes(matrix(STEREO, mono, { named: 'mono-downmix' }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(matrix(STEREO, mono, { named: 3 }))).toEqual(['node-settings-invalid']);
    expect(
      codes(
        nodeOf(BuiltInNodeType.Matrix, {
          inputs: [port('in', STEREO)],
          outputs: [port('out', mono), port('spare', mono)],
          settings: { coefficients: [1, 1] },
        }),
      ),
    ).toEqual(['role-ports-invalid']);
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`sums every ${name} input channel into every output channel, in f64 in input order`, () => {
      const width = layout.roles.length;
      const weight = (row: number, column: number) => (row === column ? 1 : 0) + 0.1 * (column + 1);
      const coefficients = layout.roles.flatMap((_, row) =>
        layout.roles.map((__, column) => weight(row, column)),
      );
      const kernel = kernelOf(MATRIX_NODE, matrix(layout, layout, { coefficients }));
      const [out] = runInCalls(kernel, [distinctBlock(layout, 100)], [layout], 100, [64]);
      const expected = layout.roles.map((_, row) =>
        Float32Array.from({ length: 100 }, (__, frame) => {
          let sum = 0;
          for (let column = 0; column < width; column += 1) {
            sum += Math.fround(distinctSample(column, frame)) * weight(row, column);
          }
          return sum;
        }),
      );
      expect(out).toEqual(expected);
    });
  }

  it('downmixes 5.1 to stereo by ITU-R BS.775, without the low-frequency channel', () => {
    const [left, right, centre, , surroundLeft, surroundRight] = FIVE_ONE.map((channel) =>
      channel.map(Math.fround),
    );
    const out = applied(SURROUND, STEREO, { named: NamedMatrix.Bs775FiveOneToStereo }, FIVE_ONE);
    expect(out).toEqual([
      Float32Array.from([0, 1, 2], (frame) => {
        const at = (channel: number[] | undefined) => channel?.[frame] ?? Number.NaN;
        return at(left) + S * at(centre) + S * at(surroundLeft);
      }),
      Float32Array.from([0, 1, 2], (frame) => {
        const at = (channel: number[] | undefined) => channel?.[frame] ?? Number.NaN;
        return at(right) + S * at(centre) + S * at(surroundRight);
      }),
    ]);
  });

  it('encodes stereo to mid and side, and decodes it back', () => {
    expect(layoutsMatch(MID_SIDE, expectSuccess(labelledLayout(['mid', 'side'])))).toBe(true);
    const left = [0.5, -0.25, 0.75];
    const right = [0.25, 0.25, -0.5];
    const encoded = applied(STEREO, MID_SIDE, { named: NamedMatrix.MidSideEncode }, [left, right]);
    expect(encoded).toEqual([
      Float32Array.from([0.375, 0, 0.125]),
      Float32Array.from([0.125, -0.25, 0.625]),
    ]);
    const decoded = applied(
      MID_SIDE,
      STEREO,
      { named: NamedMatrix.MidSideDecode },
      encoded.map((channel) => [...channel]),
    );
    expect(decoded).toEqual([Float32Array.from(left), Float32Array.from(right)]);
  });

  it('refuses a named matrix between layouts it was not written for', () => {
    const quad = StandardLayouts.quadraphonic;
    const sideFirst = expectSuccess(labelledLayout(['side', 'mid']));
    expect(codes(matrix(STEREO, STEREO, { named: NamedMatrix.Bs775FiveOneToStereo }))).toEqual([
      'layout-unsupported',
    ]);
    expect(codes(matrix(SURROUND, quad, { named: NamedMatrix.Bs775FiveOneToStereo }))).toEqual([
      'layout-unsupported',
    ]);
    expect(codes(matrix(STEREO, STEREO, { named: NamedMatrix.MidSideEncode }))).toEqual([
      'layout-unsupported',
    ]);
    expect(codes(matrix(sideFirst, STEREO, { named: NamedMatrix.MidSideDecode }))).toEqual([
      'layout-unsupported',
    ]);
  });

  it('has no parameters', () => {
    const kernel = kernelOf(
      MATRIX_NODE,
      matrix(STEREO, StandardLayouts.mono, { coefficients: [0.5, 0.5] }),
    );
    expect(expectFailureCode(kernel.setParameter('coefficients', 1))).toBe(
      'node.parameter-unknown',
    );
  });
});
