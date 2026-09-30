/**
 * Canvas 2D painting, against a context that records its calls: the reduced
 * backend's geometry and the overlay every backend draws above it.
 */

import { describe, expect, it } from 'vitest';

import {
  cssColour,
  paintOverlay,
  paintRectangles,
  paintSegments,
  type Painter,
} from './canvas-painting.js';
import type { RenderFrame } from './render-frame.js';

/** A context that records each call as its name and arguments. */
function recording(): { painter: Painter; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const canvas = { width: 0, height: 0 };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const painter = {
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    save: record('save'),
    restore: record('restore'),
    rect: record('rect'),
    clip: record('clip'),
    fillText: (text: string, x: number, y: number) => {
      calls.push(['fillText', text, x, y, painter.textAlign]);
    },
    drawImage: record('drawImage'),
  };
  return { painter: painter as unknown as Painter, calls };
}

describe('painting with Canvas 2D', () => {
  it('writes a colour as a CSS colour, clamped', () => {
    expect(cssColour([1, 0.5, 0, 0.25])).toBe('#ff800040');
    expect(cssColour([2, -1, 0, 3])).toBe('#ff0000ff');
  });

  it('fills only the rectangles a batch counts, and strokes its segments in one path', () => {
    const { painter, calls } = recording();
    paintRectangles(painter, {
      kind: 'rectangles',
      colour: [1, 1, 1, 1],
      values: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9]),
      count: 2,
    });
    paintSegments(painter, {
      kind: 'segments',
      colour: [1, 1, 1, 1],
      width: 2,
      values: new Float32Array([0, 0, 10, 10]),
      count: 1,
    });
    expect(calls).toEqual([
      ['fillRect', 1, 2, 3, 4],
      ['fillRect', 5, 6, 7, 8],
      ['beginPath'],
      ['moveTo', 0, 0],
      ['lineTo', 10, 10],
      ['stroke'],
    ]);
    expect(painter.lineWidth).toBe(2);
  });

  it('sizes the overlay to device pixels, clips each layer, and draws images under text', () => {
    const { painter, calls } = recording();
    const image = { width: 1, height: 1 } as unknown as CanvasImageSource;
    const frame: RenderFrame = {
      width: 100,
      height: 50,
      pixelRatio: 2,
      clear: [0, 0, 0, 1],
      layers: [
        {
          batches: [
            { kind: 'rectangles', colour: [1, 1, 1, 1], values: new Float32Array(4), count: 1 },
          ],
        },
        {
          clip: { x: 0, y: 0, width: 50, height: 50 },
          batches: [
            {
              kind: 'text',
              labels: [
                {
                  text: '0:01.000',
                  x: 4,
                  y: 2,
                  colour: [1, 1, 1, 1],
                  font: '12px sans-serif',
                  align: 'centre',
                  baseline: 'top',
                },
              ],
            },
            { kind: 'images', images: [{ image, at: { x: 0, y: 20, width: 30, height: 20 } }] },
          ],
        },
      ],
    };
    paintOverlay(painter, frame);
    expect(painter.canvas).toEqual({ width: 200, height: 100 });
    expect(calls.map(([name]) => name)).toEqual([
      'setTransform',
      'clearRect',
      'save',
      'beginPath',
      'rect',
      'clip',
      'drawImage',
      'fillText',
      'restore',
    ]);
    expect(calls).toContainEqual(['fillText', '0:01.000', 4, 2, 'center']);
  });
});
