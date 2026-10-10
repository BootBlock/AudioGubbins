/**
 * Which device pixels a field batch paints, and which cell each reads: the one
 * computation every backend draws a field by, so they paint alike.
 */

import { describe, expect, it } from 'vitest';

import { FieldLookups, type DeviceSpan, type FieldPlacement } from './field-pixels.js';
import type { FieldBatch, Rectangle, RenderFrame } from './render-frame.js';

/** A frame of `width` by `height` CSS pixels at `pixelRatio`, holding `layers`. */
function frameOf(
  width: number,
  height: number,
  pixelRatio: number,
  layers: RenderFrame['layers'] = [],
): RenderFrame {
  return { width, height, pixelRatio, clear: [0, 0, 0, 1], layers };
}

/** A field batch of a field `width` by `height` across `at`. */
function fieldBatch(
  at: FieldBatch['at'],
  options: {
    readonly width?: number;
    readonly height?: number;
    readonly from?: number;
    readonly to?: number;
    readonly rows?: readonly number[];
  } = {},
): FieldBatch {
  const width = options.width ?? 4;
  const height = options.height ?? 4;
  return {
    kind: 'field',
    field: { key: 'field', width, height, values: new Uint8Array(width * height) },
    ramp: { key: 'ramp', colours: new Uint8Array(1024) },
    at,
    columns: { from: options.from ?? 0, to: options.to ?? width },
    rows: new Float32Array(options.rows ?? []),
  };
}

/** `batch` placed alone in `frame`, within `clip`, and its maps. */
function placed(
  batch: FieldBatch,
  frame: RenderFrame,
  clip?: Rectangle,
): { readonly placement: FieldPlacement; readonly values: Float32Array } {
  const { placements, values } = new FieldLookups().pack({
    ...frame,
    layers: [clip === undefined ? { batches: [batch] } : { clip, batches: [batch] }],
  });
  const [placement] = placements;
  if (placement === undefined) throw new Error('The frame holds one field.');
  return { placement, values };
}

/** The device pixels a field across `at` paints within `clip` in `frame`. */
function spanOf(at: Rectangle, clip: Rectangle | undefined, frame: RenderFrame): DeviceSpan {
  return placed(fieldBatch(at), frame, clip).placement.span;
}

/** The column map of `batch` across its span in `frame`. */
function columnsOf(batch: FieldBatch, frame: RenderFrame): number[] {
  const { placement, values } = placed(batch, frame);
  return [...values.subarray(placement.columnsAt, placement.columnsAt + placement.span.width)];
}

/** The row map of `batch` across its span in `frame`. */
function rowsOf(batch: FieldBatch, frame: RenderFrame): number[] {
  const { placement, values } = placed(batch, frame);
  return [...values.subarray(placement.rowsAt, placement.rowsAt + placement.span.height)];
}

describe('the device pixels a field paints', () => {
  it('are those whose centres lie inside its rectangle, near edges in and far edges out', () => {
    // At two device pixels to the CSS pixel, columns 2 to 5 have centres from
    // 1.25 to 3.0 CSS pixels, and column 6's centre is 3.25, the far edge.
    expect(spanOf({ x: 1.25, y: 0.5, width: 2, height: 1.5 }, undefined, frameOf(4, 3, 2))).toEqual(
      { left: 2, top: 1, width: 4, height: 3 },
    );
  });

  it('are within the layer’s clip by the same rule, and on the canvas', () => {
    const frame = frameOf(4, 4, 1.5);
    // The clip's edges at 1.5 and 4.5 device pixels take columns 1 to 3.
    expect(
      spanOf({ x: -2, y: -2, width: 10, height: 10 }, { x: 1, y: 0, width: 2, height: 2 }, frame),
    ).toEqual({ left: 1, top: 0, width: 3, height: 3 });
    expect(spanOf({ x: -2, y: -2, width: 10, height: 10 }, undefined, frame)).toEqual({
      left: 0,
      top: 0,
      width: 6,
      height: 6,
    });
  });

  it('are none where the rectangle holds no centre, or is off the canvas', () => {
    expect(spanOf({ x: 1.1, y: 0, width: 0.3, height: 2 }, undefined, frameOf(4, 2, 1)).width).toBe(
      0,
    );
    expect(spanOf({ x: 5, y: 0, width: 2, height: 2 }, undefined, frameOf(4, 2, 1)).width).toBe(0);
    expect(spanOf({ x: 0, y: 0, width: -2, height: 2 }, undefined, frameOf(4, 2, 1)).width).toBe(0);
  });
});

