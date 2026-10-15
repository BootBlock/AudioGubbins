import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ParameterValue } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { analyticMagnitude, decibels, sineGain } from '../testing/filter-measures.js';
import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { SPATIAL_PANNER } from './spatial-panner.js';

/**
 * The spatial panner held to Godot 4's own laws, each written out here as
 * Godot's source writes it, with the platform's logarithm, power and
 * trigonometry, apart from the panner, which computes them with the canonical
 * primitives: the attenuation models of `AudioStreamPlayer3D` and the exponent
 * of `AudioStreamPlayer2D`, the fade to the maximum distance, the pan laws of
 * each space, and the high shelf of `AudioFilterSW`.
 */

type Values = Readonly<Record<string, ParameterValue>>;

const CMP_EPSILON = 0.00001;

/** Godot's `Math::linear_to_db` and `Math::db_to_linear`. */
const toDecibels = (gain: number) => Math.log(gain) * 8.685889638065037;
const toGain = (decibels: number) => Math.exp(decibels * 0.11512925464970228);

/** Godot 4's linear gain for distance (`_get_attenuation_db`, `_update_panning`, the 2D player). */
function godotDistanceGain(
  model: string,
  distance: number,
  { unit = 10, ceiling = 3, maximum = 0, exponent = 1 },
): number {
  if (model === 'exponent') return Math.pow(1 - distance / maximum, exponent);
  const ratio = distance / unit;
  const decibels =
    model === 'inverse'
      ? toDecibels(1 / (ratio + CMP_EPSILON))
      : model === 'inverse-square'
        ? toDecibels(1 / (ratio * ratio + CMP_EPSILON))
        : model === 'logarithmic'
          ? -20 * Math.log(ratio + CMP_EPSILON)
          : 0;
  const gain = toGain(Math.min(ceiling, decibels));
  return maximum > 0 ? gain * Math.max(0, 1 - distance / maximum) : gain;
}

/** Godot 4's stereo gains in 3D (`_calc_output_vol_stereo`). */
function godot3dPan(x: number, z: number, strength: number): [number, number] {
  const flat = Math.sqrt(x * x + z * z);
  const g = Math.min(1, Math.max(0, (1 - strength) * (1 - strength)));
  const f = (1 - g) / (1 + g);
  const cosx = Math.min(1, Math.max(-1, x / (flat === 0 ? 1 : flat)));
  return [Math.sqrt((-cosx * f + 1) / 2), Math.sqrt((cosx * f + 1) / 2)];
}

/** Godot 4's stereo gains in 2D (`AudioStreamPlayer2D::_update_panning`). */
function godot2dPan(x: number, width: number, strength: number): [number, number] {
  let pan = Math.min(1, Math.max(-1, x / width));
  pan *= strength * 0.5;
  pan = Math.min(1, Math.max(0, pan + 0.5));
  return [1 - pan, pan];
}

/** Godot 4's `AudioFilterSW` high shelf at a linear `gain`, resonance 1, one stage. */
function godotShelf(gain: number, cutoff: number): Float64Array {
  const omega = (2 * Math.PI * cutoff) / TEST_RATE;
  const [sin, cos] = [Math.sin(omega), Math.cos(omega)];
  const g = Math.max(0.001, gain);
  const beta = Math.sqrt(g) / Math.sqrt(1);
  const a0 = g + 1 - (g - 1) * cos + beta * sin;
  return Float64Array.from([
    (g * (g + 1 + (g - 1) * cos + beta * sin)) / a0,
    (-2 * g * (g - 1 + (g + 1) * cos)) / a0,
    (g * (g + 1 + (g - 1) * cos - beta * sin)) / a0,
    (2 * (g - 1 - (g + 1) * cos)) / a0,
    (g + 1 - (g - 1) * cos - beta * sin) / a0,
  ]);
}

/** The steady left and right gains the panner gives a constant mono input at `values`. */
function steadyGains(values: Values): [number, number] {
  const level = 0.25;
  const input = new Float32Array(4_096).fill(level);
  const [left, right] = runProcessor(
    SPATIAL_PANNER,
    { layout: StandardLayouts.mono, values: { 'filter-decibels': 0, ...values } },
    [input],
  );
  return [(left?.[4_000] ?? Number.NaN) / level, (right?.[4_000] ?? Number.NaN) / level];
}

describe('the spatial panner, held to a recorded render', () => {
  it('places noise at a fixed position, attenuated, panned and filtered, to the recorded bits', () => {
    const input = noise(17, { length: 48_000 }).channels[0] ?? new Float32Array(0);
    const output = runProcessor(
      SPATIAL_PANNER,
      {
        layout: StandardLayouts.mono,
        values: { x: 7, y: 2, z: -12, 'unit-size': 2, 'max-distance': 80 },
      },
      [input],
    );
    expect(output.map((channel) => fingerprint(channel))).toEqual([
      5998220542241379711n,
      16501489538314378785n,
    ]);
  });
});

