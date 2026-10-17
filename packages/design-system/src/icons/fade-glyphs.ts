/**
 * The fades, drawn by AudioGubbins: Lucide has no glyph for a fade.
 *
 * Drawn on Lucide's 24-unit grid and to its rules: stroked paths at the set's
 * one stroke with round caps and joins, inside the 2-unit margin, as node data
 * of the same shape as Lucide's own, so the vocabulary measures and draws them
 * exactly as it does the rest. Licensed under ISC like the set they join
 * (ADR-0108), not under the repository's Apache-2.0.
 *
 * Every fade is a ramp between silence and full level over a baseline, with a
 * vertical rule at the full-level end, so a fade reads the same whichever way
 * or shape it takes.
 */

import type { LucideIconData } from 'lucide-react';

/** A fade in: the level rises from silence on the left to full on the right. */
export const FADE_IN: LucideIconData = {
  name: 'fade-in',
  size: 24,
  node: [
    ['path', { d: 'M3 19h18', key: 'baseline' }],
    ['path', { d: 'M21 5v14', key: 'full-level' }],
    ['path', { d: 'M3 19c7 0 12-4 18-14', key: 'ramp' }],
  ],
};

/** A fade out: the level falls from full on the left to silence on the right. */
export const FADE_OUT: LucideIconData = {
  name: 'fade-out',
  size: 24,
  node: [
    ['path', { d: 'M3 19h18', key: 'baseline' }],
    ['path', { d: 'M3 5v14', key: 'full-level' }],
    ['path', { d: 'M3 5c6 10 11 14 18 14', key: 'ramp' }],
  ],
};

/*
 * The shapes a fade can take, one per shape the domain computes. Each is drawn
 * rising, because a falling fade is its rising shape read backwards, and each
 * ramp is the shape's own curve rather than a likeness of it: across the 18
 * units from silence to full level, the Bézier's control points are placed so
 * that its height is exactly the shape's gain at each point along it.
 */

/** A ramp from a control path, over the fades' shared baseline and full-level rule. */
function fadeShape(name: string, ramp: string): LucideIconData {
  return {
    name,
    size: 24,
    node: [
      ['path', { d: 'M3 19h18', key: 'baseline' }],
      ['path', { d: 'M21 5v14', key: 'full-level' }],
      ['path', { d: ramp, key: 'ramp' }],
    ],
  };
}

/** A linear fade: the gain is the ramp's position. */
export const LINEAR_FADE = fadeShape('linear-fade', 'M3 19L21 5');

/** An equal-power fade: the gain is the square root of the position, quick to rise. */
export const EQUAL_POWER_FADE = fadeShape('equal-power-fade', 'M3 19Q3 12 21 5');

/** An S-curve fade: smoothstep, gentle at both ends and steepest in the middle. */
export const S_CURVE_FADE = fadeShape('s-curve-fade', 'M3 19C9 19 15 5 21 5');

/** A square fade: the gain is the square of the position, slow to rise. */
export const SQUARE_FADE = fadeShape('square-fade', 'M3 19Q12 19 21 5');
