/**
 * The shapes of a filter band, drawn by AudioGubbins: Lucide has none.
 *
 * Drawn on Lucide's 24-unit grid and to its rules: stroked paths at the set's
 * one stroke with round caps and joins, inside the 2-unit margin, as node data
 * of the same shape as Lucide's own, so the vocabulary measures and draws them
 * exactly as it does the rest. Licensed under ISC like the set they join
 * (ADR-0108), not under the repository's Apache-2.0.
 *
 * Each is the band's magnitude response, low frequencies on the left, as an
 * equaliser's own graph draws it, with no axes: the shape alone is what tells
 * one band from another at an icon's size. The flat runs are kept long so a
 * shelf, which settles at a new level, never reads as a cut, which falls away.
 * Several shapes draw only part of the grid's height, and the vocabulary's ink
 * centring places them, so none is nudged to the middle by hand.
 */

import type { LucideIconData } from 'lucide-react';

function band(name: string, response: string): LucideIconData {
  return { name, size: 24, node: [['path', { d: response, key: 'response' }]] };
}

/** A bell, or peaking band: a symmetrical rise around its frequency, flat either side. */
export const BELL_BAND = band('bell', 'M3 16h3.5c2.5 0 3.5-10 5.5-10s3 10 5.5 10H21');

/** A low shelf: the lows held at one level and the highs at another. */
export const LOW_SHELF_BAND = band('low-shelf', 'M3 8h4c3 0 4 8 7 8h7');

/** A high shelf: the low shelf's mirror. */
export const HIGH_SHELF_BAND = band('high-shelf', 'M3 16h7c3 0 4-8 7-8h4');

/** A low cut, or high-pass: the lows fall away below the corner and the highs pass flat. */
export const LOW_CUT_BAND = band('low-cut', 'M3 19c2-7 4-11 9-11h9');

/** A high cut, or low-pass: the low cut's mirror. */
export const HIGH_CUT_BAND = band('high-cut', 'M3 8h9c5 0 7 4 9 11');

/** A notch: a narrow, deep dip at one frequency in an otherwise flat response. */
export const NOTCH_BAND = band('notch', 'M3 8h5.5c2 0 2.5 10 3.5 10s1.5-10 3.5-10H21');

/** A band-pass: one band passes, and everything either side of it falls away. */
export const BAND_PASS_BAND = band('band-pass', 'M3 19c4 0 5-12 9-12s5 12 9 12');
