import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  FIRST_ORDER_AMBIX,
  StandardLayouts,
  ambisonicLayout,
  type AmbisonicConvention,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import {
  STEMS,
  distinctBlock,
  distinctSample,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { MATRIX_NODE } from './matrix.js';
import { NamedMatrix } from './named-matrices.js';

function set(order: number, ordering: AmbisonicOrdering, normalisation: AmbisonicNormalisation) {
  return expectSuccess(ambisonicLayout({ order, ordering, normalisation }));
}

const { Acn, FuMa } = AmbisonicOrdering;
const { Sn3d, N3d } = AmbisonicNormalisation;

function conversion(from: ChannelLayout, to: ChannelLayout) {
  return nodeOf(BuiltInNodeType.Matrix, {
    inputs: [port('in', from)],
    outputs: [port('out', to)],
    settings: { named: NamedMatrix.AmbisonicConversion },
  });
}

/** Each output channel of a conversion run over a block whose channels all differ. */
function converted(from: ChannelLayout, to: ChannelLayout, frames = 40): Float32Array[] {
  const kernel = kernelOf(MATRIX_NODE, conversion(from, to));
  const [out] = runInCalls(kernel, [distinctBlock(from, frames)], [to], frames, [frames]);
  return out ?? [];
}

/** The components of the third order, in Furse-Malham order, by letter, with the ACN each carries. */
const FUMA_LETTERS: readonly string[] = [
  'W',
  'X',
  'Y',
  'Z',
  'R',
  'S',
  'T',
  'U',
  'V',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
];
const ACN_OF_LETTER: Readonly<Record<string, number>> = {
  W: 0,
  Y: 1,
  Z: 2,
  X: 3,
  V: 4,
  T: 5,
  R: 6,
  S: 7,
  U: 8,
  Q: 9,
  O: 10,
  M: 11,
  K: 12,
  L: 13,
  N: 14,
  P: 15,
};

/**
 * What each Furse-Malham component is multiplied by to give its SN3D value,
 * as the ambisonic exchange-format literature tabulates it, written here
 * independently of the implementation's own table.
 */
const FUMA_TO_SN3D: Readonly<Record<string, number>> = {
  W: Math.SQRT2,
  X: 1,
  Y: 1,
  Z: 1,
  R: 1,
  S: Math.sqrt(3) / 2,
  T: Math.sqrt(3) / 2,
  U: Math.sqrt(3) / 2,
  V: Math.sqrt(3) / 2,
  K: 1,
  L: Math.sqrt(32 / 45),
  M: Math.sqrt(32 / 45),
  N: Math.sqrt(5) / 3,
  O: Math.sqrt(5) / 3,
  P: Math.sqrt(5 / 8),
  Q: Math.sqrt(5 / 8),
};

function sample(channel: number, frame: number): number {
  return Math.fround(distinctSample(channel, frame));
}

describe('the ambisonic conversion matrix', () => {
  it('reorders first-order AmbiX into Furse-Malham order, W 3 dB down', () => {
    const [w, x, y, z] = converted(set(1, Acn, Sn3d), set(1, FuMa, AmbisonicNormalisation.FuMa));
    // AmbiX carries W Y Z X; Furse-Malham carries W X Y Z.
    for (let frame = 0; frame < 40; frame += 1) {
      expect(w?.[frame]).toBeCloseTo(sample(0, frame) / Math.SQRT2, 6);
      expect(x?.[frame]).toBe(sample(3, frame));
      expect(y?.[frame]).toBe(sample(1, frame));
      expect(z?.[frame]).toBe(sample(2, frame));
    }
  });

  it('converts third-order Furse-Malham to AmbiX by the tabulated weights, component by component', () => {
    const out = converted(set(3, FuMa, AmbisonicNormalisation.FuMa), set(3, Acn, Sn3d));
    expect(out).toHaveLength(16);
    FUMA_LETTERS.forEach((letter, fumaChannel) => {
      const channel = out[ACN_OF_LETTER[letter] ?? -1];
      for (let frame = 0; frame < 40; frame += 1) {
        expect(channel?.[frame]).toBeCloseTo(
          sample(fumaChannel, frame) * (FUMA_TO_SN3D[letter] ?? 0),
          6,
        );
      }
    });
  });

  it('scales each degree by the root of 2l + 1 from SN3D to N3D, and back to the same bits', () => {
    const sn3d = set(2, Acn, Sn3d);
    const n3d = set(2, Acn, N3d);
    const out = converted(sn3d, n3d);
    out.forEach((channel, acn) => {
      const degree = Math.floor(Math.sqrt(acn));
      expect(channel[5]).toBe(Math.fround(sample(acn, 5) * Math.sqrt(2 * degree + 1)));
    });
    const back = converted(n3d, sn3d);
    back.forEach((channel, acn) => {
      const degree = Math.floor(Math.sqrt(acn));
      expect(channel[5]).toBe(Math.fround(sample(acn, 5) * (1 / Math.sqrt(2 * degree + 1))));
    });
  });

  it('round-trips a third-order set through every other convention within f32', () => {
    const ambix = set(3, Acn, Sn3d);
    for (const other of [set(3, Acn, N3d), set(3, FuMa, AmbisonicNormalisation.FuMa)]) {
      const there = runInCalls(
        kernelOf(MATRIX_NODE, conversion(ambix, other)),
        [distinctBlock(ambix, 16)],
        [other],
        16,
        [16],
      )[0];
      const block = { layout: other, sampleRate: distinctBlock(ambix, 1).sampleRate, frames: 16 };
      const [back] = runInCalls(
        kernelOf(MATRIX_NODE, conversion(other, ambix)),
        [{ ...block, channels: there ?? [] }],
        [ambix],
        16,
        [16],
      );
      back?.forEach((channel, acn) => {
        for (let frame = 0; frame < 16; frame += 1) {
          expect(channel[frame]).toBeCloseTo(sample(acn, frame), 6);
        }
      });
    }
  });

  it('is exact where nothing changes, as a zeroth-order set between SN3D and N3D is', () => {
    const [w] = converted(set(0, Acn, Sn3d), set(0, Acn, N3d));
    expect(w?.[3]).toBe(sample(0, 3));
  });

  it('refuses a port that is not an ambisonic set: stereo, 5.1 or a custom map', () => {
    for (const layout of [StandardLayouts.stereo, StandardLayouts.surround5_1, STEMS]) {
      const problems = MATRIX_NODE.check(conversion(layout, set(1, Acn, Sn3d)));
      expect(problems.map((one) => one.code)).toEqual(['layout-unsupported']);
      expect(problems[0]?.message).toContain('not an ambisonic set');
    }
  });

  it('refuses a change of order, which is a decode or an encode', () => {
    const problems = MATRIX_NODE.check(conversion(set(1, Acn, Sn3d), set(2, Acn, Sn3d)));
    expect(problems.map((one) => one.code)).toEqual(['layout-unsupported']);
    expect(problems[0]?.message).toContain('orders 1 and 2');
  });

  it('refuses a Furse-Malham set above the third order, which the convention does not define', () => {
    const fourth: AmbisonicConvention = {
      order: 4,
      ordering: FuMa,
      normalisation: AmbisonicNormalisation.FuMa,
    };
    // Written by hand, because the domain will not build it.
    const forged: ChannelLayout = {
      roles: [ChannelRole.Ambisonic, ...Array.from({ length: 24 }, () => ChannelRole.Ambisonic)],
      ambisonic: fourth,
    };
    const problems = MATRIX_NODE.check(conversion(set(4, Acn, Sn3d), forged));
    expect(problems.map((one) => one.code)).toEqual(['layout-unsupported']);
    expect(problems[0]?.message).toContain('Furse-Malham convention is defined to order 3');
  });

  it('refuses an ambisonic layout without the channels its order holds', () => {
    const short: ChannelLayout = {
      roles: [ChannelRole.Ambisonic, ChannelRole.Ambisonic],
      ambisonic: FIRST_ORDER_AMBIX,
    };
    const problems = MATRIX_NODE.check(conversion(short, set(1, Acn, Sn3d)));
    expect(problems.map((one) => one.code)).toEqual(['layout-unsupported']);
    expect(problems[0]?.message).toContain('4 ambisonic channels');
  });
});
