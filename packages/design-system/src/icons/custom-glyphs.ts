/**
 * Glyphs Lucide lacks, drawn by AudioGubbins.
 *
 * Drawn on Lucide's 24-unit grid and to its rules: stroked paths at the set's
 * one stroke with round caps and joins, inside the 2-unit margin, as node data
 * of the same shape as Lucide's own, so the vocabulary measures and draws them
 * exactly as it does the rest. Licensed under ISC like the set they join
 * (ADR-0108), not under the repository's Apache-2.0.
 *
 * Each fade is a ramp that rises from silence to full level, or falls from it,
 * over a baseline, with a vertical rule at the full-level end.
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
