/**
 * A glyph as the icon draws it: its geometry, whether it is filled, and the
 * translation that centres its ink in the grid.
 *
 * The design language centres every glyph by its ink rather than by its grid,
 * because Lucide draws some glyphs off centre on purpose (a play triangle sits
 * to the left of the middle, a chevron to one side), and an icon button has no
 * padding of its own to correct it by hand. The translation is computed once,
 * as the vocabulary is built, from the geometry itself.
 */

import type { LucideIconData, LucideIconNode } from 'lucide-react';

import { inkBoxOf } from './ink-box.js';

/** The centre of Lucide's 24-unit grid. */
const GRID_CENTRE = 12;

/**
 * The precision a translation is kept to, in grid units: a ten-thousandth of
 * a unit is under a thousandth of a pixel at the largest icon, and keeps the
 * rendered transform free of floating-point noise.
 */
const PRECISION = 1e4;

/** A glyph ready to draw. */
export interface PlacedGlyph {
  /** The glyph the geometry is taken from, by its set's own name. */
  readonly source: string;
  readonly elements: readonly LucideIconNode[];
  /** Whether the glyph is filled with its colour as well as stroked. */
  readonly filled: boolean;
  /** The translation that moves the box of the glyph's ink to the grid's centre. */
  readonly offset: { readonly x: number; readonly y: number };
}

/** Each glyph's offset, measured once however many meanings share the glyph. */
const OFFSETS = new WeakMap<LucideIconData, PlacedGlyph['offset']>();

function offsetOf(glyph: LucideIconData): PlacedGlyph['offset'] {
  let offset = OFFSETS.get(glyph);
  if (offset === undefined) {
    const box = inkBoxOf(glyph.node);
    const towardCentre = (low: number, high: number): number =>
      Math.round((GRID_CENTRE - (low + high) / 2) * PRECISION) / PRECISION;
    offset = { x: towardCentre(box.left, box.right), y: towardCentre(box.top, box.bottom) };
    OFFSETS.set(glyph, offset);
  }
  return offset;
}

function placed(glyph: LucideIconData, filled: boolean): PlacedGlyph {
  // Lucide's type leaves the name optional, and every glyph module carries one.
  if (glyph.name === undefined) {
    throw new Error('A glyph without a name cannot be traced to its source.');
  }
  return { source: glyph.name, elements: glyph.node, filled, offset: offsetOf(glyph) };
}

/** A glyph drawn as a stroke, as every glyph is but two. */
export function stroked(glyph: LucideIconData): PlacedGlyph {
  return placed(glyph, false);
}

/** A glyph filled with its colour, which the language keeps for the transport's play and pause. */
export function filled(glyph: LucideIconData): PlacedGlyph {
  return placed(glyph, true);
}
