import { describe, expect, it } from 'vitest';

import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { burst, encoded } from '../testing/space-measures.js';

/** A source at 30° left and 15° up, in a third-order AmbiX set. */
const GOLDEN = { azimuth: 30, elevation: 15, order: 'third' } as const;

const RADIANS = Math.PI / 180;

/**
 * The SN3D harmonics, by ACN, at an azimuth and an elevation in degrees, in
 * the trigonometric form of the AmbiX table, with the platform's
 * trigonometry: written apart from the encoder, which computes the
 * polynomial form from canonical cosines and sines.
 */
function sn3dTable(azimuth: number, elevation: number): number[] {
  const [f, t] = [azimuth * RADIANS, elevation * RADIANS];
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return [
    1,
    Math.sin(f) * c,
    s,
    Math.cos(f) * c,
    (Math.sqrt(3) / 2) * Math.sin(2 * f) * c * c,
    (Math.sqrt(3) / 2) * Math.sin(f) * Math.sin(2 * t),
    (3 * s * s - 1) / 2,
    (Math.sqrt(3) / 2) * Math.cos(f) * Math.sin(2 * t),
    (Math.sqrt(3) / 2) * Math.cos(2 * f) * c * c,
    Math.sqrt(5 / 8) * Math.sin(3 * f) * c ** 3,
    (Math.sqrt(15) / 2) * Math.sin(2 * f) * s * c * c,
    Math.sqrt(3 / 8) * Math.sin(f) * c * (5 * s * s - 1),
    (s * (5 * s * s - 3)) / 2,
    Math.sqrt(3 / 8) * Math.cos(f) * c * (5 * s * s - 1),
    (Math.sqrt(15) / 2) * Math.cos(2 * f) * s * c * c,
    Math.sqrt(5 / 8) * Math.cos(3 * f) * c ** 3,
  ];
}

describe('the ambisonic encoder, held to a recorded render', () => {
  it('encodes noise at a fixed direction to the recorded bits', () => {
    const input = noise(11, { length: 48_000 }).channels[0] ?? new Float32Array(0);
    const field = encoded(GOLDEN, input);
    expect(field.map((channel) => fingerprint(channel))).toEqual([
      12653177059453201902n,
      1260822544042533883n,
      8581274784298143208n,
      1447993413729207829n,
      16348683839122885537n,
      5519803586471850729n,
      4725044644664879501n,
      3497751638928365019n,
      3514384863421482320n,
      13762026721164879462n,
      18319343509774647109n,
      1722210852879539889n,
      4837356713017702258n,
      11712545493985609155n,
      5325101637910227885n,
      12165442678194624610n,
    ]);
  });

  it("gives every component the AmbiX table's SN3D gain at the cardinal directions and between", () => {
    const level = 0.5;
    const steady = new Float32Array(256).fill(level);
    for (const [azimuth, elevation] of [
      [0, 0],
      [90, 0],
      [180, 0],
      [-90, 0],
      [0, 90],
      [0, -90],
      [45, 35],
      [-150, -20],
    ] as const) {
      const field = encoded({ azimuth, elevation, order: 'third' }, steady);
      for (const [acn, gain] of sn3dTable(azimuth, elevation).entries()) {
        expect(Math.abs((field[acn]?.[100] ?? Number.NaN) / level - gain)).toBeLessThan(2e-7);
      }
    }
  });

  it("scales every frame of the source by each component's table gain", () => {
    const source = burst(512);
    const field = encoded(GOLDEN, source);
    const gains = sn3dTable(GOLDEN.azimuth, GOLDEN.elevation);
    for (const [acn, gain] of gains.entries()) {
      for (const frame of [3, 100, 511]) {
        expect(field[acn]?.[frame]).toBeCloseTo(gain * (source[frame] ?? 0), 6);
      }
    }
  });
});
