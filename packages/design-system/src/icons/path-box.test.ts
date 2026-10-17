import { describe, expect, it } from 'vitest';

import type { Box } from './box.js';
import { pathBox } from './path-box.js';

/** Six places: far finer than any pixel, coarse enough for the arc's trigonometry. */
function expectBox(data: string, expected: Box): void {
  const box = pathBox(data);
  expect(box).toBeDefined();
  for (const side of ['left', 'top', 'right', 'bottom'] as const) {
    expect(box?.[side], `${side} of ${data}`).toBeCloseTo(expected[side], 6);
  }
}

describe('pathBox', () => {
  describe('straight segments', () => {
    it('reads absolute and relative moves and lines', () => {
      expectBox('M2 3L10 7', { left: 2, top: 3, right: 10, bottom: 7 });
      expectBox('m2 3l8 4', { left: 2, top: 3, right: 10, bottom: 7 });
    });

    it("reads a move's further pairs as lines", () => {
      expectBox('M2 3 10 7', { left: 2, top: 3, right: 10, bottom: 7 });
      expectBox('m2 3 8 4', { left: 2, top: 3, right: 10, bottom: 7 });
    });

    it('reads horizontal and vertical lines, absolute and relative', () => {
      expectBox('M2 3H10V7', { left: 2, top: 3, right: 10, bottom: 7 });
      expectBox('m2 3h8v4', { left: 2, top: 3, right: 10, bottom: 7 });
    });

    it('returns to the start of the subpath on a close, and goes on from there', () => {
      expectBox('M2 2h4v4z', { left: 2, top: 2, right: 6, bottom: 6 });
      expectBox('M2 2h4v4zl-1-1', { left: 1, top: 1, right: 6, bottom: 6 });
      expectBox('M2 2h4v4Zl-1-1', { left: 1, top: 1, right: 6, bottom: 6 });
    });

    it('reads numbers written with no separator between them', () => {
      expectBox('M.5.5L-1-1e0', { left: -1, top: -1, right: 0.5, bottom: 0.5 });
    });

    it('finds no ink in a path that only moves', () => {
      expect(pathBox('M5 5')).toBeUndefined();
      expect(pathBox('M5 5m3 3')).toBeUndefined();
    });
  });

  describe('cubic curves', () => {
    it('reaches the extremum inside the segment, not the control points', () => {
      // The control points reach y = 10; the curve turns at t = 0.5, at 7.5.
      expectBox('M0 0C0 10 10 10 10 0', { left: 0, top: 0, right: 10, bottom: 7.5 });
      expectBox('m0 0c0 10 10 10 10 0', { left: 0, top: 0, right: 10, bottom: 7.5 });
    });

    it('finds an extremum on each axis', () => {
      // x turns at t = (2 ∓ √2) / 4, leaning out past both ends to 5 ∓ 5√2; y
      // only turns at the ends.
      expectBox('M0 0C-10 0 20 10 10 10', {
        left: 5 - 5 * Math.SQRT2,
        top: 0,
        right: 5 + 5 * Math.SQRT2,
        bottom: 10,
      });
    });

    it("reflects the previous curve's second control point for a smooth curve", () => {
      expectBox('M0 0C0 10 10 10 10 0S20-10 20 0', {
        left: 0,
        top: -7.5,
        right: 20,
        bottom: 7.5,
      });
      expectBox('m0 0c0 10 10 10 10 0s10-10 10 0', {
        left: 0,
        top: -7.5,
        right: 20,
        bottom: 7.5,
      });
    });

    it('takes the current point as the first control point of a smooth curve after a line', () => {
      // Control points (10, 0) and (20, 10): y turns at t = 2/3, at 40/9. A
      // reflection of a stale control point would bend the curve elsewhere.
      expectBox('M0 0L10 0S20 10 20 0', { left: 0, top: 0, right: 20, bottom: 40 / 9 });
    });
  });

  describe('quadratic curves', () => {
    it('reaches the extremum inside the segment', () => {
      expectBox('M0 0Q5 10 10 0', { left: 0, top: 0, right: 10, bottom: 5 });
      expectBox('m0 0q5 10 10 0', { left: 0, top: 0, right: 10, bottom: 5 });
    });

    it("reflects the previous curve's control point for a smooth curve", () => {
      expectBox('M0 0Q5 10 10 0T20 0', { left: 0, top: -5, right: 20, bottom: 5 });
      expectBox('m0 0q5 10 10 0t10 0', { left: 0, top: -5, right: 20, bottom: 5 });
    });
  });

  describe('elliptical arcs', () => {
    it('takes the extreme the sweep passes through, and not the one it misses', () => {
      // Clockwise on screen from the left end of a diameter passes over the top.
      expectBox('M2 12A10 10 0 0 1 22 12', { left: 2, top: 2, right: 22, bottom: 12 });
      expectBox('M2 12A10 10 0 0 0 22 12', { left: 2, top: 12, right: 22, bottom: 22 });
      expectBox('m2 12a10 10 0 0 1 20 0', { left: 2, top: 2, right: 22, bottom: 12 });
    });

    it('takes the large arc when its flag asks', () => {
      // Three quarters of the circle, from the top round by the right and bottom to the left.
      expectBox('M12 2A10 10 0 1 1 2 12', { left: 2, top: 2, right: 22, bottom: 22 });
      // The small arc between the same points is a quarter, inside their box.
      expectBox('M12 2A10 10 0 0 0 2 12', { left: 2, top: 2, right: 12, bottom: 12 });
    });

    it('reads flags written with no separator', () => {
      expectBox('M2 12a10 10 0 0120 0', { left: 2, top: 2, right: 22, bottom: 12 });
    });

    it('scales radii too small to reach between the end points', () => {
      expectBox('M0 0A1 1 0 0 1 10 0', { left: 0, top: -5, right: 10, bottom: 0 });
    });

    it("finds a rotated ellipse's extremes", () => {
      // An ellipse of radii 10 and 5 turned 45°, from one end of its major axis
      // to the other through its minor axis' end at (−3.54, 3.54). The ellipse
      // reaches √(10² cos² 45° + 5² sin² 45°) = √62.5 from its centre on either
      // axis: the sweep passes the x minimum and the y maximum.
      const end = 10 * Math.SQRT1_2;
      expectBox(`M${String(end)} ${String(end)}A10 5 45 0 1 ${String(-end)} ${String(-end)}`, {
        left: -Math.sqrt(62.5),
        top: -end,
        right: end,
        bottom: Math.sqrt(62.5),
      });
    });

    it('draws an arc of zero radius as a straight line', () => {
      expectBox('M0 0A0 5 0 0 1 10 4', { left: 0, top: 0, right: 10, bottom: 4 });
    });
  });

  it('refuses data that is not a path', () => {
    expect(() => pathBox('M0 0X5 5')).toThrow(/command/);
    expect(() => pathBox('M0 0A1 1 0 2 1 5 5')).toThrow(/flag/);
  });
});