describe("the spatial panner, held to Godot 4's laws", () => {
  it.each([
    ['inverse', 25],
    ['inverse-square', 25],
    ['logarithmic', 25],
    ['inverse', 3],
    ['none', 40],
  ])('attenuates by the %s model at %f units as Godot does, capped at the ceiling', (model, d) => {
    const settings = { unit: 4, ceiling: 6 };
    const [left, right] = steadyGains({
      attenuation: model,
      x: 0,
      z: -d,
      'unit-size': settings.unit,
      ceiling: settings.ceiling,
    });
    const expected = godotDistanceGain(model, d, settings) * Math.SQRT1_2;
    expect(left).toBeCloseTo(expected, 6);
    expect(right).toBeCloseTo(expected, 6);
  });

  it('caps a near emitter at the ceiling, however close it is', () => {
    const [left] = steadyGains({ attenuation: 'logarithmic', x: 0, y: 0, z: 0, ceiling: -6 });
    expect(left).toBeCloseTo(toGain(-6) * Math.SQRT1_2, 6);
  });

  it('fades an emitter to silence at its maximum distance, and is silent beyond it', () => {
    const settings = { unit: 10, ceiling: 3, maximum: 100 };
    const values = { attenuation: 'inverse', 'unit-size': 10, 'max-distance': 100 };
    const [near] = steadyGains({ ...values, z: -60 });
    expect(near).toBeCloseTo(godotDistanceGain('inverse', 60, settings) * Math.SQRT1_2, 6);
    expect(steadyGains({ ...values, z: -100 })).toEqual([0, 0]);
    expect(steadyGains({ ...values, z: -140 })).toEqual([0, 0]);
  });

  it('falls by the 2D exponent model to its maximum distance, with no ceiling', () => {
    const settings = { maximum: 2_000, exponent: 2.5 };
    for (const [x, y] of [
      [0, 300],
      [400, -900],
    ] as const) {
      const [left, right] = steadyGains({
        space: '2d',
        attenuation: 'exponent',
        'max-distance': settings.maximum,
        exponent: settings.exponent,
        x,
        y,
        ceiling: -40,
      });
      const gain = godotDistanceGain('exponent', Math.hypot(x, y), settings);
      const [l, r] = godot2dPan(x, 1_152, 0.5);
      expect(left).toBeCloseTo(gain * l, 6);
      expect(right).toBeCloseTo(gain * r, 6);
    }
  });

  it.each([
    [10, 0, 0.5],
    [-3, -4, 0.5],
    [1, 1, 1],
    [-5, 2, 0.2],
    [2, 0, 0],
  ])('pans an emitter at x %f, z %f by the 3D equal-power law at strength %f', (x, z, s) => {
    const [left, right] = steadyGains({
      attenuation: 'none',
      ceiling: 0,
      x,
      y: 3,
      z,
      'panning-strength': s,
    });
    const [l, r] = godot3dPan(x, z, s);
    expect(left).toBeCloseTo(l, 7);
    expect(right).toBeCloseTo(r, 7);
  });

  it('centres an emitter at the listener, and one straight above it, in 3D', () => {
    for (const y of [0, 5]) {
      const [left, right] = steadyGains({ attenuation: 'none', ceiling: 0, x: 0, y, z: 0 });
      expect(left).toBe(right);
      expect(left).toBe(Math.fround(Math.SQRT1_2));
    }
  });

  it.each([
    [576, 0.5],
    [-2_000, 0.5],
    [300, 1],
    [0, 1],
  ])('pans an emitter at x %f by the 2D linear law at strength %f', (x, s) => {
    const [left, right] = steadyGains({
      space: '2d',
      attenuation: 'none',
      ceiling: 0,
      x,
      y: 40,
      z: 9_999,
      'panning-strength': s,
    });
    const [l, r] = godot2dPan(x, 1_152, s);
    expect(left).toBeCloseTo(l, 7);
    expect(right).toBeCloseTo(r, 7);
  });

  it("filters an attenuated emitter by Godot's high shelf, cut by its gain at the cutoff and twice that above", () => {
    const values = {
      attenuation: 'inverse',
      'unit-size': 1,
      x: 0,
      z: -4,
      'filter-cutoff': 5_000,
      'filter-decibels': -24,
    };
    const distance = godotDistanceGain('inverse', 4, { unit: 1 });
    const shelfDecibels = (1 - Math.min(1, distance)) * -24;
    const shelf = godotShelf(toGain(shelfDecibels), 5_000);
    const flat = decibels(distance * Math.SQRT1_2);
    for (const frequency of [100, 1_000, 5_000, 12_000]) {
      const heard = sineGain(SPATIAL_PANNER, values, frequency) - flat;
      expect(heard).toBeCloseTo(decibels(analyticMagnitude(shelf, frequency / TEST_RATE)), 2);
    }
    expect(decibels(analyticMagnitude(shelf, 5_000 / TEST_RATE))).toBeCloseTo(shelfDecibels, 6);
    expect(decibels(analyticMagnitude(shelf, 20_000 / TEST_RATE))).toBeLessThan(
      1.9 * shelfDecibels,
    );
  });

  it('leaves an emitter its distance gain alone unfiltered where it is not attenuated', () => {
    const values = { attenuation: 'inverse', 'unit-size': 10, x: 0, z: -2, ceiling: 0 };
    const flat = decibels(Math.SQRT1_2);
    for (const frequency of [100, 12_000]) {
      expect(sineGain(SPATIAL_PANNER, values, frequency) - flat).toBeCloseTo(0, 6);
    }
  });
});
