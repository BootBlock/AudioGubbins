/**
 * What the space processors' tests share: the ambisonic layouts they run
 * over, a source encoded by the encoder, a direction turned by the rotation's
 * stated convention written out with the platform's trigonometry, so it is
 * checked against something the kernels do not compute it with, and the
 * largest difference between two renders.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
  ambisonicLayout,
  type ChannelLayout,
  type ParameterValue,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { runProcessor } from './processor-run.js';
import { AMBISONIC_ENCODER } from '../space/ambisonic-encode.js';

/** Each normalisation option of the encoder, the convention it makes, and each order option's order. */
export const NORMALISATIONS = [
  ['sn3d', AmbisonicOrdering.Acn, AmbisonicNormalisation.Sn3d],
  ['n3d', AmbisonicOrdering.Acn, AmbisonicNormalisation.N3d],
  ['fuma', AmbisonicOrdering.FuMa, AmbisonicNormalisation.FuMa],
] as const;

export const ORDERS = [
  ['first', 1],
  ['second', 2],
  ['third', 3],
] as const;

/** The layout of a set of `order` in the convention of the encoder's normalisation `key`. */
export function setLayout(order: number, key: string): ChannelLayout {
  const [, ordering, normalisation] =
    NORMALISATIONS.find(([option]) => option === key) ?? NORMALISATIONS[0];
  return expectSuccess(ambisonicLayout({ order, ordering, normalisation }));
}

/** The first-order AmbiX set, and sets of each order in each other convention. */
export const AMBISONIC_LAYOUTS: readonly ChannelLayout[] = [
  setLayout(1, 'sn3d'),
  setLayout(2, 'n3d'),
  setLayout(3, 'fuma'),
];

/** `input` encoded by the encoder at `values`. */
export function encoded(
  values: Readonly<Record<string, ParameterValue>>,
  input: Float32Array,
): Float32Array[] {
  return runProcessor(AMBISONIC_ENCODER, { layout: StandardLayouts.mono, values }, [input]);
}

/** A short burst of a sine and its decay, a source with something in every frame. */
export function burst(length = 2_048): Float32Array {
  return Float32Array.from(
    { length },
    (_, frame) => 0.5 * Math.sin(frame * 0.05) * Math.exp(-frame / 1_000),
  );
}

const RADIANS = Math.PI / 180;

/**
 * The direction, in degrees, a source at `azimuth` and `elevation` is turned
 * to by `Rz(yaw) · Ry(−pitch) · Rx(roll)`, each a right-handed turn.
 */
export function turned(
  azimuth: number,
  elevation: number,
  yaw: number,
  pitch: number,
  roll: number,
): { readonly azimuth: number; readonly elevation: number } {
  const [a, e] = [azimuth * RADIANS, elevation * RADIANS];
  let [x, y, z] = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
  // Roll about x lifts y towards z.
  [y, z] = [
    Math.cos(roll * RADIANS) * y - Math.sin(roll * RADIANS) * z,
    Math.sin(roll * RADIANS) * y + Math.cos(roll * RADIANS) * z,
  ];
  // Pitch lifts x towards z.
  [x, z] = [
    Math.cos(pitch * RADIANS) * x - Math.sin(pitch * RADIANS) * z,
    Math.sin(pitch * RADIANS) * x + Math.cos(pitch * RADIANS) * z,
  ];
  // Yaw turns x towards y.
  [x, y] = [
    Math.cos(yaw * RADIANS) * x - Math.sin(yaw * RADIANS) * y,
    Math.sin(yaw * RADIANS) * x + Math.cos(yaw * RADIANS) * y,
  ];
  return {
    azimuth: Math.atan2(y, x) / RADIANS,
    elevation: Math.asin(Math.max(-1, Math.min(1, z))) / RADIANS,
  };
}

/** The largest difference between two renders of the same layout. */
export function largestDifference(
  left: readonly Float32Array[],
  right: readonly Float32Array[],
): number {
  let most = 0;
  for (const [channel, samples] of left.entries()) {
    const other = right[channel] ?? new Float32Array(0);
    for (const [frame, sample] of samples.entries()) {
      most = Math.max(most, Math.abs(sample - (other[frame] ?? Number.NaN)));
    }
  }
  return Number.isNaN(most) ? Infinity : most;
}
