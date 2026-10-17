/**
 * The box of a glyph's ink: the union of the exact boxes of every shape it
 * draws, in its 24-unit grid.
 *
 * The geometry alone, without the stroke. Every stroke in the set is the same
 * width with round caps and joins, so it widens the box by the same half width
 * on every side and moves its centre nowhere.
 */

import type { LucideIconNode } from 'lucide-react';

import { BoxBuilder, type Box } from './box.js';
import { pathBox } from './path-box.js';

/** A geometry attribute as a number, absent ones taking SVG's initial value of zero. */
function length(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`A glyph's geometry attribute is ${typeof value}, not a length.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`A glyph's geometry attribute "${String(value)}" is not a length.`);
  }
  return parsed;
}

/** The coordinate pairs of a polyline's or polygon's `points`. */
function points(value: unknown): readonly (readonly [number, number])[] {
  const numbers = (typeof value === 'string' ? value.trim().split(/[\s,]+/) : []).map(length);
  if (numbers.length % 2 !== 0) throw new Error(`Points "${String(value)}" do not pair up.`);
  const pairs: (readonly [number, number])[] = [];
  for (let at = 0; at < numbers.length; at += 2) {
    pairs.push([numbers[at] ?? 0, numbers[at + 1] ?? 0]);
  }
  return pairs;
}

function takeElement(builder: BoxBuilder, node: LucideIconNode): void {
  const [tag, attributes, children] = node;
  // A group could carry a transform the box would have to apply, and no glyph
  // in the set has one, so one is refused rather than measured wrongly.
  if (children !== undefined) throw new Error(`A glyph's <${tag}> has children; none is read.`);

  switch (tag) {
    case 'path': {
      const box = pathBox(typeof attributes.d === 'string' ? attributes.d : '');
      if (box !== undefined) builder.takeBox(box);
      return;
    }
    case 'circle': {
      const r = length(attributes.r);
      const cx = length(attributes.cx);
      const cy = length(attributes.cy);
      if (r > 0) builder.takeBox({ left: cx - r, top: cy - r, right: cx + r, bottom: cy + r });
      return;
    }
    case 'ellipse': {
      const rx = length(attributes.rx);
      const ry = length(attributes.ry);
      const cx = length(attributes.cx);
      const cy = length(attributes.cy);
      if (rx > 0 && ry > 0) {
        builder.takeBox({ left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry });
      }
      return;
    }
    case 'rect': {
      // Rounded corners stay inside the rectangle, so its box is the rectangle's.
      const x = length(attributes.x);
      const y = length(attributes.y);
      const width = length(attributes.width);
      const height = length(attributes.height);
      if (width > 0 && height > 0) {
        builder.takeBox({ left: x, top: y, right: x + width, bottom: y + height });
      }
      return;
    }
    case 'line':
      builder.take(length(attributes.x1), length(attributes.y1));
      builder.take(length(attributes.x2), length(attributes.y2));
      return;
    case 'polyline':
    case 'polygon':
      for (const [x, y] of points(attributes.points)) builder.take(x, y);
      return;
    default:
      throw new Error(`A glyph's <${tag}> is not a shape whose ink is measured.`);
  }
}

/** The box of everything a glyph draws. A glyph that draws nothing is refused. */
export function inkBoxOf(nodes: readonly LucideIconNode[]): Box {
  const builder = new BoxBuilder();
  for (const node of nodes) takeElement(builder, node);
  const box = builder.build();
  if (box === undefined) throw new Error('A glyph draws nothing, so it has no ink to centre.');
  return box;
}
