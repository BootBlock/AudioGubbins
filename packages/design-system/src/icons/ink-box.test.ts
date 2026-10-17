import { describe, expect, it } from 'vitest';

import { inkBoxOf } from './ink-box.js';

describe('inkBoxOf', () => {
  it('bounds a circle by its radius', () => {
    expect(inkBoxOf([['circle', { cx: '12', cy: '10', r: '4' }]])).toEqual({
      left: 8,
      top: 6,
      right: 16,
      bottom: 14,
    });
  });

  it('bounds an ellipse by its two radii', () => {
    expect(inkBoxOf([['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }]])).toEqual({
      left: 3,
      top: 2,
      right: 21,
      bottom: 8,
    });
  });

  it('bounds a rounded rectangle by the rectangle', () => {
    expect(inkBoxOf([['rect', { x: '3', y: '4', width: '18', height: '12', rx: '2' }]])).toEqual({
      left: 3,
      top: 4,
      right: 21,
      bottom: 16,
    });
  });

  it('bounds a line by its end points', () => {
    expect(inkBoxOf([['line', { x1: '18', y1: '6', x2: '6', y2: '20' }]])).toEqual({
      left: 6,
      top: 6,
      right: 18,
      bottom: 20,
    });
  });

  it('bounds a polyline and a polygon by their points', () => {
    expect(inkBoxOf([['polyline', { points: '4 17 10 11 4 5' }]])).toEqual({
      left: 4,
      top: 5,
      right: 10,
      bottom: 17,
    });
    expect(inkBoxOf([['polygon', { points: '6,3 20,12 6,21' }]])).toEqual({
      left: 6,
      top: 3,
      right: 20,
      bottom: 21,
    });
  });

  it('bounds a path by its exact geometry', () => {
    const box = inkBoxOf([['path', { d: 'M2 12A10 10 0 0 1 22 12' }]]);
    expect(box.top).toBeCloseTo(2, 9);
    expect(box.bottom).toBeCloseTo(12, 9);
  });

  it('joins the boxes of every shape a glyph draws', () => {
    expect(
      inkBoxOf([
        ['circle', { cx: '6', cy: '6', r: '2' }],
        ['line', { x1: '10', y1: '12', x2: '20', y2: '18' }],
      ]),
    ).toEqual({ left: 4, top: 4, right: 20, bottom: 18 });
  });

  it('refuses a glyph that draws nothing, or draws what it cannot measure', () => {
    expect(() => inkBoxOf([['path', { d: 'M4 4' }]])).toThrow(/draws nothing/);
    expect(() => inkBoxOf([['text', { x: '4', y: '4' }]])).toThrow(/<text>/);
    expect(() => inkBoxOf([['g', {}, [['circle', { r: '2' }]]]])).toThrow(/children/);
    expect(() => inkBoxOf([['circle', { r: 'wide' }]])).toThrow(/not a length/);
  });
});
