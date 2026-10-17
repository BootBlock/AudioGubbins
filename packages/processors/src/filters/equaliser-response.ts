/**
 * The parametric equaliser's response, as a panel draws it: the gain in
 * decibels its cascade gives a steady sine at each frequency asked for, from
 * the very sections its kernel runs (`BiquadCascade`), so the curve on screen
 * is the one heard, near half the rate included, where the sections hand over
 * to their fitted designs.
 *
 * Read on the UI thread when a band's settings change, never on the audio
 * thread, so it may make the cascade it measures.
 */

import type { ParameterValues } from '@audiogubbins/domain';

import { BiquadCascade } from './biquad.js';
import { EQUALISER_BANDS, bandShape, type EqualiserBand } from './parametric-equaliser.js';
import { choiceOf, numberOf, toggleOf } from './parameter-values.js';

/** The coefficients of one section in a cascade's: b0, b1, b2, a1 and a2. */
const COEFFICIENTS_PER_SECTION = 5;

/** The cascade of `bands` as the kernel designs it at `sampleRate` from `values`. */
function cascadeOf(
  bands: readonly EqualiserBand[],
  values: ParameterValues,
  sampleRate: number,
): BiquadCascade {
  const cascade = new BiquadCascade(1, bands.length);
  bands.forEach((band, section) => {
    cascade.design(
      section,
      bandShape(choiceOf(values, band.type)),
      numberOf(values, band.frequency),
      sampleRate,
      numberOf(values, band.gain),
      numberOf(values, band.q),
    );
  });
  return cascade;
}

/** The magnitude in decibels of every section of `cascade`, one after another, at `turns` of the rate. */
function cascadeDecibels(cascade: BiquadCascade, turns: number): number {
  const c = cascade.coefficients;
  // e^(−jω) and e^(−2jω), where ω is 2π times the fraction of the rate.
  const angle = 2 * Math.PI * turns;
  const cos1 = Math.cos(angle);
  const sin1 = -Math.sin(angle);
  const cos2 = Math.cos(2 * angle);
  const sin2 = -Math.sin(2 * angle);
  let decibels = 0;
  for (let section = 0; section < cascade.sections; section += 1) {
    const k = section * COEFFICIENTS_PER_SECTION;
    const b0 = c[k] ?? 0;
    const b1 = c[k + 1] ?? 0;
    const b2 = c[k + 2] ?? 0;
    const a1 = c[k + 3] ?? 0;
    const a2 = c[k + 4] ?? 0;
    const numeratorRe = b0 + b1 * cos1 + b2 * cos2;
    const numeratorIm = b1 * sin1 + b2 * sin2;
    const denominatorRe = 1 + a1 * cos1 + a2 * cos2;
    const denominatorIm = a1 * sin1 + a2 * sin2;
    const numerator = numeratorRe * numeratorRe + numeratorIm * numeratorIm;
    const denominator = denominatorRe * denominatorRe + denominatorIm * denominatorIm;
    decibels += 10 * Math.log10(numerator / denominator);
  }
  return decibels;
}

/**
 * Writes to `into` the gain in decibels the equaliser set by `values` gives a
 * sine at each of `frequencies`, at `sampleRate`: the bands that are on, or,
 * where `band` names one by its index, that band alone as it would sound on.
 * A frequency at or above half the rate has no place in the spectrum, and is
 * given the response just below it.
 */
export function equaliserResponse(
  values: ParameterValues,
  sampleRate: number,
  frequencies: Float64Array,
  into: Float64Array,
  band?: number,
): void {
  const bands =
    band === undefined
      ? EQUALISER_BANDS.filter((one) => toggleOf(values, one.on))
      : EQUALISER_BANDS.slice(band, band + 1);
  const cascade = cascadeOf(bands, values, sampleRate);
  const highest = 0.5 - Number.EPSILON;
  for (let index = 0; index < frequencies.length; index += 1) {
    const turns = Math.min(highest, (frequencies[index] ?? 0) / sampleRate);
    into[index] = cascadeDecibels(cascade, turns);
  }
}
