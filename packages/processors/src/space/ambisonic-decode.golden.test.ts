import { describe, expect, it } from 'vitest';

import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { runProcessor } from '../testing/processor-run.js';
import { AMBISONIC_DECODER } from './ambisonic-decode.js';
import { encoded, setLayout } from '../testing/space-measures.js';

/** A third-order AmbiX field of noise from 70° left and 10° up, played over 5.1. */
const SOURCE = { azimuth: 70, elevation: 10, order: 'third' } as const;
const GOLDEN = { speakers: 'surround-5-1' } as const;

/** The 5.1 speakers' azimuths, in layout order; the low-frequency channel has none. */
const FIVE_ONE = [30, -30, 0, undefined, 110, -110];

/** `P_l(x)` for `l` from 0 to 4, written out. */
function legendre(l: number, x: number): number {
  return (
    [1, x, (3 * x * x - 1) / 2, (5 * x ** 3 - 3 * x) / 2, (35 * x ** 4 - 30 * x * x + 3) / 8][l] ??
    Number.NaN
  );
}

/**
 * The gain speaker `s` gives a source at angle `γ` from it, for a field of
 * order `N` and `L` speakers on the horizon, from the addition theorem rather
 * than from harmonics: `Σ_m Y_lm(a) Y_lm(b) = P_l(cos γ)` in SN3D, so the
 * decoder's row against the source's set is `κ Σ_l (2l + 1) g_l P_l(cos γ)`,
 * and the energy it normalises is `L Σ_l (2l + 1) g_l²`.
 */
function expectedGain(order: number, speakers: number, cosine: number): number {
  // r_E, the largest root of P_(N+1), found by bisection apart from the decoder's closed forms.
  let [low, high] = [0.5, 1];
  for (let step = 0; step < 200; step += 1) {
    const middle = (low + high) / 2;
    if (Math.sign(legendre(order + 1, middle)) === Math.sign(legendre(order + 1, high)))
      high = middle;
    else low = middle;
  }
  const radius = (low + high) / 2;
  let row = 0;
  let energy = 0;
  for (let l = 0; l <= order; l += 1) {
    const weight = legendre(l, radius);
    row += (2 * l + 1) * weight * legendre(l, cosine);
    energy += (2 * l + 1) * weight * weight;
  }
  return row / Math.sqrt(speakers * energy);
}

const RADIANS = Math.PI / 180;

describe('the ambisonic decoder, held to a recorded render', () => {
  it('plays a third-order field over 5.1 to the recorded bits', () => {
    const input = noise(13, { length: 48_000 }).channels[0] ?? new Float32Array(0);
    const field = encoded(SOURCE, input);
    const played = runProcessor(
      AMBISONIC_DECODER,
      { layout: setLayout(3, 'sn3d'), values: GOLDEN },
      field,
    );
    expect(played.map((channel) => fingerprint(channel))).toEqual([
      8802773221246337704n,
      13786947899177909915n,
      9392589699973028098n,
      11439031379155860261n,
      13537878328016559013n,
      4367542978347084491n,
    ]);
  });

  it('gives each speaker the gain the addition theorem predicts, at every order and normalisation', () => {
    const level = 0.5;
    const steady = new Float32Array(256).fill(level);
    for (const [orderKey, order] of [
      ['first', 1],
      ['second', 2],
      ['third', 3],
    ] as const) {
      for (const normalisation of ['sn3d', 'n3d', 'fuma'] as const) {
        const field = encoded({ ...SOURCE, order: orderKey, normalisation }, steady);
        const played = runProcessor(
          AMBISONIC_DECODER,
          { layout: setLayout(order, normalisation), values: GOLDEN },
          field,
        );
        for (const [speaker, azimuth] of FIVE_ONE.entries()) {
          const measured = (played[speaker]?.[100] ?? Number.NaN) / level;
          if (azimuth === undefined) {
            expect(measured).toBe(0);
            continue;
          }
          const cosine =
            Math.cos(SOURCE.elevation * RADIANS) * Math.cos((SOURCE.azimuth - azimuth) * RADIANS);
          expect(Math.abs(measured - expectedGain(order, 5, cosine))).toBeLessThan(1e-6);
        }
      }
    }
  });
});
