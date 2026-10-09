/**
 * The real spherical harmonics an ambisonic set carries, in ACN order with
 * SN3D (Schmidt semi-normalised) weights and no Condon-Shortley phase, as
 * AmbiX defines them, to the third order.
 *
 * A direction is an azimuth `φ`, anticlockwise from the front seen from
 * above, so 90° is to the left, and an elevation `θ` up from the horizontal.
 * Its unit vector is `x = cos φ cos θ` (front), `y = sin φ cos θ` (left) and
 * `z = sin θ` (up), from the canonical trigonometry of the angles in turns,
 * degrees over 360 (ADR-0032). Each harmonic is then a polynomial in `x`,
 * `y` and `z`, the same function as its trigonometric form, since
 * `cos θ · cos φ = x` and `cos θ · sin φ = y`:
 *
 * | ACN | l | m  | SN3D, trigonometric                | as computed           |
 * | --- | - | -- | ---------------------------------- | --------------------- |
 * | 0   | 0 | 0  | 1                                  | 1                     |
 * | 1   | 1 | −1 | sin φ cos θ                        | y                     |
 * | 2   | 1 | 0  | sin θ                              | z                     |
 * | 3   | 1 | 1  | cos φ cos θ                        | x                     |
 * | 4   | 2 | −2 | √3/2 sin 2φ cos²θ                  | √3 · x · y            |
 * | 5   | 2 | −1 | √3/2 sin φ sin 2θ                  | √3 · y · z            |
 * | 6   | 2 | 0  | (3 sin²θ − 1) / 2                  | (3z² − 1) / 2         |
 * | 7   | 2 | 1  | √3/2 cos φ sin 2θ                  | √3 · x · z            |
 * | 8   | 2 | 2  | √3/2 cos 2φ cos²θ                  | √3/2 · (x² − y²)      |
 * | 9   | 3 | −3 | √(5/8) sin 3φ cos³θ                | √(5/8) · y(3x² − y²)  |
 * | 10  | 3 | −2 | √15/2 sin 2φ sin θ cos²θ           | √15 · x · y · z       |
 * | 11  | 3 | −1 | √(3/8) sin φ cos θ (5 sin²θ − 1)   | √(3/8) · y(5z² − 1)   |
 * | 12  | 3 | 0  | sin θ (5 sin²θ − 3) / 2            | z(5z² − 3) / 2        |
 * | 13  | 3 | 1  | √(3/8) cos φ cos θ (5 sin²θ − 1)   | √(3/8) · x(5z² − 1)   |
 * | 14  | 3 | 2  | √15/2 cos 2φ sin θ cos²θ           | √15/2 · z(x² − y²)    |
 * | 15  | 3 | 3  | √(5/8) cos 3φ cos³θ                | √(5/8) · x(x² − 3y²)  |
 */

import { cosineOfTurns, sineOfTurns } from '@audiogubbins/audio-engine';

/** The highest order the harmonics here, and so the processors built on them, reach. */
export const HIGHEST_ORDER = 3;

const ROOT_3 = Math.sqrt(3);
const HALF_ROOT_3 = Math.sqrt(3) / 2;
const ROOT_5_8 = Math.sqrt(5 / 8);
const ROOT_15 = Math.sqrt(15);
const HALF_ROOT_15 = Math.sqrt(15) / 2;
const ROOT_3_8 = Math.sqrt(3 / 8);

/*
 * A direction and its vector are handed in a caller's `Float64Array`, not as
 * arguments: an encoder works them out again as its direction moves, on the
 * audio thread, where a number passed to a call is boxed wherever the call
 * is not inlined.
 */

/** Replaces `[azimuth, elevation]` in degrees in `direction` with its unit vector `[x, y, z]`. */
export function directionOf(direction: Float64Array): void {
  const azimuth = direction[0] ?? 0;
  const elevation = direction[1] ?? 0;
  const horizontal = cosineOfTurns(elevation / 360);
  direction[0] = cosineOfTurns(azimuth / 360) * horizontal;
  direction[1] = sineOfTurns(azimuth / 360) * horizontal;
  direction[2] = sineOfTurns(elevation / 360);
}

/**
 * Writes the SN3D harmonics of the unit vector `[x, y, z]` in `direction` to
 * `order`, by ACN, into the first `(order + 1)²` entries of `into`.
 */
export function sphericalHarmonics(
  direction: Float64Array,
  order: number,
  into: Float64Array,
): void {
  const x = direction[0] ?? 0;
  const y = direction[1] ?? 0;
  const z = direction[2] ?? 0;
  into[0] = 1;
  if (order < 1) return;
  into[1] = y;
  into[2] = z;
  into[3] = x;
  if (order < 2) return;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  into[4] = ROOT_3 * x * y;
  into[5] = ROOT_3 * y * z;
  into[6] = (3 * zz - 1) / 2;
  into[7] = ROOT_3 * x * z;
  into[8] = HALF_ROOT_3 * (xx - yy);
  if (order < 3) return;
  into[9] = ROOT_5_8 * y * (3 * xx - yy);
  into[10] = ROOT_15 * x * y * z;
  into[11] = ROOT_3_8 * y * (5 * zz - 1);
  into[12] = (z * (5 * zz - 3)) / 2;
  into[13] = ROOT_3_8 * x * (5 * zz - 1);
  into[14] = HALF_ROOT_15 * z * (xx - yy);
  into[15] = ROOT_5_8 * x * (xx - 3 * yy);
}