describe('the field column a device column reads', () => {
  it('is the floor of the column coordinate at its centre, from the left edge to the right', () => {
    // Four columns across two CSS pixels at twice the density: one field
    // column per device column, read at its middle.
    expect(columnsOf(fieldBatch({ x: 0, y: 0, width: 2, height: 1 }), frameOf(2, 1, 2))).toEqual([
      0, 1, 2, 3,
    ]);
    // Two device columns to a field column.
    expect(
      columnsOf(fieldBatch({ x: 0, y: 0, width: 4, height: 1 }, { to: 2 }), frameOf(4, 1, 1)),
    ).toEqual([0, 0, 1, 1]);
  });

  it('runs from right to left where the span does, and is none outside the field', () => {
    expect(
      columnsOf(
        fieldBatch({ x: 0, y: 0, width: 4, height: 1 }, { from: 4, to: 0 }),
        frameOf(4, 1, 1),
      ),
    ).toEqual([3, 2, 1, 0]);
    expect(
      columnsOf(
        fieldBatch({ x: 0, y: 0, width: 4, height: 1 }, { width: 2, from: -1, to: 3 }),
        frameOf(4, 1, 1),
      ),
    ).toEqual([-1, 0, 1, -1]);
  });

  it('is measured from the rectangle, not from the part of it the canvas shows', () => {
    // The rectangle starts a CSS pixel left of the canvas, so the first column
    // shown reads its second field column.
    expect(columnsOf(fieldBatch({ x: -1, y: 0, width: 4, height: 1 }), frameOf(2, 1, 1))).toEqual([
      1, 2,
    ]);
  });
});

describe('the field row a device row reads', () => {
  it('is its entry floored, and none where the entry is out of the field or not a number', () => {
    expect(
      rowsOf(
        fieldBatch(
          { x: 0, y: 0, width: 1, height: 5 },
          { height: 3, rows: [2, -1, 0.9, 3, Number.NaN] },
        ),
        frameOf(1, 5, 1),
      ),
    ).toEqual([2, -1, 0, -1, -1]);
  });

  it('is counted from the rectangle’s first row, whatever hides it, and is none past the entries', () => {
    // The rectangle starts a CSS pixel above the canvas: its entry 0 is hidden.
    expect(
      rowsOf(
        fieldBatch({ x: 0, y: -1, width: 1, height: 4 }, { rows: [0, 1, 2] }),
        frameOf(1, 4, 1),
      ),
    ).toEqual([1, 2, -1]);
  });

  it('ignores entries past the rectangle’s rows', () => {
    expect(
      rowsOf(
        fieldBatch({ x: 0, y: 0, width: 1, height: 2 }, { rows: [3, 2, 1, 0] }),
        frameOf(1, 2, 1),
      ),
    ).toEqual([3, 2]);
  });
});

describe('a frame’s lookups', () => {
  it('place each field batch’s column map and then its row map, in draw order', () => {
    const first = fieldBatch({ x: 0, y: 0, width: 2, height: 1 }, { to: 2, rows: [3] });
    const second = fieldBatch({ x: 1, y: 0, width: 1, height: 2 }, { to: 1, rows: [1, 0] });
    const frame = frameOf(2, 2, 1, [
      {
        batches: [
          first,
          { kind: 'rectangles', colour: [1, 1, 1, 1], values: new Float32Array(4), count: 1 },
        ],
      },
      { clip: { x: 0, y: 0, width: 2, height: 1 }, batches: [second] },
    ]);

    const { placements, values } = new FieldLookups().pack(frame);

    expect(placements.map(({ span, columnsAt, rowsAt }) => ({ span, columnsAt, rowsAt }))).toEqual([
      { span: { left: 0, top: 0, width: 2, height: 1 }, columnsAt: 0, rowsAt: 2 },
      { span: { left: 1, top: 0, width: 1, height: 1 }, columnsAt: 3, rowsAt: 4 },
    ]);
    expect([...values]).toEqual([0, 1, 3, 0, 1]);
  });
});
