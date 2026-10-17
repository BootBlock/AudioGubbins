/**
 * The exact box of a path's geometry.
 *
 * Exact rather than the box of the control points, which a curve need not
 * reach: a curve's box is its end points and the points where its derivative
 * is zero on either axis, and an elliptical arc's is its end points and the
 * ellipse's axis extremes that fall inside its sweep. The box of the control
 * points would push a rounded glyph off centre by up to a unit.
 */

import { BoxBuilder, type Box } from './box.js';
import { pathSegments, type PathSegment, type Point } from './path-segments.js';

/** Below this a coefficient is taken for zero, far under a thousandth of a grid unit. */
const EPSILON = 1e-12;

/** The roots in the open interval (0, 1) of `a t² + b t + c`. */
function rootsInUnitInterval(a: number, b: number, c: number): readonly number[] {
  let roots: number[];
  if (Math.abs(a) < EPSILON) {
    roots = Math.abs(b) < EPSILON ? [] : [-c / b];
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    roots = [(-b + root) / (2 * a), (-b - root) / (2 * a)];
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** The parameters at which a cubic Bézier's coordinate turns, from its derivative's roots. */
function cubicTurns(p0: number, p1: number, p2: number, p3: number): readonly number[] {
  // The derivative is 3 × (a t² + b t + c); the constant factor has no roots.
  return rootsInUnitInterval(-p0 + 3 * p1 - 3 * p2 + p3, 2 * (p0 - 2 * p1 + p2), p1 - p0);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function quadraticAt(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/** The angle from one vector to another, signed, in radians. */
function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/** Whether an angle lies on the sweep that starts at `start` and turns through `delta`. */
function withinSweep(angle: number, start: number, delta: number): boolean {
  const turn = 2 * Math.PI;
  const along = delta >= 0 ? angle - start : start - angle;
  return ((along % turn) + turn) % turn <= Math.abs(delta);
}

/**
 * Takes an elliptical arc's extremes into the box.
 *
 * The path writes an arc by its end points; its extremes need its centre and
 * angles, so it is converted to the centre parameterisation of SVG 1.1's
 * implementation notes (F.6.5), radii scaled up as F.6.6 requires where they
 * are too small to reach between the end points.
 */
function takeArc(builder: BoxBuilder, segment: Extract<PathSegment, { kind: 'arc' }>): void {
  const { from, to } = segment;
  if (from.x === to.x && from.y === to.y) return;
  let rx = Math.abs(segment.radiusX);
  let ry = Math.abs(segment.radiusY);
  // A zero radius makes the arc the straight line its end points already bound.
  if (rx < EPSILON || ry < EPSILON) return;

  const phi = (segment.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const halfX = (from.x - to.x) / 2;
  const halfY = (from.y - to.y) / 2;
  const x1 = cos * halfX + sin * halfY;
  const y1 = -sin * halfX + cos * halfY;

  const reach = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (reach > 1) {
    rx *= Math.sqrt(reach);
    ry *= Math.sqrt(reach);
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const magnitude = Math.sqrt(Math.max(0, numerator / denominator));
  const sign = segment.largeArc === segment.sweep ? -1 : 1;
  const centreX1 = (sign * magnitude * rx * y1) / ry;
  const centreY1 = (-sign * magnitude * ry * x1) / rx;
  const centreX = cos * centreX1 - sin * centreY1 + (from.x + to.x) / 2;
  const centreY = sin * centreX1 + cos * centreY1 + (from.y + to.y) / 2;

  const start = angleBetween(1, 0, (x1 - centreX1) / rx, (y1 - centreY1) / ry);
  let delta = angleBetween(
    (x1 - centreX1) / rx,
    (y1 - centreY1) / ry,
    (-x1 - centreX1) / rx,
    (-y1 - centreY1) / ry,
  );
  if (!segment.sweep && delta > 0) delta -= 2 * Math.PI;
  if (segment.sweep && delta < 0) delta += 2 * Math.PI;

  // x(θ) = cx + rx cos φ cos θ − ry sin φ sin θ turns where its derivative is
  // zero, at θ = atan2(−ry sin φ, rx cos φ) and half a turn on; y likewise.
  const turnX = Math.atan2(-ry * sin, rx * cos);
  const turnY = Math.atan2(ry * cos, rx * sin);
  for (const angle of [turnX, turnX + Math.PI, turnY, turnY + Math.PI]) {
    if (!withinSweep(angle, start, delta)) continue;
    builder.take(
      centreX + rx * cos * Math.cos(angle) - ry * sin * Math.sin(angle),
      centreY + rx * sin * Math.cos(angle) + ry * cos * Math.sin(angle),
    );
  }
}

function takeSegment(builder: BoxBuilder, segment: PathSegment): void {
  const take = (point: Point): void => {
    builder.take(point.x, point.y);
  };
  take(segment.from);
  take(segment.to);

  switch (segment.kind) {
    case 'line':
      return;
    case 'quadratic': {
      const { from, control, to } = segment;
      for (const axis of ['x', 'y'] as const) {
        const curvature = from[axis] - 2 * control[axis] + to[axis];
        if (Math.abs(curvature) < EPSILON) continue;
        const t = (from[axis] - control[axis]) / curvature;
        if (t <= 0 || t >= 1) continue;
        take({
          x: quadraticAt(from.x, control.x, to.x, t),
          y: quadraticAt(from.y, control.y, to.y, t),
        });
      }
      return;
    }
    case 'cubic': {
      const { from, control1, control2, to } = segment;
      for (const axis of ['x', 'y'] as const) {
        for (const t of cubicTurns(from[axis], control1[axis], control2[axis], to[axis])) {
          take({
            x: cubicAt(from.x, control1.x, control2.x, to.x, t),
            y: cubicAt(from.y, control1.y, control2.y, to.y, t),
          });
        }
      }
      return;
    }
    case 'arc':
      takeArc(builder, segment);
      return;
  }
}

/** The exact box of the geometry a path's data draws, or `undefined` when it draws nothing. */
export function pathBox(data: string): Box | undefined {
  const builder = new BoxBuilder();
  for (const segment of pathSegments(data)) takeSegment(builder, segment);
  return builder.build();
}
