import { describe, expect, it } from 'vitest';

import { inListenerFrame, motionLanes } from './motion.js';
import type { Listener, Motion } from './preview-scenario.js';

const AT_ORIGIN: Listener = { at: { x: 0, y: 0, z: 0 }, facingTurns: 0 };

function close(actual: { x: number; y: number; z: number }, expected: [number, number, number]) {
  expect(actual.x).toBeCloseTo(expected[0], 12);
  expect(actual.y).toBeCloseTo(expected[1], 12);
  expect(actual.z).toBeCloseTo(expected[2], 12);
}

describe("a position in the listener's frame", () => {
  it('is moved by the listener, unturned at no facing', () => {
    close(
      inListenerFrame({ x: 3, y: 2, z: -5 }, { at: { x: 1, y: 1, z: 1 }, facingTurns: 0 }, '3d'),
      [2, 1, -6],
    );
  });

  it('in 3D, a quarter turn faces −x: what lies there is in front, and −z to the right', () => {
    const turned = { at: { x: 0, y: 0, z: 0 }, facingTurns: 0.25 };
    close(inListenerFrame({ x: -4, y: 1, z: 0 }, turned, '3d'), [0, 1, -4]);
    close(inListenerFrame({ x: 0, y: 0, z: -2 }, turned, '3d'), [2, 0, 0]);
  });

  it('in 2D, a quarter turn faces +x, turned clockwise with +y down the screen', () => {
    const turned = { at: { x: 0, y: 0, z: 0 }, facingTurns: 0.25 };
    close(inListenerFrame({ x: 5, y: 0, z: 0 }, turned, '2d'), [0, -5, 0]);
    close(inListenerFrame({ x: 0, y: 3, z: 0 }, turned, '2d'), [3, 0, 0]);
  });
});

const PATH: Extract<Motion, { readonly kind: 'waypoints' }> = {
  kind: 'waypoints',
  points: [
    { at: { x: 0, y: 0, z: -1 }, milliseconds: 0 },
    { at: { x: 10, y: 0, z: -1 }, milliseconds: 100 },
    { at: { x: 0, y: 0, z: -1 }, milliseconds: 300 },
  ],
  repeat: 'loop',
};

describe("a moving emitter's lanes", () => {
  it('put each waypoint at its frame, each cycle after the first without the point the last ended on', () => {
    const lanes = motionLanes(PATH, AT_ORIGIN, '3d', 1_000, { from: 0, through: 700 });
    expect(lanes.x).toEqual([
      { frame: 0, value: 0 },
      { frame: 100, value: 10 },
      { frame: 300, value: 0 },
      { frame: 400, value: 10 },
      { frame: 600, value: 0 },
      { frame: 700, value: 10 },
    ]);
    expect(lanes.z.every((point) => point.value === -1)).toBe(true);
  });

  it('run back and forth over twice the path', () => {
    const lanes = motionLanes(
      { ...PATH, points: PATH.points.slice(0, 2), repeat: 'back-and-forth' },
      AT_ORIGIN,
      '3d',
      1_000,
      { from: 0, through: 300 },
    );
    expect(lanes.x).toEqual([
      { frame: 0, value: 0 },
      { frame: 100, value: 10 },
      { frame: 200, value: 0 },
      { frame: 300, value: 10 },
    ]);
  });

  it('end at the last point of a path played once', () => {
    const lanes = motionLanes({ ...PATH, repeat: 'once' }, AT_ORIGIN, '3d', 1_000, {
      from: 0,
      through: 10_000,
    });
    expect(lanes.x.map((point) => point.frame)).toEqual([0, 100, 300]);
  });

  it('are the same from a later frame on, laid from it, on a path looped many times', () => {
    // A plan that has forgotten its past lays an emitter's motion from there,
    // which must give every value from there that the whole path gives.
    const from = 4_000_123;
    const whole = motionLanes(PATH, AT_ORIGIN, '3d', 1_000, { from: 0, through: 4_100_000 });
    const later = motionLanes(PATH, AT_ORIGIN, '3d', 1_000, { from, through: 4_100_000 });
    const firstKept = whole.x.findLastIndex((point) => point.frame <= from);
    expect(later.x).toEqual(whole.x.slice(firstKept));
    expect(later.x[0]?.frame).toBeLessThanOrEqual(from);
    expect(later.x.length).toBeLessThan(whole.x.length / 10);
  });

  it('only gain points when laid through a later frame', () => {
    const shorter = motionLanes(PATH, AT_ORIGIN, '3d', 48_000, { from: 0, through: 48_000 });
    const longer = motionLanes(PATH, AT_ORIGIN, '3d', 48_000, { from: 0, through: 96_000 });
    expect(longer.x.slice(0, shorter.x.length)).toEqual(shorter.x);
    expect(longer.x.length).toBeGreaterThan(shorter.x.length);
  });

  it('are in the listener’s frame', () => {
    const lanes = motionLanes(PATH, { at: { x: 5, y: 0, z: 0 }, facingTurns: 0 }, '3d', 1_000, {
      from: 0,
      through: 100,
    });
    expect(lanes.x.map((point) => point.value)).toEqual([-5, 5]);
  });
});
